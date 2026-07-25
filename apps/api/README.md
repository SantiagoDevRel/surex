# `@surex/api` — the read path

The registry's read side. It answers the `/v1` contract in `packages/core/src/contract.mjs` and does
nothing else.

**It can only read.** There is no private key in this process, no `createWalletClient`, and no route
that writes to Arkiv. Verdicts are written by the worker's wallet in a different process, and the two
never share one — which is the reason a compromise of this service cannot rewrite the registry. That
separation is a property to preserve, not an implementation detail.

Two facts that shape everything below:

- **Every consumer read is filtered by `.createdBy(SUREX_WRITER_ADDRESS)`, never `ownedBy`.** Braga is a
  shared public testnet with no uniqueness constraint on our attributes, so without that filter anyone
  can write a colliding fingerprint with `state: clean` and the gate reads *their* verdict. `ownedBy`
  looks identical in the SDK but ownership is transferable via `changeOwnership`, which makes it
  attacker-influenceable. `createArkivStore()` refuses to construct without a valid writer address —
  there is no unfiltered mode.
- **`orderBy` is a deprecated no-op on Braga.** Every list is sorted client-side.

---

## Run it

```bash
# mocked — no Arkiv, no network, fixtures only. This is what unblocks the other lanes.
SUREX_MOCK=1 node apps/api/src/server.mjs        # → http://localhost:4310

# live — reads Braga
node apps/api/src/server.mjs

# from inside apps/api
pnpm dev        # node --watch
pnpm test       # node --test test/*.test.mjs   (hermetic: no network, ~400 ms)
pnpm smoke:live # opt-in live read against Braga (see "Verifying against Braga")
```

Port **4310**. The web app takes 4311. Do not run `pnpm install` — the workspace is already linked.

## Mock mode — how it is switched, and what it guarantees

`SUREX_MOCK=1` and nothing else. Every route then answers from `fixtures/*.json` with **no Arkiv
connection at all**, so the gate, the web app and the reviewer can each be built and demoed standalone.

**Every mocked response carries `illustrative: true`, and that flag is never to be stripped anywhere.**
It is enforced in three places on purpose, because one forgetful route is enough to put fake data on a
screen as if it were real:

1. `src/mock.mjs` marks every object it returns;
2. `src/app.mjs` marks the `unknown` head it synthesises for a miss (that one comes from the contract
   helper, not from a fixture);
3. a response middleware stamps `illustrative: true` onto the root of **every** JSON body leaving the
   process in mock mode — successes, 400s, 404s, 403s, the admin route, all of it.

Responses also carry `X-SureX-Mode: mock|live` and, in mock mode, `X-SureX-Illustrative: true`. A test
sweeps the entire route surface and fails if a single body is missing the flag.

### Fixtures

| File | State | What it is for |
|---|---|---|
| `clean-tier-a.json` | `clean`, tier A | the silent-allow path; reviewed bytes == installed bytes |
| `flagged-tier-b.json` | `flagged`, severity 4, tier B | the block path, with a finding, capability surface and `enforceAfter` |
| `disputed.json` | `disputed` | accusation **and** rebuttal side by side; still blocks |
| `stale.json` | `stale` | a release shipped after the review — the window a rug-pull lands in |
| `unreviewable-licence.json` | `unreviewable`, `reason: licence` | the licence gate refused to upload the source |
| `unknown-miss.json` | *absent* | a stable fingerprint deliberately **not** in the registry, so the miss path has one fixed input |

Every fixture carries the MCP server `config` it was fingerprinted from, and a test recomputes
`fingerprint(config)` and asserts it equals the stored fingerprint — so a fixture can never drift from
what the gate would actually compute. The only thing ever flagged is a server **we wrote ourselves**
(`@surex/fixture-mcp`); a test enforces that too. Blob IDs, Sui object IDs, tx digests and entity keys
are obvious `DEMO_` placeholders, because a plausible-looking digest that resolves to nothing is a
fabrication.

Fixtures also pass the copy law (`assertCopy` from `@surex/core`): never *safe*, *trusted*, *verified*
or *secure* about a reviewed server. The word is **reviewed**.

---

## Routes

Shapes come from the frozen contract. Errors are always `{ error: { code, message, … } }` with a code
from `ERROR_CODES`.

### `GET /v1/verdict?fp=<fingerprint>` — the hot path

One Arkiv query for the `verdictHead`, filtered by `.createdBy`. Returns the **head shape itself** as
the body. A miss returns the `unknown` head from `unknownHead()` — a 200 with a body, never a bodyless
404, because the gate has to make a decision from what it gets.

- Cacheable: `Cache-Control: public, max-age=900` on a hit, `max-age=120` on a miss — exactly
  `CACHE.positiveTtlMs` / `negativeTtlMs`, because a TTL the server does not honour is a stale block
  waiting to happen.
- In-process cache too; `X-SureX-Cache: hit|miss|stale`.
- **A cached `flagged`/`disputed` head outlives its TTL when Arkiv is unreachable** (up to
  `CACHE.flaggedGraceMs`), served with `X-SureX-Cache: stale`. A cached `clean` does **not** — an
  expired non-blocking head with no reachable registry is a `503`. A network blip must never un-flag a
  server we already know is bad, and must never keep answering `clean` for one we can no longer check.
- If we could not look at all and have nothing in grace: **`503 upstream_unavailable`**, never a
  synthesised `unknown`. "We could not look" is a different fact from "we looked and found nothing",
  and the gate already fails open on its own.
- Malformed or missing `fp` → `400 bad_fingerprint`.
- It never blocks on a write, because this process cannot write.

### `POST /v1/verdicts/batch  { fps: [...] }` — the SessionStart prefetch

**One** Arkiv round trip for a whole config: the fingerprints are OR-ed into a single predicate, not
looped. Typical size 5–20; hard cap 100.

```jsonc
{ "requested": 4,
  "heads": [ /* one per requested VALID fp, in request order, misses as the unknown head */ ],
  "invalid": [ { "fp": "garbage", "code": "bad_fingerprint" } ],   // present only if any
  "ttlMs": { "positive": 900000, "negative": 120000 } }
```

Malformed entries go to `invalid` rather than failing the whole prefetch — one bad row in a config
should not cost the other nineteen their verdicts — and are never silently promoted to a state.

### `GET /v1/entry/:fp` · `GET /v1/source/:key` · `GET /v1/review/:key`

History and evidence pointers. Each record carries a `links` object built from what it actually
records — anything missing is omitted rather than guessed:

| link | target |
|---|---|
| `blob` | `<walrus aggregator>/v1/blobs/<blobId>` |
| `suiObject` | `https://suiscan.xyz/testnet/object/<suiObjectId>` |
| `registerTx`, `certifyTx` | `https://suiscan.xyz/testnet/tx/<digest>` |
| `arkivEntity` | `https://explorer.braga.hoodi.arkiv.network/entity/<entityKey>` — verified live, HTTP 200; `/entities/<key>` 404s, so do not guess the path |

`?evidence=1` additionally fetches the Walrus blob through `@surex/core`'s `loadEvidence`, which reports
**which checks actually ran**: `content-sha256` can be `passed`, while `blob-id` reports `asserted` —
not `passed` — when no Walrus encoder is available to recompute it. Claiming a check we did not run is
exactly the kind of thing this product exists to object to. In mock mode `?evidence=1` says plainly that
no Walrus request was made.

`getEntity` has **no** creator filter of its own, so `/v1/source/:key` and `/v1/review/:key` re-apply the
provenance check by hand: an entity whose `creator` is not the SureX writer, or whose `project` or
`entityType` does not match, is a `404`. Without that, a direct key read is a hole straight through the
`.createdBy` filter.

### `GET /v1/flagged` — the public feed

Everything that blocks: `flagged` **and** `disputed`. A dispute changes what a user is told; it does not
unblock anything, so an org-level gateway mirroring "the flags" needs both. Sorted client-side by
severity then recency. `?limit=` up to 500.

### `GET /v1/stats` — registry hit rate first

`failure-modes §3.1` calls the registry hit rate the first number that should be on a dashboard and
notes it is currently nowhere. It is the first key in this response.

```jsonc
{ "hitRate": { "value": 0.5, "hits": 1, "lookups": 2,
               "scope": "this API process only", "since": "…", "note": "…" },
  "lookupsByState": { "clean": 1, "unknown": 1 },
  "registry": { "source": "arkiv", "entries": 0, "verdictHeads": 0, "byState": { … } },
  "omitted": [ "timeToBlock — not measured anywhere yet", … ] }
```

Honest about what it is: the hit rate is **real but narrow** — lookups this process has served since it
started, counted in memory. It resets on restart and is not aggregated across instances, which on
serverless means one warm instance rather than the fleet. Registry counts are real, from the query
builder's `count()` against the chain.

**Numbers that are not real are omitted and named in `omitted`, never invented.** Before this process
has served a single lookup there is no `hitRate` key at all — not a zero.

> **`registry.byState` and `/v1/flagged` can legitimately disagree, and that is not a bug.**
> `byState` is `count()` over on-chain rows; `/v1/flagged` only lists heads that survive
> `parseVerdictHead`. A row the worker wrote with a malformed fingerprint is counted but not served —
> because the gate makes a security decision from a head, so a malformed one must degrade to something
> it treats as `unknown` and never be passed through. Observed live: the leftover probe entity in
> `surex-lisbon-probe-*` has a 16-hex fingerprint, so `byState.flagged` was 1 while the feed was empty.
> If the two disagree in the real project, the worker is writing rows the contract rejects.

### `POST /v1/disputes` — the AgentKit gate

```jsonc
// agent — the address is NOT taken from the body; it is recovered from the signature
// header: agentkit: <base64 payload signed by the agent wallet>
{ "fingerprint": "sxf1_…", "evidence": "…", "contestantType": "agent" }
// human
{ "fingerprint": "sxf1_…", "proof": { …the IDKit result, unmodified… }, "evidence": "…" }
```

The agent path is taken from an explicit `contestantType: "agent"`, an **`agentkit` header**, an
`agentAddress`, or an x402 payment header. Then:

- **agent** → `verifyAgentStanding()`; a confirmed `lookupHuman → 0` is **`403 agent_not_human_backed`**.
  That is the gate.
- **human** → `verifyHumanProof()`; a proof that does not check out is `401 unauthenticated`.
- There must be something to contest: a fingerprint with no live verdict is a `404`, checked **before**
  the identity check so valid standing cannot be used to create registry rows for free.

**Not every refusal is the gate, and the codes say which is which.** With the real verifiers wired, a
refusal is classified by `REFUSAL_STATUS` in `src/verifiers.mjs`:

| what actually happened | code | status |
|---|---|---|
| AgentBook really has no registration for the signer | `agent_not_human_backed` | 403 |
| no `agentkit` header, bad signature, replayed nonce, body/address mismatch | `unauthenticated` | 401 |
| **AgentBook could not be read** (rate limit, dead RPC) | `upstream_unavailable` | 503 |
| this deployment has no World ID relying party configured | `internal` | 500 |

The 503 row is the one that matters. `lookupHuman()` returns `null` for a throttled RPC exactly as it
does for an unregistered agent (FRICTION-LOG **W7**, verified), so a naive implementation tells an
honest human-backed agent that no human stands behind it because *our* RPC was throttled. This API never
does: a `null` is re-read through its own viem client, where a transport failure is an exception, and
only a confirmed `0` becomes a 403. A 401 refusal also carries a `challenge` the agent can sign, so the
refusal is actionable rather than a dead end.

On acceptance, `202` with the state machine stated explicitly:

```jsonc
{ "status": "accepted",
  "dispute": { "id": "sxd1_…", "state": "open", "contestantType": "agent", "standing": { "humanId": "…" } },
  "enforcement": "unchanged — a disputed verdict still blocks; only a human overturn produces a clean head",
  "headTransition": { "from": "flagged", "to": "disputed", "appliedBy": "worker" },
  "persisted": false,
  "note": "Accepted, not stored. This API has no wallet …" }
```

`enforcement` is spelled out in the response so no client implements the wrong one. `persisted: false`
and the absence of any entity key or tx digest are deliberate: this process cannot write, so it returns
no identifier implying it did. `dispute.id` is a deterministic content hash of the submission, not a
chain key.

**Three verifier implementations, and the default is still the stub.** `src/verifiers.mjs`:

| `resolveVerifiers()` sees | picks | behaviour |
|---|---|---|
| nothing | `stub` | refuses both paths, `stub: true` + a `detail` in every refusal so it can never be mistaken for a real lookup |
| `SUREX_MOCK=1` + `SUREX_MOCK_ACCEPT_DISPUTES=1` | `illustrative` | mock-only accept path, grants standing to nobody real, marks everything `illustrative: true` |
| `SUREX_WORLD=1` | `agentbook+idkit` | **the real one.** Wins over the illustrative verifier if both are set — a build configured to check identity will not fake it. A configuration error here falls back to the **stub**, loudly, never to "no check at all" |

#### The agent path, in order

1. `agentkit` header → `parseAgentkitHeader()` → `validateAgentkitMessage()` (domain, resource URI,
   5-minute freshness, single-use nonce).
2. Signature → address. For `eip191` this is **local** `recoverMessageAddress()`: no RPC, so no network
   condition can turn a good signature into a rejected agent. (The SDK's own path routes `eip191`
   through `publicClient.verifyMessage`, which needs a working RPC and returns `{valid:false}` without
   one — the same conflation as W7, one layer up.)
3. An `agentAddress` in the body is a **claim**; if it disagrees with the signature, the signature wins
   and the request is refused. A body-only address never reaches AgentBook at all.
4. Optional `requestId` binds the signature to **this** rebuttal. The AgentKit SIWE message covers
   domain, uri, nonce and time — not the evidence — so without it a captured header could file a
   different dispute until the nonce expires. `scripts/agent-dispute.mjs` always sets it.
5. `lookupHuman(address)` → non-null grants **standing to be heard**. Not access, not a discount, and
   no claim the rebuttal is right. The nonce is burned only on success.

#### The human path, in order

`proof.action` must match the route's action · `proof.environment` must match
`WORLD_ID_ENVIRONMENT` (**a staging proof is a simulator identity; a production deployment refuses it
before it is ever forwarded**) · `signal_hash` must equal `hashToField()` of the signal this request
implies, so one proof cannot be replayed across the registry · then the payload is forwarded
**byte-for-byte** to `POST https://developer.world.org/api/v4/verify/{rp_id}` · then uniqueness ·
then, and only then, acceptance. The nullifier is stored as a **decimal string** and is the only thing
retained about the person.

Uniqueness rules, per tech spec §7.1: `maintainer-submit` is **one per person, ever**;
`contest-verdict` is **N per rolling window** (default 5 / 24 h) — being right twice is not a Sybil, and
one-shot would silence a maintainer. ⚠️ The store is **in-memory, per process**, and says so in the
response: a durable `NUMERIC(78,0) UNIQUE(nullifier, action)` table belongs with the worker, which is
the process that can write.

### `POST /v1/submissions`

**The identity half is built and load-bearing; the ingest half is not.** With the World verifiers wired,
the World ID gate runs first and for real — no proof, wrong action, or a staging proof against a
production deployment never reaches the pipeline. A **valid** proof then gets `501`, not `202`, because
the repo-ownership proof, licence gate, Walrus upload and Arkiv write all need a wallet this process does
not have. The nullifier is deliberately **not spent** in that case: nobody loses their one submission to
a pipeline that never ran.

With the stub verifier the route is unchanged — a flat `501` "not built", which is the whole truth when
no identity implementation exists either.

---

## `POST /a/<slug>/load-model` — the demo-recovery control

The reviewer runs on a home DGX over a tunnel and the tunnel will drop mid-demo. This re-loads the model
remotely instead of someone walking to the laptop.

```bash
curl -X POST -H 'x-surex-admin-password: 123' -H 'content-type: application/json' \
     -d '{"model":"gpt-oss:120b"}' \
     https://<host>/a/$SUREX_ADMIN_SLUG/load-model
```

### Its posture, honestly

**An unguessable path, plus a weak shared password, plus a rate limit, controlling one idempotent action
on our own box. It is a demo control, not a security boundary.** Anyone who learns the slug and the
password can make our own DGX load a model. That is the entire blast radius, and it is why this shape is
acceptable here and would not be acceptable anywhere else. Do not extend it to anything that mutates
registry state.

What it does do:

- **Mounts only if `SUREX_ADMIN_SLUG` is set.** No default is committed and there never will be one — a
  committed default is a published URL. Without the env var there is no admin surface at all, and the
  refusal is logged at boot. A test asserts the source contains no fallback slug, because a future
  `?? 'admin'` would pass every behavioural test.
- **Password in a header** (`x-surex-admin-password`), never a query string — query strings land in
  access logs, referrers and shell history. A password in the query string is rejected.
- **Timing-safe comparison.** Both sides are hashed to a fixed 32 bytes and compared with
  `crypto.timingSafeEqual`. The hashing is what makes it safe to call with different-length inputs: raw
  `timingSafeEqual` throws on a length mismatch, and catching that throw leaks the length through
  control flow.
- **Rate limited** (default 5/minute per IP, `SUREX_ADMIN_RATE_LIMIT` / `SUREX_ADMIN_RATE_WINDOW_MS`),
  then `429 rate_limited` with `Retry-After`. **The limit is checked before the password**, so it limits
  guessing and not merely authenticated calls. Two honest limitations: the counter is in process memory,
  so on serverless the effective limit is (limit × warm instances); and the bucket key comes from
  `x-forwarded-for`, which Vercel overwrites and therefore trusts, but which is client-supplied if this
  runs directly on a public port. Adequate for one idempotent action on our own box; not a defence
  against a distributed attacker.
- **Reports what actually happened**, including failures: HTTP status, elapsed ms, the reviewer's own
  error, and the underlying `cause.code` (`ECONNREFUSED` — the reviewer is down — versus `ENOTFOUND` —
  the tunnel hostname is gone; for a recovery control that difference is the whole diagnosis). A
  reviewer failure returns `502`, never a cheerful 200. The worst outcome for a recovery control is a
  button that says OK and did nothing.
- **Will not guess a model id.** No `model` in the body and no `SUREX_REVIEWER_MODEL` → `400`.

Mechanism: a minimal ollama/OpenAI-compatible `POST <reviewer>/v1/chat/completions` with
`max_tokens: 1`. One token of work; the resident model is the side effect we want. Idempotent.

---

## Environment

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `4310` | local server port |
| `SUREX_MOCK` | — | `1` → fixtures only, no Arkiv connection, everything marked `illustrative` |
| `ARKIV_RPC_URL` | `https://braga.hoodi.arkiv.network/rpc` | Braga, chain id `60138453102` |
| `SUREX_WRITER_ADDRESS` | `0xBD33E1855F68Ce2DF1979377f3bc9fCaCd0015e6` | **the `.createdBy` filter.** Load-bearing security; the store refuses to start without a valid one |
| `SUREX_ARKIV_PROJECT` | `surex-lisbon` | the `project` attribute scoping every query — **must match what the worker writes** |
| `SUREX_ARKIV_TIMEOUT_MS` | `GATE_BUDGET.networkTimeoutMs` (1500) | RPC timeout. Defaults to the **gate's own** hot-path budget on purpose: the gate gives up at 1500 ms and fails open, so a longer timeout here is work nobody is still waiting for. Measured Braga reads are ~100–180 ms |
| `SUREX_ADMIN_SLUG` | *none* | no value → admin route not mounted |
| `SUREX_ADMIN_PASSWORD` | `123` | demo password, timing-safe compare |
| `SUREX_ADMIN_RATE_LIMIT` / `..._RATE_WINDOW_MS` | `5` / `60000` | per-IP limit on the admin route |
| `SUREX_REVIEWER_BASE_URL` | *none* | the DGX reviewer, ollama-compatible |
| `SUREX_REVIEWER_MODEL` | *none* | default model id for `load-model` |
| `SUREX_ADMIN_LOAD_TIMEOUT_MS` | `120000` | a cold large model over a tunnel is not a 5-second operation |
| `SUREX_MOCK_ACCEPT_DISPUTES` | — | `1` **with** `SUREX_MOCK=1` → illustrative dispute accept path |
| `SUREX_CORS_ORIGIN` | `*` | it is a public read API |
| `SUREX_WALRUS_AGGREGATOR` / `SUREX_SUI_EXPLORER_BASE` / `SUREX_ARKIV_EXPLORER_BASE` | public defaults | link and evidence-fetch bases |

### World

| Variable | Default | What it does |
|---|---|---|
| `SUREX_WORLD` | — | `1` → the real verifiers. Without it the stub refuses everything |
| `SUREX_WORLD_RPC_URL` | `https://worldchain-mainnet.g.alchemy.com/public` | **set this before any demo.** The default is the shared public endpoint. It is passed *explicitly* rather than left to viem's chain default (W5), and a throttled read is reported as `upstream_unavailable` rather than as a refused agent (W7) — but that is still a failed dispute |
| `SUREX_AGENTBOOK_NETWORK` | `worldchain-480` | `worldchain-480` or `base-sepolia-84532`. An unknown value fails to the stub rather than silently using the canonical one |
| `SUREX_AGENTBOOK_ADDRESS` | `0xA23aB2712eA7BBa896930544C7d6636a96b944dA` | same address on both deployed networks |
| `SUREX_RESOURCE_URI` | derived from the `Host` header | the resource an agent signs over. **Set it behind a proxy**, or the signed domain will not match and every agent gets a 401 |
| `SUREX_AGENTKIT_NETWORKS` | the network's CAIP-2 | chains the challenge advertises, comma-separated |
| `WORLD_RP_ID` | *none* | `rp_…` from developer.world.org. **Unset → human disputes fail with a configuration error (500), never a pass** |
| `WORLD_APP_ID` | *none* | `app_…`, accepted by the verify endpoint for backward compatibility. Used only if `WORLD_RP_ID` is unset |
| `WORLD_ID_ENVIRONMENT` | `production` | proofs from any other environment are refused. Set it to `staging` only on a deployment where simulator identities are acceptable |
| `SUREX_DISPUTES_PER_WINDOW` / `SUREX_DISPUTE_WINDOW_MS` | `5` / `86400000` | the rolling window for `contest-verdict` |
| `SUREX_WORLD_VERIFY_TIMEOUT_MS` | `8000` | timeout on the World verify call |

**No private key. Ever.** If you find yourself wanting one here, the change belongs in the worker. The
World lane keeps this true: the agent signs its own requests in its own process, and the World ID relying
party signing key lives in the **web** app, not here — this process holds no World secret at all.

#### Is there a no-Orb testnet path? Read this before hoping.

Registering an agent needs an **Orb-verified World ID** on a phone: the contract checks `groupId = 1` and
only Orb credentials exist on chain. **Reading** AgentBook needs nothing, which is why the whole agent
gate is testable today (`node apps/api/test/world-live.smoke.mjs`).

There *is* a second AgentBook, and the "World Chain mainnet only" claim everyone repeats is false. What
we could confirm on 2026-07-25, by RPC and explorer:

- **Base Sepolia 84532, same address `0xA23aB…944dA`** — deployed, verified on Blockscout as `AgentBook`,
  `groupId() = 1`, `worldIdRouter() = 0x42FF98C4E85212a5D31358ACbFe76a621b50fC02` (the documented Base
  Sepolia **testnet** router). So it really is wired to the World ID test tree.
- **And it has never been used.** Its entire log history is two deployment events. **Zero
  `AgentRegistered`.**
- **Base mainnet 8453 has no contract at that address.** If a Base mainnet deployment exists it is
  elsewhere and we could not find it — **UNVERIFIED**.

**Verdict: not usable as a no-Orb path today, and we did not get it to work.** Three blockers, only the
first of which is ours: the CLI cannot target it (no `--network` in 0.2.0 — W2), so you would reimplement
`register(agent, root, nonce, nullifierHash, proof)`; the proof must satisfy an `externalNullifierHash`
derived from **World's own** app id and `agentbook-registration` action, and whether a simulator will
issue a staging proof for someone else's app is not something we could establish; and `lookupHuman`
resolves against World Chain 480 unless a custom client is injected, so a Base Sepolia registration is
invisible to a default integration. `SUREX_AGENTBOOK_NETWORK=base-sepolia-84532` exists so the question
stays testable, not because it works. FRICTION-LOG **W8** has the reads.

---

## Tests

```bash
node --test apps/api/test/*.test.mjs     # 62 assertions, ~400 ms, no network
```

`test/live-arkiv.smoke.mjs` is deliberately **not** named `*.test.mjs` so the unit suite stays hermetic.
It reads only — no key, nothing written.

### Verifying against Braga

```bash
node apps/api/test/live-arkiv.smoke.mjs
SUREX_ARKIV_PROJECT=surex-lisbon-probe-xxxx node apps/api/test/live-arkiv.smoke.mjs
```

It proves the RPC answers with the right chain id, the hot-path query runs and a miss becomes the
`unknown` head, `count()` returns real numbers for `/v1/stats`, a direct key read refuses an entity our
writer did not create, and — the load-bearing one — **`.createdBy` still partitions our writer from the
foreign wallet in both directions**. If that ever stops holding, anyone can plant a `clean` verdict for
a flagged fingerprint and the gate reads theirs.

---

## Deploying

`vercel.json` rewrites every path to `api/index.mjs`, which serves the same Hono app the tests exercise.
**Node runtime, deliberately not edge** — `node:crypto`, the Arkiv SDK's viem transport and JSON import
attributes all need it. `hono/vercel` is the *Edge* adapter; the Node one is `@hono/node-server/vercel`,
and the two are one character apart in an import (FRICTION-LOG V2). Fixtures are pulled in by static
`import … with { type: 'json' }` and listed in `includeFiles`, because a `readdir` in a serverless
function is how you find out at demo time that the files were not deployed.

**Not verified on Vercel yet — this config is written, not deployed.** Two things to expect when someone
does deploy it: the pnpm workspace dependency on `@surex/core` needs the install to happen at the repo
root (Root Directory `apps/api` with the install command run from the root, or a root-level
`vercel.json`), and this repo's `.npmrc` sets `node-linker=hoisted`, which the deploy inherits. Say it
failed if it fails; do not claim a deploy that has not happened.

## Files

```
src/app.mjs       the Hono app (exported; testable and deployable), cache + telemetry + routes
src/server.mjs    local entry on :4310 via @hono/node-server
src/arkiv.mjs     the read client. .createdBy on every consumer read, client-side sorting, pagination
src/mock.mjs      fixture-backed store for SUREX_MOCK=1
src/verifiers.mjs the identity seam. Stub by default; the World lane replaces two functions
src/admin.mjs     the load-model route, rate limiter, timing-safe compare
src/links.mjs     Sui / Walrus / Arkiv explorer URLs from recorded identifiers
api/index.mjs     Vercel function entry (Node runtime)
fixtures/*.json   six fixtures, one per state
test/*.test.mjs   hermetic suite
test/live-arkiv.smoke.mjs   opt-in live read against Braga
```

## The reviewer, reachable from production

The review model runs on a home NVIDIA DGX, so the deployed API reaches it through a Cloudflare tunnel:

```
Vercel  ──►  https://surex-reviewer.santiagodevrel.dev/v1   (Cloudflare tunnel)
             └─► DGX 127.0.0.1:11500   surex-reviewer-proxy  (systemd, Restart=always)
                 └─► DGX 127.0.0.1:11434   ollama
```

**Nothing reaches ollama without a bearer token.** An open ollama port on a home machine is a free GPU for
whoever finds it, so the proxy checks `Authorization: Bearer` with a timing-safe compare and forwards only
the paths the reviewer actually calls:

| path | |
|---|---|
| `/v1/chat/completions`, `/v1/completions` | the review itself |
| `/v1/models` | the only probe that separates "down" from "loading" (FRICTION-LOG D3) |
| `/api/tags` | cheap liveness |
| **anything else** | **404** — notably `/api/pull`, so nobody can make the box download models |
| `/healthz` | 200 with no auth, and deliberately says nothing about what is behind it |

Request bodies are never logged: they carry the source code being reviewed.

### Env

| | |
|---|---|
| `SUREX_REVIEWER_BASE_URL` | `https://surex-reviewer.santiagodevrel.dev/v1` — with or without the `/v1`, both work |
| `SUREX_REVIEWER_API_KEY` | the proxy's bearer. In `.secrets/`, never here |
| `SUREX_REVIEWER_MODEL` | `qwen3-coder-next:surex32k` |

### Recovering it mid-event

```bash
curl -X POST https://arkiv-surex-api.vercel.app/a/$SUREX_ADMIN_SLUG/load-model \
  -H 'x-surex-admin-password: 123' -H 'content-type: application/json' -d '{}'
```

Verified from production: `loaded: true`, `httpStatus: 200`, 7.5 s. It reports the URL it called, the HTTP
status and the upstream error verbatim, so a failure names its own cause — `ECONNREFUSED` (ollama down) and
`ENOTFOUND` (the tunnel hostname is gone) are different diagnoses.

On the box: `systemctl status surex-reviewer-proxy` · `journalctl -u surex-reviewer-proxy -f`.
