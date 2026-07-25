# Developer feedback — SureX, ETHGlobal Lisbon 2026

We built [**SureX**](https://arkiv-surex.vercel.app) over the weekend: a trust registry for MCP servers, plus a
Claude Code `PreToolUse` hook that stops a flagged tool call and puts the decision to a human. Source goes to **Walrus** as a content-addressed
blob, an open-source model reads it against what the server claims to do, the verdict is written as its own
blob, **Arkiv** holds the queryable head the gate reads, **ENS** addresses every entry as
`sxf1-<40 hex>.surex.eth` through a wildcard offchain resolver on mainnet, and **World** gives a human — or an
AgentBook-registered agent — standing to contest a verdict.

That put us deep enough into three sponsor stacks to find things worth sending back. This document is that.

**How to read it.** It is grouped by whose codebase can act on the finding, and inside each group ordered by
what we think would help them most. Every entry keeps its **repro command** and its **version numbers**,
because "here is the failing case" is the part an engineer can act on and an anecdote is not. **`[VERIFIED]`
means we reproduced it**; anything we only observed once, or took from a vendor's own documentation, says so in
those words and is never rounded up. Where the thing that broke was ours, we say that too — but only when the
shape of the mistake is one your other users will make.

The running lab notebook, with the full narrative and every measurement, is
[`../FRICTION-LOG.md`](../FRICTION-LOG.md); each entry below carries its ID there (S11, W7, E5…). The World
section also exists as a standalone note for the World team at
[`WORLD-FEEDBACK.md`](./WORLD-FEEDBACK.md).

None of this is a complaint. We chose these stacks; most of what follows is one doc line, one error string or
one extra field away from not existing.

---

**Contents**

| | |
|---|---|
| [Sui and Walrus](#sui-and-walrus) | the record layer — S11, S3, S9, S1 + eight one-line fixes |
| [World](#world) | AgentKit / AgentBook / World ID — W14, W1, W7 + the docs surface |
| [ENS](#ens) | offchain resolver and CCIP-Read — E5+E6, E7, E1+E2 |
| [Not event sponsors](#part-two--not-event-sponsors-sent-because-the-team-can-act-on-it) | Arkiv · MCP · Claude Code · Vercel · Next.js/Nextra · ollama |
| [The one we owe back](#the-one-we-owe-back) | we wrote up somebody else's bug and then shipped it ourselves |

---

# Sui and Walrus

> **Versions for everything below:** `@mysten/sui@2.22.1` + `@mysten/walrus@1.2.9`, Node v22.22.3 (and
> v24.18.0 where stated), a Windows 11 laptop and a DGX box, against Sui testnet (`sui-node/1.76.0`,
> chain `69WiPg3D…`) and Walrus testnet (system object `0x6c2547cb…f6af`, package `0x849e95d2…d8cc`, walrus
> epoch 469). Probe: `probes/walrus-write.mjs`. Log entries S1–S11.

## 1. The TS SDK's blob write cannot complete from a residential connection; the HTTP publisher can — `[VERIFIED]` · S11

This is the strongest finding we have for Walrus, because it decides **where a Walrus writer is allowed to
live** and it is invisible until you move one.

Same code, same wallet, same wallet balance, minutes apart, 2026-07-25, two machines:

| | uplink | `walrus.writeRecord` |
|---|---|---|
| laptop | European business connection, public IP `62.48.x` | **succeeds in 32 s** — blob registered and certified |
| DGX | Colombian residential connection, public IP `179.13.x` | **fails in ~23–27 s**, `NotEnoughBlobConfirmationsError: Too many failures while writing blob <id> to nodes` — **4 of 4 attempts** |

**Ruled out, each with its own test** — this is the part that cost the hours, and it is why we are confident
the variable is the uplink:

- **balance** — 0.217 WAL, 0.335 SUI, on the same wallet that had published 20 verdicts hours earlier;
- **Node version** — fails identically on 22.22.3 and 24.18.0;
- **IPv6** — `--dns-result-order=ipv4first` fails the same way;
- **file descriptors** — 500 000 on the DGX that fails, 3 200 on the laptop that succeeds;
- **general connectivity** — the aggregator returns 200 from the DGX throughout.

**Cause:** the SDK uploads slivers **directly to all 101 committee members in parallel**, and a residential
uplink does not complete that.

**The HTTP publisher works from the same machine, in the same minute:**
`PUT https://publisher.walrus-testnet.walrus.space/v1/blobs?epochs=53` returned **HTTP 200 in 14.5 s**, and a
second publisher (`walrus-testnet-publisher.nodes.guru`) in **8.4 s** — both registering blob
`oSWREJlW6I68Q3dAuiqzfGa5ZYEiIxAEsMyNW07bzDE` on chain.

```bash
# from the residential connection, same shell, minutes apart
node probes/walrus-write.mjs          # SDK path  → NotEnoughBlobConfirmationsError, 4/4
curl -i -X PUT "https://publisher.walrus-testnet.walrus.space/v1/blobs?epochs=53&permanent=true" \
  --data-binary @blob.txt             # publisher → HTTP 200 in 14.5 s
```

**What would have prevented it.** The error names neither the network shape the write needs nor the publisher
as the way out, and the docs do not say that direct-to-node upload has an effective bandwidth or
connection-count floor. A one-line hint in the error — *"N of M nodes unreachable; consider the HTTP
publisher"* — turns a dead end into a next step. A sentence in the write docs about which environments the SDK
path assumes would let a team pick the publisher on day one rather than on Saturday night.

**The honest trade in taking the publisher**, recorded because it changes what a record may claim: with the
publisher it is the *publisher's* wallet that registers the blob, so `suiObjectId` and both digests are theirs
and "our wallet registered this" stops being true. The property our gate actually relies on — fetch the bytes
back and recompute the blob ID — is unaffected by who paid.

## 2. Identical bytes deduplicate through the HTTP publisher but not through the TS SDK, so you pay twice — `[VERIFIED]` · S3

Blob IDs are content-derived, so re-storing identical bytes is documented as deduplicating. That is true of the
publisher and **not** of `@mysten/walrus`.

- Publisher, same bytes a second time → `{"alreadyCertified":{"blobId":"-SzjTmx…b2Y","event":{"txDigest":"Frk5H32…JQmd"},"endEpoch":522}}`. No new object, no cost.
- `client.walrus.writeBlobFlow()` on bytes **already certified on chain** → ran the full register + certify, minted a *second* `Blob` object (`0xe0ad0c98…f5e8`) for the same blob ID, and charged **11,312,154 FROST of WAL + 6,163,520 MIST of gas**.

**How we found out:** after our own certify, `getVerifiedBlobStatus({blobId})` returned
`statusEvent.txDigest = Frk5H32…JQmd` — a digest that was **not ours**. It pointed at an earlier publisher
certification of the same blob bytes: the blob was already certified before we paid to certify it.

**Repro:** `node probes/walrus-write.mjs` twice. The probe's payload is deliberately fixed with no timestamp,
so the second run is the same bytes.

**Why it matters:** the SDK is the path you take precisely *because* you care about paying for your own
storage, and dedup turns out to be a publisher behaviour rather than something the protocol does for you.
Anyone assuming otherwise re-buys storage on every retry — including crash-recovery retries, which is exactly
when it happens. On mainnet that is real money.

**What would fix it:** have `writeBlobFlow`/`writeBlob` check blob status after `encode()` and short-circuit,
or expose `skipIfCertified: true`; and say in the docs that `alreadyCertified` is something the publisher does
for you.

## 3. A quilt tells you the patch ids and, separately, the identifiers — and no call gives you both — `[VERIFIED, 49 of 50 records mis-mapped]` · S9

Measured while seeding 50 registry records into one quilt.

`writeFilesFlow()` mirrors `writeBlobFlow()`, so we stepped `encode → register → upload → certify` and called
`flow.listFiles()` expecting the per-patch addresses for the files we passed in, in that order.

`listFiles()` returns `{ id, blobId, blobObject }` — **no `identifier` field at all** — and **not in input
order**. Mapping positionally was correct for **1 of 50**. "Sorted by identifier" was correct for **5 of 50**,
so it is not that either. The result is 50 records each pointing at a different record's bytes, so every
`contentSha256` check fails later — and a failing content check is exactly what tampering looks like.

```js
const flow = client.walrus.writeFilesFlow({ files });       // files[i] identifier = fp_i
await flow.encode(); /* register, upload, certify ... */
const listed = await flow.listFiles();
const back = await client.walrus.getFiles({ ids: listed.map((f) => f.id) });
console.log(await back[0].getIdentifier() === await files[0].getIdentifier()); // -> false
```

**The trap underneath it:** `client.walrus.writeQuilt()` **does** return the mapping — `index.patches[]` carries
both `patchId` and `identifier` — but, exactly like `executeCertify()` (see the one-liners below), it discards
the register and certify transaction digests. So one call gives you provenance without addressing, the other
addressing without provenance, and nothing gives both. Anything that has to cite a record on chain must write
with the flow and then read the mapping back out of the certified quilt, which is what we ended up doing.

**And the ids cannot be re-derived later.** `WalrusFile` exposes `getIdentifier()` but not its own patch id,
and there is no exported encoder from (blobId, index range) to a patch id — `blobIdFromInt` / `blobIdToInt` are
blob-level only. Lose the `listFiles()` output and the patches are unaddressable even though the quilt is
certified on Sui and readable.

**What would fix it:** put `identifier` on the `listFiles()` result. It is one field, it is already in the
quilt index the SDK just parsed, and its absence turns the natural way to write a quilt into silent data
corruption. Failing that, have `writeQuilt()` return the two digests so at least one call is complete.

## 4. The testnet SUI faucet is effectively unusable at an event, and its `retry-after` is fiction — `[VERIFIED]` · S1

The single thing most likely to cost a team their Saturday.

- `POST https://faucet.testnet.sui.io/v2/gas` returned **`429` continuously for ~7 minutes**. The body and the
  `retry-after` header said **`Wait for 0s`**, `1s`, `2s`, `3s`, `4s`, seemingly at random, and honouring that
  value never once worked. Success came on **attempt 53** of a blind 8-second retry loop.
- **It is not per-IP.** The identical request from a completely different egress (Colombia, versus the venue NAT
  in Lisbon, `colo=LIS`) got `429 … Wait for 0s` on the *first* try from that fresh IP. A venue cannot route
  around it.
- **The SDK makes it worse:** `requestSuiFromFaucetV2` throws
  `FaucetRateLimitError: "Too many requests from this client have been sent to the faucet. Please retry later"`
  and **discards the `retry-after` header**. From TypeScript there is no way to tell a 3-second throttle from a
  daily ban, so the natural reaction is to give up on a faucet that would have worked five minutes later.

```bash
curl -i -X POST https://faucet.testnet.sui.io/v2/gas -H 'Content-Type: application/json' \
  -d '{"FixedAmountRequest":{"recipient":"0x79d8e8063dd83035f72b5b7c464474ad737c9a17f994611781f91ec2c479ff35"}}'
# → HTTP 429, retry-after: 3, body "Too Many Requests! Wait for 3s"   (repeat for 7 min)
```

**What would fix it:** return a real `retry-after` / `x-ratelimit-reset`, propagate it onto `FaucetRateLimitError`
as a field, and give hackathons an event-scoped quota or a per-address rather than global bucket. A
"retry in N seconds" that is actually true removes the entire failure mode.

## Eight things that are one line each

- **`epochs` out of range returns HTTP 500 with a raw Move abort, and the real maximum is not the documented
  one** — `[VERIFIED]` · S2. `?epochs=183` (the number in our briefing and several doc pages) →
  `{"error":{"status":"INTERNAL","code":500,"message":"client internal error: … reserve_space … EInvalidEpochsAhead"}}`.
  A user input error reported as an internal error. The real ceiling, read on chain, is
  `max_epochs_ahead = 53` — `SystemStateInner.future_accounting.length`. `epochs=53` succeeded immediately.
  There is no other way to learn it: `GET https://publisher.walrus-testnet.walrus.space/v1/info` **404s** and
  `WalrusClient.systemState()` does not surface it as a named field.
  Repro: `curl -X PUT "https://publisher.walrus-testnet.walrus.space/v1/blobs?epochs=183&permanent=true" --data-binary @blob.txt`.
  Fix: `400` with *"max epochs is 53"*, serve `/v1/info` on publishers, and expose `maxEpochsAhead` on
  `systemState()` so nobody has to learn that a ring buffer length is a policy limit.
- **`flow.executeCertify()` throws away the certify transaction digest** — `[VERIFIED, from the shipped source]` · S4.
  `executeRegister` returns `{step:'registered', blobId, blobObjectId, txDigest}`; `executeCertify` returns
  `{step:'certified', blobId, blobObjectId, blobObject}` for the same blob, and the implementation drops its
  own `executeTransaction` return value. A blob's on-chain provenance is *both* transactions, so anything recording
  provenance cannot use the ergonomic API at all — you drop to `flow.certify()` and execute it yourself.
  One field, and the value is already in hand.
- **`client.core.getObject({ objectId, version })` silently ignores `version`** — `[VERIFIED]` · S5.
  Asking for `952302826` returns `952302828`. Our history walker looped on the same transaction ten times
  before we noticed the version never moved. Honour it, or reject unsupported options loudly — a silently
  ignored argument that changes the meaning of the result is worse than an unimplemented one.
  ```js
  const at = await client.core.getObject({ objectId: OBJ, version: '952302826', include: { previousTransaction: true } });
  console.log(at.object.version); // → 952302828
  ```
- **JSON-RPC is not "deprecated" on testnet — it is gone, and it 404s with an empty body** — `[VERIFIED]` · S6.
  `POST https://fullnode.testnet.sui.io:443` with `{"method":"sui_getChainIdentifier"}` → **HTTP 404,
  `Content-Length: 0`**, server `sui-node/1.76.0`. No JSON, no error object, no pointer to the replacement. An
  empty 404 from a *correct* URL reads like a network fault, not an API removal — and essentially every
  pre-2026 tutorial and LLM completion for "query Sui transaction history" emits JSON-RPC. A JSON error body
  (`{"error":"JSON-RPC was removed in <version>; use gRPC at …"}`) saves every migrating developer the same
  twenty minutes.
- **Quilt is not an optimisation on testnet; without it a 50-record seed does not fit in the wallet** —
  `[VERIFIED, measured both ways]` · S10. One quilt: 50 record bodies, 49,968 bytes, 53 epochs → **2 Sui
  transactions**, 8,157,120 MIST of gas and 11,312,154 FROST of storage. The same 50 records as standalone
  blobs would have been **100 transactions and 565,607,700 FROST**, against a funded balance of **488,687,846
  FROST** — it would not have been slower or dearer, it would **not have fitted**, dying around record 43 with
  a half-populated registry and a faucet that takes 53 blind attempts to answer. The docs frame Quilt as a cost
  optimisation for small blobs, which reads as advice you can defer. Worth saying in the docs in the terms
  above.
- **Storage is billed per storage unit, not per byte** — `[VERIFIED]` · S8/S10. `storageCost()` quotes an
  identical `storage=10901835 write=410319 total=11312154` for 4 KB, 64 KB and 256 KB, and our 129-byte blob
  was billed on an encoded length of 66,034,000. Correct behaviour, surprising the first time; one sentence in
  the cost docs would land it.
- **`Ed25519Keypair.generate()` dies with an error that names neither the SDK nor the culprit** —
  `[OBSERVED, NOT MINIMALLY REPRODUCED — stated as such deliberately]` · S7.
  `TypeError: ed25519.utils.randomSecretKey is not a function` at
  `@mysten/sui/dist/keypairs/ed25519/keypair.mjs:44`, because `@noble/curves@1.9.1` (pulled in by `viem` → `ox`)
  had won top-level resolution where `@mysten/sui@2.22.1` requires `^2.2.0`. We could **not** reduce it to a
  clean-room repro — three attempts all resolved 2.2.0 and worked; our tree got there through mixed npm/pnpm
  installs. So the skew is real, the exact install sequence is not pinned down, and we are not claiming more
  than that. **The sponsor-actionable half is the error quality:** given that Sui SDK + `viem` in one
  `node_modules` is the *normal* case at a multi-chain hackathon, an import-time guard —
  `if (typeof ed25519.utils.randomSecretKey !== 'function') throw new Error('@mysten/sui requires @noble/curves ^2.2.0; found an incompatible copy')`
  — turns a thirty-minute dig into a one-line fix.
- **A blob ID is not `sha256(bytes)`**, and it took a measurement to be sure — S8. For our payload, blobId
  `-SzjTmxUSjs01bmC2AZ48iqz-fTCcllwcLu3nc2rb2Y` against sha256/base64url
  `8EV8MBKjUbid8poZDYGJWVB0zy_oQ9ha7_gEfMH_Ktc`. Deriving it needs the Walrus WASM encoder, which we vendored
  (376 KB, Apache-2.0): with `n_shards = 1000` and encoding `RS2`, `BlobEncoder.compute_metadata()` reproduces
  the on-chain ID exactly and one flipped bit does not. That property is load-bearing for us — it is how the
  gate checks fetched bytes against the ID without depending on the aggregator or on our own API. Stating it
  plainly next to the blob-ID docs, with the shard count as an input, would help anyone building the same
  check.

## What worked, recorded so nobody re-litigates it

One blob write really is two Sui transactions and the register step is a PTB (`reserve_space` +
`register_blob`, 4,683,480 MIST), then `certify_blob` (1,480,040 MIST) — exactly as documented. Nothing needs
hardcoding: `TESTNET_WALRUS_PACKAGE_CONFIG` gives the system object and the SUI→WAL `exchangeIds`, and the
exchange *package* id falls out of the on-chain type of the exchange object. And read-after-certify needed no
retry at all — the public aggregator served the blob on the first attempt, every time.

---

# World

> **Versions:** `@worldcoin/agentkit@0.2.0`, `@worldcoin/agentkit-core@0.2.0`, `@worldcoin/agentkit-cli@0.2.0`,
> `@x402/hono@2.19.0`, `@worldcoin/idkit@4.2.1`, `@worldcoin/idkit-core@4.2.2`; World Chain 480, Base Sepolia
> 84532. Live smoke: `node apps/api/test/world-live.smoke.mjs`. Log entries W1–W16, and the standalone note for
> the World team is [`WORLD-FEEDBACK.md`](./WORLD-FEEDBACK.md).

Our integration is live and correct in both directions: a signed request from an unregistered wallet gets
`403 agent_not_human_backed` with the honest reason, and a registered wallet gets `202` with AgentBook
standing.

## 1. `register()` reverts `NonExistentRoot()` while the World Chain root has not caught up, and the CLI cannot decode it — `[VERIFIED on chain]` · W14

The last step of the whole AgentKit flow, with everything upstream working, failing as an undecodable selector
under a misleading hint.

The World ID verify **succeeded** — real Orb scan, valid Merkle root, valid nullifier, full 8-element ZK proof.
Then the on-chain `register()` **reverted**, and the CLI could not decode the error:

> `The contract function "register" reverted … 0xddae3b71 … not found on the provided ABI`

We decoded it ourselves: `keccak256("NonExistentRoot()")[:4] = 0xddae3b71`. Read live on World Chain 480:

- `AgentBook(0xA23aB2712eA7BBa896930544C7d6636a96b944dA).worldIdRouter()` = `0x17B354dD2595411ff79041f930e491A4Df39A278`
- `router.routeFor(1)` = `0xdFCa0A882eF7793485B3d052142B60647E82009E` (the group-1 identity manager)
- its `latestRoot()` = `12796…349`; the proof's root = `13007…511`; `checkValidRoot(proofRoot)` **reverts**

The tree is live and a real third-party registration exists on the same contract, so the router works — the
proof's root simply was not yet in World Chain's group-1 history. **It cleared on its own** once the root
advanced: the same command then landed, tx
`0xaa4c255c5edb7c973452a264184076dca73cfc051c019e0a1c7837a54b0fd870`, `status: registered`, and our live
dispute flow flipped `403 → 202`. So the fix was "wait for the bridge", and nothing told us that.

**Repro:** `npx @worldcoin/agentkit-cli register <address>` with a valid Orb credential while the World Chain
group-1 `latestRoot()` is behind the root World App anchors against; compare `router.checkValidRoot(proofRoot)`
on 480.

**What would have prevented the hours:**

1. **Decode the revert.** *"The proof root has not propagated to World Chain yet — retry shortly"* instead of a
   raw `0xddae3b71` makes this a two-minute wait.
2. **The CLI's own hint points the wrong way.** It lists *"the World ID used is not Orb-verified"* as a likely
   cause. It was a perfectly good Orb ID, and a team that trusts the hint re-scans a working credential for
   hours.
3. **Document the root-propagation delay** next to the AgentBook quickstart, with where to watch it.

## 2. `agentkit.fetch` silently does nothing against the current `@x402/hono` — `[VERIFIED, reproduced locally]` · W1

Costs a team their whole demo, at night, with no error to search for.

`createAgentkitClient({signer}).fetch(url)` is supposed to see a 402, sign, and retry — that is what the
quickstart shows. It does **nothing**: no signature, no retry, no thrown error, and **not a single `onEvent`**.
The raw 402 comes back, which from the outside is indistinguishable from the server rejecting a legitimate
human-backed agent.

**Root cause — version skew.** `@worldcoin/agentkit@0.2.0` reads the challenge from the JSON **body**
(`response.clone().json()` → `.extensions.agentkit`). `@x402/hono@2.19.0` returns body `{}` and puts the
challenge in a base64 **`payment-required` response header**. The extension resolves `undefined` and the client
bails through a silent `return response`.

**Every new team hits this by default:** agentkit declares `"@x402/core": "^2.4.0"`, the caret resolves happily
to 2.19.0, so a clean `npm install` today produces the broken pairing. `@worldcoin/agentkit` has not been
published since 2026-06-22; `@x402/hono@2.19.0` shipped 2026-07-17.

**Workaround we shipped:** `agentkit.createHeader(ext)` is fine — read the challenge from the header yourself
and do the retry by hand. That is what makes our live agent-dispute path work.

**What would fix it:** have `parsePaymentRequired` check the `payment-required` header before falling back to
the body, and emit `onEvent({type:'no_challenge_found'})` on the bail-out path instead of returning silently.
One line on the bail-out would have saved the whole debugging session.

## 3. `lookupHuman()` swallows every error and returns `null` — and `null` is the deny signal — `[VERIFIED, live and from source]` · W7

This is a correctness bug in an authorization primitive rather than a DX annoyance, and it also **corrects our
own earlier W5**, which assumed a throttled RPC would throw.

It never throws. `@worldcoin/agentkit-core@0.2.0`, `src/agent-book.ts`, ends the AgentBook read with a bare
`} catch { return null }`. **Every** failure — HTTP 429, dead endpoint, wrong contract address, even a
mis-checksummed input address — returns exactly what an unregistered agent returns.

```js
import { createAgentBookVerifier } from '@worldcoin/agentkit';
const ok     = createAgentBookVerifier({ rpcUrl: 'https://480.rpc.thirdweb.com' });
const broken = createAgentBookVerifier({ rpcUrl: 'http://127.0.0.1:9' });
await ok.lookupHuman('0xeA7D8B94F6e8044a22738FFe78a2CB356D114171');      // 0x249394758bdbf66…  ✅
await broken.lookupHuman('0xeA7D8B94F6e8044a22738FFe78a2CB356D114171');  // null              ❌ RPC down
await ok.lookupHuman('0xea7d8b94f6E8044A22738fFE78a2cb356D114171');      // null              ❌ bad checksum
```

Ours, runnable: `node apps/api/test/world-live.smoke.mjs`. (`0xea7d…4171` is a real registration read off
`AgentRegistered` logs on World Chain 480, 2026-07-25.)

**Why it matters more than it looks.** `null` is the deny signal. A resource server following the quickstart —
`if (!humanId) return 403` — tells an honest, registered, human-backed agent that no human stands behind it
*because the server's own RPC was throttled*. On a demo day with one shared public RPC that is the single most
likely way an AgentKit integration fails, and it fails silently and wrongly rather than loudly.

**What we shipped instead:** never believe a `null`. On null we re-read `lookupHuman` through our own viem
client where a transport error is an exception; only a confirmed on-chain `0` becomes
`403 agent_not_human_backed`, and a throw becomes `503 upstream_unavailable` with *"standing is UNKNOWN — this
is not a refusal"* (`apps/api/src/verifiers.mjs` → `lookupHumanStrict()`).

**What would fix it:** return `{ humanId | null, error? }`, or throw on transport failures and reserve `null`
for `0n`. Either way — a library whose deny answer is indistinguishable from its error answer cannot be used
for authorization, and the quickstart's `if (!humanId) reject()` line teaches exactly the unsafe usage. Even a
bare `catch (e) { throw e }` would be a strict improvement.

## The documentation surface — each of these is a doc line away from gone

- **W2 · The CLI's own docs contradict the shipped binary** — `[VERIFIED]`. `cli/README.md` on npm and
  `cli/REGISTRATION.md` on GitHub `main` both document `--network base | base-sepolia` and say the CLI
  *"defaults to `base`"*. The shipped `0.2.0` binary has **no `network` option in its arg schema** and
  hardcodes `viem/chains` `worldchain`, `eip155:480` and `0xA23aB…944dA`; passing the documented flag fails.
  Found by reading `cli/package/dist/index.js` after the flag was rejected. The live docs page agrees with the
  code — it is the npm README and REGISTRATION.md that are stale Base-era docs, and they are the first thing a
  new dev reads.
- **W3 · "Orb required" is the single most important fact and it is not where you look first.** Registration
  verifies `groupId = 1` on chain and only Orb credentials exist on chain, so a device-level or Selfie Check
  credential **cannot** register an agent; the CLI passes no `verification_level` and defaults to `orb`
  silently. This is a hard physical dependency on an Orb-verified human — a team that discovers it on Sunday
  has no qualifying submission. It belongs in the first paragraph of the AgentKit quickstart, in bold, not
  inferred from a contracts reference page.
- **W9 · The agent's request header is `agentkit`, and nothing says so where you look.** No page we found names
  it; the only source of truth is the SDK, where the client does `headers.set(AGENTKIT, header)` and
  `AGENTKIT = 'agentkit'` lives in `agentkit-core`. It cost us a route that classified a correctly signed agent
  as a *human* — it only looked for `x-payment` — and refused it for having no World ID proof. A
  wrong-and-confident 401. Worth stating next to `createHeader` in the SDK reference, along with the fact that
  `createHeader` is usable standalone: the docs only show it via `agentkit.fetch`, which is broken (W1), so the
  working path is currently the undocumented one.
- **W10 · Two documented test environments that contradict each other, and an OpenAPI enum that omits one** —
  `[VERIFIED against the live endpoint]`. `world-id/idkit/integrate` step 4 says use the simulator with
  `environment: "staging"`; the `world-id/sandbox/*` pages say Sandbox is the integration-testing environment
  with `environment: "sandbox"`, installed via TestFlight or a Firebase link you must ask a World contact for.
  Neither page mentions the other, and their setup costs are wildly different. Meanwhile the published
  `POST /api/v4/verify/{rp_id}` OpenAPI spec documents `environment` as `production | staging` only, while
  `IDKitRequestConfig` in `@worldcoin/idkit-core@4.2.2` types it as `production | staging | sandbox` — and the
  live endpoint **accepts `sandbox`**, so a client generated from the published spec rejects the value the
  Sandbox guide tells you to send.
  ```bash
  # 400 all_verifications_failed → the envelope was accepted; only our synthetic proof failed
  curl -s -X POST https://developer.world.org/api/v4/verify/app_a7c3e2b6b83927251a0db5345bd7146a \
    -H 'content-type: application/json' \
    -d '{"protocol_version":"3.0","nonce":"1","action":"agentbook-registration","environment":"sandbox","responses":[{"identifier":"orb","merkle_root":"0x0","nullifier":"0x1","proof":"0x2"}]}'
  ```
  Add `environment` to the verify enum, and put one line at the top of both pages saying which environment a
  new integration should use in July 2026.
- **W11 · `verification_level` is gone, and every third-party snippet still uses it.** IDKit 4.x replaces it
  with presets — `deviceLegacy({ signal })`, which additionally requires `allow_legacy_proofs: true` or
  TypeScript fails on a missing prop. The mapping table exists, but only on `world-id/from-idkit-standalone`, a
  *migration* page a new integration has no reason to open, while `world-id/idkit/credentials` shows only
  `orbLegacy` and `proofOfHuman`. `deviceLegacy` is the preset a lot of real integrations need and the hardest
  one to find.
- **W12 · `hashSignal` is not importable server-side without pulling in a browser SDK.** Enforcing the `signal`
  binding server-side means recomputing `hashToField(signal)` and comparing it to `signal_hash` — the docs say
  *"the backend should enforce the same value"*, but the only shipped implementation lives in
  `@worldcoin/idkit-core`, which a read-only backend has no other reason to depend on. We reimplemented it
  (`keccak256(bytes) >> 8`, left-padded to 32 bytes) and cross-checked against `hashSignal` on four vectors
  including the documented empty-signal default `0x00c5d246…85a4`. It matches — but every backend team will
  either redo this or skip the check, and skipping it is the difference between a proof bound to one dispute
  and a proof replayable across a whole registry. Publishing it in a server-shaped package
  (`@worldcoin/idkit-server` already exists and already carries `signRequest`) and stating the shift-right-8
  formula in the verify reference is two lines of prose.
- **W13 · `humanId` is returned unpadded.** `lookupHuman` returns `toHex(uint256)`, which drops leading zeros:
  the same registration reads as `0x1c2d8c2a0abcd…` from the SDK and `0x01c2d8c2a0abcd…` from the
  `AgentRegistered` event topic. Anyone using it as a map key, a database key or a cross-check against the
  event gets two identities for one human depending on where they read it. Zero-pad to 32 bytes, or document it
  as a numeric value rather than a hash-shaped string.
- **W4 + W8 · There is a Base Sepolia AgentBook, it is correctly wired, and it has never been used** —
  `[VERIFIED by RPC]`. `eth_getCode` at `0xA23aB…944dA` on 84532 returns 3,569 bytes, Blockscout has it
  verified as `AgentBook`, `worldIdRouter()` is the documented Base **Sepolia testnet** WorldIDRouter and
  `groupId()` is `1` — genuinely pointed at the World ID testnet tree, with an `externalNullifierHash`
  byte-identical to mainnet's. **But its entire log history is two deployment events and zero
  `AgentRegistered`.** So it is not usable as a no-Orb path today, and three things block it: the CLI cannot
  target it (W2), the proof must satisfy an `externalNullifierHash` derived from *World's own* app id and
  action, and `lookupHuman` resolves against World Chain 480 unless you inject a client. **The ask for the
  booth:** is it supported, abandoned, or a staging artifact? It is discoverable and verified on a public
  explorer, teams *will* find it and build on it, and documenting it as a testnet path would remove the biggest
  onboarding blocker AgentKit has. Saying plainly that it is unsupported would also be fine. The current
  silence is the worst of the three.
- **W15 · The documented failure mode for a Face-Check-disabled app is *nothing happens*** —
  **[NOT reproduced by us; taken from World's own docs, and labelled that way on purpose]**. Switching
  `/submit` and `/d/[fp]` from `deviceLegacy` to `selfieCheckLegacy` was genuinely one line, and
  `world-id/idkit/credentials#selfie-check` gives the exact React call correctly — credit where it is due.
  What is not documented next to it is that Selfie Check is gated per app (`enable_face_check`), and World's
  own gotcha table describes the failure as *"Face Check appears unresponsive or never starts"*. A silent no-op
  is the worst available failure mode for a beta feature behind an entitlement: no error code, nothing in
  `onError`, and nothing distinguishing "not entitled" from "the user closed the sheet". We could not reproduce
  either branch — our app *is* enabled, and completing the flow needs a phone with World App, so we have
  exercised the code path and the request shape and not the camera. **Fix:** reject the request with a named
  code (`credential_not_enabled`) the way `user_presence_failed` exists for a failed liveness step; failing
  that, put the `enable_face_check` precondition in the Selfie Check section of `idkit/credentials`, not only
  in a separate skill page's gotcha table.
- **W16 · The only full-narrative React example for `selfieCheckLegacy` pairs it with the invite-code widget,
  which reads as a requirement.** `world-id/idkit/react` shows the before/after as `orbLegacy` +
  `IDKitRequestWidget` → `selfieCheckLegacy` + `IDKitInviteCodeRequestWidget`. Two things change in one diff
  while the prose explains only the component swap, so read quickly — which is how a migration snippet is read
  — it says Selfie Check needs the invite-code widget. It does not; the plain `IDKitRequestWidget` is what
  `idkit/credentials` uses and what we shipped and type-checked. Nothing broke; it was a twenty-minute detour
  that costs nothing to remove by keeping the credential constant across the example.
- **W6 · Name collision with `@coinbase/agentkit`.** Searching "agentkit testnet" lands there first. A
  disambiguation line in the docs and in the npm description would have saved us the time it cost.
- **W5 · `createAgentBookVerifier` defaults to a shared public RPC.** Recommending `rpcUrl` explicitly next to
  the first code sample is one line, and it matters more given W7 above.

---

# ENS

> **Versions:** `@adraffy/ens-normalize@1.11.1`, `viem@2.55.8`, `ethers@6.13.5`, `solc@0.8.28`, Node v22.22.2.
> Probe for every entry: `node probes/ens-resolve.mjs <labels|contract|mock|gateway|sepolia>` after
> `cd probes && pnpm install --ignore-workspace`. Log entries E1–E7.
>
> For context on what we built: `surex.eth` on mainnet with a wildcard offchain resolver
> (`SureXOffchainResolver` at `0xCb140fF30c449c3782D96Bfa356cDDE8E33b2559`) plus a CCIP-Read gateway, so a
> registry entry can be read as `sxf1-<40 hex>.surex.eth` with no integration on the reader's side.
> **Wildcard resolution is proven live on mainnet:** `getEnsResolver` on a subname that was never registered
> returns our contract through the standard Universal Resolver, and `resolve()` reverts with a genuine
> `OffchainLookup` carrying the gateway URL. The gateway route itself ships with the web deploy — and one
> sharp edge there is worth its own line: with the gateway 404ing, viem's `getEnsText` returns `null` rather
> than throwing, so **a dead gateway is indistinguishable from an empty record** client-side.

## 1. `.eth` registration on Sepolia has been broken network-wide since early June 2026, and the published manifest points at the controller that has never worked — `[VERIFIED from on-chain history]` · E5 + E6

Critical for anyone developing against ENS on a testnet, and it is not specific to us: **nobody** has
registered a `.eth` name on Sepolia in seven weeks.

Every `register` reverts with **bare `0x`** — no revert string, no error selector — while the commitment is
valid and mature, `available()` and `valid()` both return true, and the value sent exceeds `rentPrice`. We
rebuilt the commitment hash on chain and confirmed it matched byte for byte.

We stopped debugging our own call and read other people's. Counting `register` calls (`0x74694a2b`,
`0xef9c8805`) in the most recent 200 transactions to each controller:

| Controller | register calls | succeeded | failed | last success |
|---|---|---|---|---|
| `0xFED6a969…` (wrapper-era) | 67 | 54 | 13 | **2026-05-24** |
| `0xfb3cE5D0…` (current, per ENS's own manifest) | 32 | **0** | 32 | **never** |
| `0x7e02892c…` (legacy) | 3 | 3 | 0 | — |

Successes on `0xFED6a969…` run 2026-02-07 → 2026-05-24; failures start 2026-06-02; nothing has succeeded on
any controller since **2026-06-15**.

**Root cause as far as we can see from outside:** `BaseRegistrarImplementation.controllers()` returns `false`
for the NameWrapper and for every controller in ENS's published Sepolia deployment. The registrar that owns the
`.eth` node no longer authorises the contracts that register into it, so every attempt dies in `onlyController`
— a bare `require`, hence the empty revert data.

**And the manifest is the thing an integrator is supposed to trust.**
`ensdomains/ens-contracts@deployments/sepolia/ETHRegistrarController.json` names
`0xfb3cE5D01e0f33f41DbB39035dB9745962F1f968`, which is 0-for-32 and unauthorised on the registrar; the one that
used to work is not in that file. A deployed-but-unauthorised address is indistinguishable from a working one
until you spend gas.

```bash
cast call 0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85 'controllers(address)(bool)' \
  0x0635513f179D50A207757E05759CbD106d7dFcE8 --rpc-url https://sepolia.drpc.org   # → false
curl -s "https://eth-sepolia.blockscout.com/api?module=account&action=txlist\
&address=0xFED6a969AaA60E4961FCD3EBF1A2e8913ac65B72&sort=desc&offset=200"
gh api repos/ensdomains/ens-contracts/contents/deployments/sepolia/ETHRegistrarController.json
```

**What made it expensive:** `commit()` still succeeds. We counted **53 successful commits** on a controller
that has never completed a registration — users paying gas for the first half of a two-step flow that cannot
finish, and the second half failing with no message.

**What would fix it, in order:** re-authorise a controller on the Sepolia registrar so the testnet works at
all; then make `register` fail loudly — the current controller declares eleven custom errors
(`NameNotAvailable`, `InsufficientValue`, `CommitmentTooNew`…) and this path returns none of them, because the
failure happens one contract deeper. A `ControllerNotAuthorised()` on the registrar would have saved us most of
an afternoon. Failing that, have `commit()` revert when the controller cannot register, so nobody pays for step
one of a dead flow. And mark unwired deployments in the manifest, or deploy-and-wire in one step.

*(This is why `surex.eth` is registered on mainnet: because Sepolia is broken, not by preference.)*

## 2. An unregistered name renders as registered and owned in the ENS app, because of a reverse record — `[VERIFIED]` · E7

The single most misleading thing we hit all weekend. It sent us down an hour-long wrong path chasing a
migration that had not happened.

`app.ens.dev/surex.eth` showed **Owner `0x9d49…d3e5`, Registered JUL.25.2026, Expires JUL.26.2027** for a name
that was never registered, and `viem.getEnsAddress('surex.eth')` on Sepolia returned that address too. The
account had only ever called `setName(string)` on the reverse registrar — setting a *primary name* pointing at
a name it does not own. No registration transaction exists in its history and no ETH was ever spent on one.

**How we found out:** the on-chain registry disagreed with the app. `registry.owner(namehash)` was zero and
`available()` was true, so we read the account's full transaction list: six transactions, two of them `setName`
(`0xc47f0027`), none of them `register`.

**Repro:** call `setName("<any unregistered name>.eth")` on the Sepolia reverse registrar from a fresh account,
open that name in the app, resolve it with viem, and compare against `registry.owner(namehash(name))`. Control:
an unrelated unregistered name (`definitely-not-registered-zzq7x.eth`) resolves to `null`, so the forward
resolution genuinely comes from the reverse record.

**What would fix it:** do not accept a primary name for a name the account does not own — or, if that is
deliberate, do not render an unowned name with an ownership block and registration dates. **The dates shown
were not real.** A "not registered — claim it" state would be correct and is what the underlying data supports.

## 3. Two label rules that a namespace design will trip over, silently — `[VERIFIED, measured]` · E1 + E2

**E1 — our own published identifier is not a legal ENS label, because of its separator.** An SXF-1 fingerprint
is `sxf1_` + 64 lowercase hex: 69 characters of `[a-z0-9_]`, which reads as conservative. ENSIP-15 rejects it
outright — the underscore is legal only as the **first** character of a label:

```
Invalid label "sxf1_b1dad32ff73fe0791aa5430006…ec235b1af446740e81b53fcef92edb1": underscore allowed only at start
```

`@adraffy/ens-normalize` is a genuinely good library here — the error names the exact rule, which is more than
most validators do. The gap is upstream of it: nothing in the ENS documentation for subname or wildcard designs
mentions that a namespace built on hashes with a conventional separator will not normalise. One sentence in the
ENSIP-10 wildcard docs — *"labels must pass ENSIP-15; `_` is legal only in first position"* — would have saved
the lookup. We shipped `sxf1-` + the first 40 hex characters instead, and return the full fingerprint as the
`surex:fingerprint` text record so the truncation is a naming convenience and never the identity.

**E2 — viem and ethers disagree about how long a label may be, and the disagreement is silent.** Nothing throws
at the boundary; a name simply resolves for some of your users and not others, depending on a library they
chose rather than on anything you did.

| label length | `viem` `packetToBytes` | `ethers` `dnsEncode` |
|---|---|---|
| 45 | ok, 51 bytes | ok, 51 bytes |
| 63 | ok, 69 bytes | ok, 69 bytes |
| **64** | **ok, 70 bytes** | **throws** |
| **69** | **ok, 75 bytes** | **throws** |
| **255** | **ok, 261 bytes** | **throws** |
| 256 | ok, 72 bytes — switches to the ENSIP-10 labelhash form | throws |

ethers' message is clear once you hit it (`label "aaa…" exceeds 63 bytes`, `code: INVALID_ARGUMENT`) and the
limit *is* configurable — `dnsEncode(name, 255)` succeeds — but it is a second positional argument almost
nobody passes, so the default is what ships. We measured across both libraries rather than reading either one's
source, because the question was what real callers would experience.

**Repro for both:** `node probes/ens-resolve.mjs labels` — rows where the two libraries disagree are marked `!`.
We shipped a 45-character label, under both limits, and `apps/web/test/ens.test.mjs` pins it under 64 so a
future encoding change cannot quietly re-enter the disagreement band.

**What would fix it:** ethers defaulting `dnsEncode` to 255 to match ENSIP-10 and the rest of the ecosystem, or
saying in the error that the limit is a parameter. Failing that, both libraries warning in the 64–255 band that
portability is not assured there.

## Adjacent toolchain, not ENS itself

- **Foundry cannot be installed behind a locked-down egress policy, and there is no offline path** —
  `[VERIFIED]` · E4. `foundry.paradigm.xyz` is refused at the proxy (`403` to `CONNECT`) and the fallback of
  pulling release binaries from the `foundry-rs/foundry` GitHub repository is also unavailable in that
  environment. There is no npm-distributed `forge`, so no path uses an already-allowed registry. Low severity
  for us, high for anyone in a managed environment. **Suggestion:** publish `forge` and `anvil` to npm as
  platform-specific optional dependencies, the way esbuild and swc distribute their binaries — it would make
  Foundry installable in every environment that already permits an npm install, which is most of them. Our
  workaround: `probes/ens-resolve.mjs contract` compiles the resolver with solc-js and executes it on
  `@ethereumjs/vm` in process, covering the digest, both interface ids and six `resolveWithProof`
  acceptance/rejection paths; `contracts/test/SureXOffchainResolver.t.sol` stays canonical for anyone who has
  `forge`.
- **solc's legacy code generator cannot copy a nested calldata dynamic array to storage, and the error does not
  name the remedy** — `[VERIFIED]` · E3. `function setUrls(string[] calldata next) external { _urls = next; }`
  → `UnimplementedFeatureError: Copying nested calldata dynamic arrays to storage is not implemented in the old
  code generator.` The message describes the internal limitation and never mentions that `memory` or
  `via_ir = true` resolves it. Appending the remedy to the error string is the whole fix. Repro:
  `node probes/ens-resolve.mjs contract` with the parameter changed back to `calldata`.

## What worked

The ENS reference digest construction —
`keccak256(abi.encodePacked(hex"1900", resolver, expires, keccak256(callData), keccak256(result)))` — is
unambiguous and worked first time, and `0x1900` being EIP-191 v0 "intended validator" is exactly the right
primitive for binding a signature to one resolver. Wildcard resolution behaved precisely as ENSIP-10 describes
once `supportsInterface(0x9061b923)` was in place alongside ERC-165. The one sharp edge worth a doc line:
without that second interface id, clients resolve the parent's records and never call `resolve()`, and nothing
errors — so a misconfigured resolver looks like an empty registry.

---

# Part two — not event sponsors, sent because the team can act on it

These are not Lisbon sponsors. They are in here because we hit them while building, they are reproducible, and
somebody maintains them.

## Arkiv (Braga testnet)

> `@arkiv-network/sdk@0.7.0` (and 0.6.8), `viem@2.55.8`, Node v22.22.3, Braga chainId 60138453102. Repro for
> every entry: `node probes/arkiv-write-read.mjs` with two funded Braga wallets. Log entries A1–A7, V1.

- **`ownedBy` and `createdBy` sit side by side with nothing saying one of them is influenceable by an attacker**
  — `[VERIFIED, exclusion proven end to end]` · A5. Braga is a shared public database with no uniqueness
  constraint on attributes, so anyone can write an entity carrying exactly your `project` + `entityType` +
  `fingerprint`; if a consumer scopes its reads by attributes alone, an attacker picks the answer it gets. We
  proved the partition rather than assuming it: same three attributes, ours `state=flagged severity=4`, an
  attacker's `state=clean severity=0` from a second wallet → unfiltered query returns **2 entities**,
  `.createdBy(WRITER)` returns **1** (ours), `.createdBy(FOREIGN)` returns **1** (theirs), both directions,
  twice, and identically via the non-deprecated `client.select('*')` path. **The docs gap:** `QueryBuilder`
  exposes both filters with near-identical JSDoc, but the wallet client also ships `changeOwnership` — so
  ownership is transferable and an attacker can transfer a crafted entity *to* your address and pass an
  `ownedBy(you)` filter. Creator is immutable. One sentence on `ownedBy()` — *"ownership is transferable via
  `changeOwnership`; use `createdBy`, which is immutable, as the boundary"* — plus the same note next to
  `$owner`/`$creator` in the query docs. Right now the correct choice is discoverable only by noticing that
  `changeOwnership` exists.
- **`QueryResult` pagination fails three ways, and two of them fail silently** — `[VERIFIED live on Braga]` ·
  A6/V1. (1) `hasNextPage` is a **method**, so `while (result.hasNextPage)` reads a function reference, which
  is always truthy. (2) `next()` **mutates in place and returns `undefined`**, so the idiomatic
  `result = await result.next()` sets `result` to `undefined` and the next line throws several frames from the
  cause. (3) Pagination does not exist without an explicit `.limit()` — from the shipped source
  `_endOfIteration = !limit || entities.length < limit`, so with no limit the result declares itself finished
  after one page, and calling `next()` anyway throws `NoCursorOrLimitError`. Fault 3 is the dangerous one: our
  public `/v1/flagged` and `/v1/stats` would have silently served only the first page of a growing registry —
  a flagged server missing from the public feed because it sorted onto page two, with no error and no
  truncation flag.
  ```js
  const r = await pub.buildQuery().where([eq('project', P)]).createdBy(W).fetch();
  typeof r.hasNextPage;   // 'function'  → `if (r.hasNextPage)` is always true
  !!r.hasNextPage;        // true, even on a single complete page
  await r.next();         // undefined   (and `r` itself has already moved on)
  ```
  Fix: return `this` from `next()` so the assignment form works; rename to `hasMore()` or expose it as a getter
  so the property form cannot be misread; and throw at `fetch()` time when a query cannot be paginated, rather
  than returning a silently truncated first page.
- **`orderBy` is on the query builder, is accepted silently, and does nothing** — `[VERIFIED, twice]` · A2. The
  builder exposes `orderBy()` with two overloads plus exported `asc()`/`desc()` helpers, and the chain plumbs
  `orderBy` all the way into the RPC params — nothing at the call site suggests it is inert. Results came back
  in identical order for `asc` and `desc`. The answer is in the source: 0.7.0 marks all three `@deprecated`
  with *"Server-side ordering is not supported by the network"* — but the README's query section still shows
  `orderBy: [{ name: "key", type: "string", desc: "asc" }]` with no warning at all. Don't ship an inert method:
  throw `NotSupportedError`, or drop it from the builder.
- **Three smaller ones.** `0.7.0` stopped re-exporting viem, so every 0.6.x snippet fails at the *import line*
  (`ERR_PACKAGE_PATH_NOT_EXPORTED` for `/accounts`, then no exported `http`) and the package ships no
  `CHANGELOG.md` — two lines would have cost us zero minutes, and a breaking change in a minor bump is a major
  under semver (A1). `expiresIn` must be an even number of seconds, and 0.6.8's silent `Math.ceil` became a
  0.7.0 throw — the error message is genuinely excellent, it explains the *why* (1 block = 2 seconds), but the
  README's write example just passes a number, and the most common value a developer tries (`3600`) happens to
  be legal, so the trap springs later on a computed one (A3). And `createEntity()` **awaits the receipt** —
  ~4.6 s, which the JSDoc reads as a submit — while the indexing lag everyone warns about is ~40 ms to
  `getEntity` and ~80 ms to the query index; meanwhile `mutateEntities({creates})` with **50 creates** also
  returns in ~4.6 s, so the marginal cost inside a batch is roughly zero and a 100-entity seed is ~9 s instead
  of ~7.5 minutes. Saying both in the JSDoc, plus an explicit statement that `createdEntities[]` preserves
  input order (we tested it, 4/4 and then 50/50, because we had to rely on it), is the whole fix (A4, A7).

## MCP — the registry, the SDK, and server identity

- **The official registry does not contain the canonical `@modelcontextprotocol` servers** — `[VERIFIED]` · R1.
  We crawled **795 active rows over 8 pages** and seeded 50 real servers, and not one was a name anyone would
  recognise: `@certscore/mcp`, `@circulara/plugin`, `borealhost-mcp`, `fodda-mcp`. Our first reaction to our
  own output was *"are these placeholders?"* — real data that reads as fabricated, which for a registry is just
  as damaging. Confirmed by search rather than inferred from crawl order: `?search=github` returns three
  Smithery mirrors and forks; `?search=filesystem` and `?search=playwright` likewise; the
  `@modelcontextprotocol/*` packages themselves are absent. Two genuinely canonical entries do exist
  (`io.github.upstash/context7`, `io.github.getsentry/sentry-mcp`), which is what makes this look like an
  onboarding gap rather than policy.
  ```bash
  curl -s 'https://registry.modelcontextprotocol.io/v0/servers?search=github&version=latest&limit=5' | jq -r '.servers[].name'
  ```
  We seeded the well-known servers from **npm** instead and recorded `seedSource: npm`, because an entry that
  lies about where it came from is worse than one nobody recognises. **What would fix it:** publish the
  first-party servers, or rank official publishers above mirrors.
- **An MCP server config is not portable across platforms, and nothing normalises it** — `[VERIFIED]` · C6.
  The same server configured the same way is `{"command":"cmd","args":["/c","npx","@playwright/mcp@latest"]}`
  on Windows and `{"command":"npx","args":["@playwright/mcp@latest"]}` on macOS. The package name is not in the
  same position, and a naive reader of `command` sees `cmd` and learns nothing. Running our fingerprinter over
  a real machine's configuration, every Windows-added server produced `runner: "other:cmd", package: {name: "",
  version: "unpinned"}` — the package identity gone entirely, so a Windows user and a macOS user running the
  same server would never match. Same family: `npx mcp-remote <url>` is a *remote* server wearing a stdio
  costume, and read literally every remote server behind that shim collapses onto the shim's identity.
  **What would fix it:** a documented canonical form for a server definition, or a helper in the spec/SDK that
  returns one. Every tool that reasons about "which server is this" — a registry, an allowlist, a lockfile, a
  policy engine — is re-deriving this and will get it wrong the same way.
  *A second finding from the same run, worth more than the bug:* across 15 real MCP servers in three config
  scopes on a working developer's machine, **not one was version-pinned** — the convention is
  `npx -y pkg@latest`. Any scheme tying a claim to a reviewed *version* is, in the ecosystem as it exists,
  describing code that is not the code about to run. We grade that Tier C and say so on every verdict.
- **The canonical MCP servers switched from `MIT` to `SEE LICENSE IN LICENSE`** — `[VERIFIED]` · R2. Not a bug,
  but it silently breaks any tool that requires an SPDX identifier.
  `@modelcontextprotocol/server-filesystem@2026.7.10` declares it, as do `server-memory`,
  `server-sequential-thinking` and `server-everything` at their 2026 versions, while their own older publishes
  (`2025.*`, `0.6.2`) declare plain `MIT`. Our licence gate treats an unmatched expression as ineligible on
  purpose — guessing wrong writes someone else's code to permanent storage with no delete — so four well-known
  servers came back blocked while their own older versions passed; resolving the repo `LICENSE` (MIT) clears
  them. Repro:
  `curl -s https://registry.npmjs.org/@modelcontextprotocol%2Fserver-filesystem | jq -r '.versions[."dist-tags".latest].license'`.
  Worth pairing with an npm note: the **abbreviated** metadata format
  (`Accept: application/vnd.npm.install-v1+json`) strips `license`, `description` and `repository` — 6 keys
  instead of 24 — so a tool that requests it sees no licence at all. That half was ours, and it cost a false
  negative on four MIT packages.
- **Two smaller notes for the SDK.** To ship tool metadata that is deliberately hand-authored (our malicious
  fixture's whole premise), the clean primitive is the low-level `Server` with
  `setRequestHandler(ListToolsRequestSchema, …)`, not `McpServer.registerTool` — which is built around *honest*
  tools, derives the advertised JSON Schema from a Zod raw shape, and couples the declared surface to the
  implementation. One line in the server README (*"use the low-level `Server` when you need full control over
  raw tool metadata, or want no Zod"*) would place it (M1). And a **correction of our own assumption**, since
  it is a widely repeated one: on `@modelcontextprotocol/sdk@1.29.0` a stray non-JSON line on the server's
  stdout before `server.connect(new StdioServerTransport())` did **not** break the client handshake — the
  client's read buffer tolerated it and reported `connected OK` (M2). We still route status to stderr as
  hygiene, and a line interleaved mid-session is untested — but "any stdout noise breaks a stdio MCP server" is
  not true for this version around the handshake, and it is worth knowing before hunting a corruption bug that
  is not there.
- **A real server needs far longer than a fixture to answer `tools/list`** · D9. 8 s is plenty for a fixture;
  `@modelcontextprotocol/server-everything` and `server-puppeteer` both timed out, because a real server may
  build a driver or an index before it serves. Puppeteer answers at 20 s. Also worth recording for server
  authors: of six well-known servers started with a scrubbed environment, **three exited immediately** because
  they require an API key to boot — a fact about the server rather than a failure of the reader, but one that
  silently degrades any tool reading declared capabilities.

## Claude Code — hooks and plugins

> Measured on **Claude Code 2.1.220**, Node v22.22.3, Windows 11. Probes: `probes/hook/` — a minimal
> zero-dependency stdio MCP server plus a hook script driven by headless `claude -p --include-hook-events`.
> Repro for every entry: `cd probes/hook && bash run.sh <mode>`. Log entries C1–C7.

- **`permissionDecision: "allow"` from a hook bypasses the normal permission prompt** — `[VERIFIED]` · C2.
  We read `allow` as "this hook has no objection", and drafted our own *unknown server → warn the user and
  proceed* path as `allow` + a `systemMessage` on that reading. It is authoritative instead: with **no**
  `--allowedTools` entry and no prior user grant, the MCP tool executed. So a trust layer whose *unknown* path
  emits `allow` makes its users strictly worse off than not installing it — it auto-approves precisely the
  servers it knows nothing about. Repro: `NO_ALLOWLIST=1 bash run.sh allow-warn` (tool runs) against
  `NO_ALLOWLIST=1 bash run.sh warn-only` (normal *"Claude requested permissions… but you haven't granted it
  yet"* flow preserved). Our warn path now emits `systemMessage` **only**, never a decision field. **What would
  fix it:** a named `notify` / `no-opinion` decision, or a warning next to the `allow` example that it *grants*
  rather than *permits*. The docs do say "bypasses the permission system" in one place, while the examples use
  it for advisory cases.
- **A plugin's `bin/` does not join the PATH** — `[VERIFIED]` · C7. The documented behaviour is that
  executables in a plugin's `bin/` are added to the PATH while the plugin is enabled; we had written that down
  as a fact and designed the override UX on it. Installed the real way
  (`claude plugin marketplace add …` then `claude plugin install surex@surex`, both succeeding, with
  `claude plugin details surex` correctly reporting the hooks), the binary is present at
  `~/.claude/plugins/cache/surex/surex/0.1.0/bin/surex` and `surex status` is `command not found`, exit 127.
  ```bash
  echo 'run: surex status' | claude -p --allowedTools Bash   # → surex: command not found
  echo "$PATH" | tr ':' '\n' | grep -i plugin                # → nothing
  ```
  **Why it matters beyond convenience:** our gate prints an override command in **every** block message, and
  that escape hatch is the entire reason blocking a tool call is defensible — a block a user cannot pass is a
  block that gets the gate uninstalled the first time it is wrong. A printed command that does not exist is
  worse than no command. We now resolve our own install location and print an invocation that works, and ship a
  `/surex` slash command. **Fix:** add the directory to PATH as documented, or drop the claim and tell plugin
  authors to expect `${CLAUDE_PLUGIN_ROOT}/bin` — right now the docs describe a capability a plugin author will
  build a user-facing instruction on.
- **A `PreToolUse` hook that exceeds its timeout fails open, and that is undocumented** — `[VERIFIED]` · C1.
  The docs give a 600 s default and say it is configurable, but never say what happens to the tool call when a
  *blocking* hook exceeds it — which for a hook used as a control is the entire difference between fail-open
  and fail-closed, and cannot be guessed. Measured: the hook is killed (`outcome: "cancelled"`, `exit_code: 1`,
  empty stdout) and **the tool call proceeds and returns normally**; the deny it was about to emit is
  discarded. Repro: `HOOK_TIMEOUT=5 bash run.sh hang 20`. Fail-open is a defensible default and it is the one
  we want — a registry outage must not brick every agent that installed us — but it is also a bypass: anything
  that makes the hook slow (a hung DNS lookup, a stalled registry, a large cache read) silently disables
  enforcement with no signal to the user, and a hook cannot opt into fail-closed today. One sentence in the
  hooks reference, ideally a per-hook `"onTimeout": "allow" | "deny"`, and at minimum surfacing the
  cancellation the way a `deny` is surfaced.
- **Three smaller ones.** For `mcp__<server>__<tool>` calls the `PreToolUse` payload carries `tool_name` but
  **no server name and no server config**, so every consumer re-implements the same parse including the
  `mcp__plugin_<plugin>_<server>__<tool>` special case — a `server_name` field, or better the resolved server
  config block, removes a class of bugs. The complete key set on 2.1.220 is `cwd · effort · hook_event_name ·
  permission_mode · prompt_id · session_id · tool_input · tool_name · tool_use_id · transcript_path`, three of
  which are undocumented and two genuinely useful: `transcript_path` (an absolute path to the live session
  `.jsonl`, which is how a hook can answer questions about its own session) and `prompt_id` (stable per user
  turn, distinct from `session_id`) (C3). `permissionDecisionReason` is **not** truncated at the documented
  10,000 characters — a **12,054-character** reason reached the model complete and unaltered — but at that
  length the model stopped recognising it as a block and described it as a tool error, while the 12-line
  version was quoted back verbatim and correctly described as a block. **The practical limit is comprehension,
  not bytes**, so the documented cap is the wrong thing to design against (C4). And `session_id` stability
  across `/clear` and `/compact` is undocumented while every "approve once per conversation" hook depends on
  it: we settled half of it — **`/compact` preserves `session_id`, verified by direct observation** headlessly
  (`--session-id` for turn one, then `printf '/compact' | claude -p --resume <uuid>`, with a real
  `compact_boundary` in the transcript, one distinct `sessionId` throughout, and the post-boundary hook seeing
  the same id) — while **`/clear` remains inference, not observation** (10 genuine `/clear` records on this
  machine all sit at line index 3–7, consistent with a new session but not the same standard of evidence, and
  labelled that way deliberately). One row in the hooks reference settles it: `/clear` → new · `/compact` →
  same · `/branch` → new · `/resume` → ? (C5).

## Vercel and Hono

> `hono@4.12.32`, `@hono/node-server@1.19.15`, Node v22.22.3, Windows 11. Log entries V2–V7.

- **`@hono/node-server/vercel` loses the request body, so every POST hangs** — `[VERIFIED]` · V6. Every GET
  answered in well under a second (`/`, `/healthz`, `/v1/registry`, `/v1/stats`, `/v1/verdict`) and **every
  request with a body returned 504 after 20 s** with `Vercel Runtime Timeout Error`. The tell that separated
  cause from coincidence: `POST /nope`, which matches no route and therefore never reads a body, answered
  **404 in 1.3 s**. So it is not POST and not the routing — it is reading the body. **Root cause:** Vercel's
  Node runtime pre-parses the body onto `req.body` and leaves the underlying stream consumed, so an adapter
  that builds a Web `Request` from that stream waits on something that will never emit another byte. It hides
  well, because a read-mostly API is all GETs — ours looked completely healthy on every route a browser would
  touch, while the route it actually broke was our gate's `SessionStart` prefetch.
  ```bash
  curl -X POST https://<url>/<any route that reads json> -d '{}'   # 504 after the function timeout
  curl -X POST https://<url>/<no such route>            -d '{}'   # 404, immediately
  ```
  **Fix:** have the adapter read `req.body` when it is present, or say plainly in the docs that Vercel consumes
  the stream. Either way, a body-carrying request in the package's own Vercel example would have surfaced it
  immediately. (Our hand-written entry reads `req.body` when Vercel has parsed it — object, string or Buffer —
  and only drains the stream when it has not, with a bounded wait. One trap inside that fix, worth its own
  line: the bounded wait must **not** be `unref()`'d, or with a spent stream and nothing else pending it never
  fires and the promise never settles — the same hang in a different hat. A test caught that; reasoning did
  not.)
- **An auto-detected framework preset makes `/` hang instead of reaching the function** — `[VERIFIED]` · V4.
  Nastier than a 500, because a hang reads as a network fault on the caller's side. With an `api/index.mjs`
  plus `"rewrites": [{ "source": "/(.*)", "destination": "/api/index" }]` — the documented pattern — every path
  reached the function except `GET /`, which never returned at all until curl gave up at 25 s. Runtime logs
  were the only place the answer was visible: every other path logs `[info/serverless]`, the root logs
  **`GET / 0 [info/static]`** — status 0, source *static* — and the function module had even booted, so from
  outside it looked exactly like our app hanging on one route. The wrong fix, recorded because it cost a
  deploy: adding an explicit `{"source":"/","destination":"/api/index"}` before the catch-all changed nothing,
  because rewrites are evaluated *after* the filesystem check. The actual cause was the auto-detected framework
  preset giving the project a static output root; setting `framework: null` took `/` from a 25 s hang to `200`
  in 0.41 s with every other route unchanged. **What would fix it:** the static handler returning **404** when
  it has nothing to serve. A platform that hangs where it means "not found" costs far more debugging time than
  the same condition reported as a status code — and auto-detecting a framework for a functions-only project is
  what put the static handler in the path at all.
- **Two more.** `@hono/node-server/vercel` is the **Node** adapter and `hono/vercel` is the **Edge** one — one
  character apart in an import, targeting different runtimes, and importing the wrong one gives you a function
  with the right name and signature that fails only at deploy time in whichever way the missing Node built-in
  surfaces first. One line in either README (*"for the Node.js runtime on Vercel import from
  `@hono/node-server/vercel`; `hono/vercel` is Edge-only"*), or a runtime warning when the Edge adapter finds
  itself in a Node process (V2). And a **project with a Root Directory can only be deployed by CLI from the
  repo root**, with an error naming a path nobody wrote: `vercel link` inside `apps/docs` writes a
  `project.json` with no `settings` block, so the next deploy uploads only that subtree and dies on
  `npm install` for a `workspace:*` dependency — while with `rootDirectory` set, deploying from that same
  directory fails with `The provided path "…\surex\apps\docs\apps\docs" does not exist`, because the CLI
  resolves it relative to the working directory rather than the repository. There is also no
  `vercel project update`, so `rootDirectory` cannot be set from the CLI at all. `vercel link` inside a
  workspace member could offer to set the Root Directory it can already infer from `pnpm-workspace.yaml` — it
  detects the framework in the same step — and the path error could name the base it resolved from, since
  `apps/docs/apps/docs` is unmistakably a doubled prefix (V7). Separately, `vercel build` could not run locally
  here at all — `Error: spawn cmd.exe ENOENT` in both Git Bash and PowerShell on a machine where `$env:ComSpec`
  exists and `System32` is on `PATH` twice — which is unfortunate precisely because reproducing the remote
  build locally is the rule after a failed remote fix, and is how V4 cost an extra deploy instead of being read
  off a config file (V5).

## Next.js, Nextra, zod, Tailwind v4

> Next 15.5.21 · Tailwind 4.3.3 · React 19 · nextra 4.6.1 · Node v22.22.3 · pnpm 9.12.3 · Windows 11.
> Log entries N1–N5.

- **A fresh `nextra@4.6.1` docs site 500s on every page, and the error names a prop you did pass** —
  `[VERIFIED, reduced to 6 lines]` · N5. A clean install of the current version, following the current
  quickstart verbatim, cannot render a single page; cost about an hour, most of it spent bisecting content
  because the production error is redacted. `next build` fails at prerender with *"An error occurred in the
  Server Components render. The specific message is omitted in production builds"*; under `next dev` the real
  message appears — `Invalid input: expected nonoptional, received undefined → at children` — which is
  maddening, because `children` **is** passed. **Root cause is version skew, not the site:**
  `nextra-theme-docs/dist/layout.js` destructures `children` **out** of the props and validates only what is
  left (`const { children, ...themeConfig } = t0; LayoutPropsSchema.safeParse(themeConfig)`), while
  `dist/schemas.js` declares `children` required as a `z.custom()`. That combination used to pass — **zod 4.4.0
  changed it so a *missing* key now fails a `z.custom()` field while an explicit `undefined` still passes** —
  and nextra depends on `zod: ^4.1.12`, so a clean install resolves 4.4.3.
  ```js
  const { z } = require('zod');
  const reactNode = z.custom((d) => d == null || typeof d === 'string');
  const S = z.strictObject({ children: reactNode, other: z.string().default('x') });
  S.safeParse({}).success                       // zod 4.3.6 → true   ·  4.4.0+ → false
  S.safeParse({ children: undefined }).success  // true on both — a missing key ≠ an undefined key
  ```
  Bisected: **4.3.6 passes · 4.4.0, 4.4.2, 4.4.3 fail.** There is no application-side fix, because `Layout`
  strips `children` itself; we scoped a pin (`"pnpm": {"overrides": {"nextra>zod": "4.3.6", "nextra-theme-docs>zod": "4.3.6"}}`).
  **Three things would each have prevented it:** in **nextra**, drop `children` from `LayoutPropsSchema` (it is
  destructured out before parsing, so it can never be validated) or parse `{ ...themeConfig, children }`, or
  pin `zod` to `~4.3` in dependencies; in **zod**, the 4.4.0 change from "missing key satisfies a permissive
  `z.custom()`" to "missing key is an error" is a breaking change to a very common pattern released in a minor;
  in **Next.js**, a prerender failure that redacts its own message sends you bisecting *content* when the fault
  is in `app/layout.tsx`.
- **Editing `package.json` under a running `next dev` silently 404s the CSS route** — `[VERIFIED]` · N1.
  Adding `"type": "module"` is a metadata change; the running dev server kept serving pages with **HTTP 200**
  while `/_next/static/css/app/layout.css?v=…` began returning **404**, so every page rendered as unstyled HTML
  — correct DOM, zero CSS — with `TypeError: __webpack_modules__[moduleId] is not a function` in the terminal.
  We found it because a headless screenshot came back as black-on-white text even though `pnpm build` was green
  and the compiled bundle contained the Tailwind output.
  ```bash
  U=$(curl -s http://localhost:4311/ | grep -o '/_next/static/css/[^"]*' | head -1)
  curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:4311$U"   # → 404
  # fix: kill the dev server, rm -rf .next, restart                     # → 200
  ```
  **What would fix it:** failing loudly. A 404 on the app's only stylesheet is not a recoverable condition, and
  returning 200 for the page while dropping its CSS produces a symptom ("Tailwind isn't working") that sends
  you to `@theme`, PostCSS and `content` globs — none of which is the problem. Next already restarts itself on
  `next.config.ts` changes; `package.json`'s `type` deserves the same, or a fatal error instead of a silent
  asset 404.
- **Tailwind v4: `@theme` versus `@theme inline` decides whether a token can be themed at all** · N3. A plain
  `@theme { --color-clean: #6aa87c }` resolves the hex into the generated utility, so `text-clean` is frozen at
  build time and re-declaring the variable under `:root[data-theme="light"]` changes nothing; only
  `@theme inline { --color-clean: var(--sx-clean) }` emits `color: var(--sx-clean)` into the utility. We found
  it by reading the compiled `layout.css` and seeing the literal hex. The v4 docs lead with `@theme` and treat
  `inline` as an optimisation detail, but for a themed design system it is the load-bearing choice and the
  failure is silent — the light variant simply does not apply.

## ollama and OpenAI-compatible endpoints

> ollama 0.30.11 on a DGX Spark (GB10, 122 GiB unified memory), reached over its `/v1` OpenAI-compatible
> surface; `OLLAMA_MAX_LOADED_MODELS=1`, `OLLAMA_NUM_PARALLEL=4`. Log entries D1–D6.

- **An over-long prompt is silently truncated to fit `num_ctx` — there is no error to catch** —
  `[VERIFIED by construction]` · D6. A prompt larger than the model's context does not error the way an
  oversized request does on a hosted API: ollama sizes the KV cache from `num_ctx` and **drops tokens to make
  the request fit**, returning 200 with a well-formed answer about the part of the input that survived, and no
  field in the response says anything was discarded. For us that would have been **a confident `clean` verdict
  about files the model never received** — the single worst output this system can produce, arriving through a
  success. Our budget is now a parameter and every record carries `run.sourceCoverage` (files supplied, files
  omitted or truncated, and which). **With a local OpenAI-compatible endpoint the context limit is the
  caller's invariant to enforce**, and a response field reporting truncation would make that unnecessary.
- **A reasoning model spends `max_tokens` on thinking and returns empty `content` with
  `finish_reason: "length"`** — `[VERIFIED]` · D2. HTTP **200**, `content: ""`, and the whole budget in
  `message.reasoning` — a **non-standard field** the OpenAI schema does not define. A reviewer that reads
  `choices[0].message.content` and treats "no findings" as "nothing found" emits a clean verdict from a model
  that never answered.
  ```bash
  curl -s http://HOST:11434/v1/chat/completions -H 'content-type: application/json' \
    -d '{"model":"gpt-oss:20b","messages":[{"role":"user","content":"say ok"}],"max_tokens":8}'
  ```
  We treat `finish_reason: "length"` as a **failed** review rather than a result. Documenting that `max_tokens`
  budgets reasoning *and* content on reasoning models, and that `reasoning` is where the tokens went, is the
  fix — everything about that response says success.
- **A 51 GiB model with a 262k declared context is killed mid-load, and the error blames the model** —
  `[VERIFIED, twice]` · D1. The load ran for **2m55s** and died with
  `Load failed … error="llama-server process has terminated: signal: terminated"` plus a 500 on
  `POST /api/generate`; `ollama ps` then shows an empty model list, so it reads as a corrupt model or an ollama
  bug. The answer was in `journalctl -u earlyoom`: the OOM killer sent SIGTERM with 9.43% memory available. The
  model declares `n_ctx_train = 262144` and ollama sizes the KV cache from that, which with
  `OLLAMA_NUM_PARALLEL=4` is ~1M tokens of KV — the load was reaching for roughly twice the 51.7 GiB file. Two
  lines fix it (`PARAMETER num_ctx 32768`, `PARAMETER use_mmap false` in a derived model, since the
  OpenAI-compatible API has no per-request `num_ctx`), after which ollama reports *"projected to use 50250 MiB
  of device memory vs. 120175 MiB of free"* and loads in ~90 s. **It has the projection already** — it prints
  `common_params_fit_impl` — it just prints it *after* committing to a three-minute load. Checking the
  projection against free memory first, and saying "killed by an external signal, check the OOM killer"
  instead of naming the model, removes the whole class.
- **Two smaller ones.** `response_format: {type:"json_object"}` is accepted and then not honoured — output
  arrived bare, inside a fenced block, and with a sentence of preamble across real runs, with no error and no
  warning; a response field stating whether it was applied would be enough, because silent non-enforcement of a
  request parameter is worse than rejecting it (D4). And **`GET /v1/models` is the only liveness probe that can
  tell "down" from "loading"** — the first completion after a cold start takes 90 s to 3 min while weights
  load, so a completion-based health check with any sane timeout reports a loading endpoint as down (ours did);
  `/v1/models` answered in **371 ms** and also confirms the configured model id is present, which catches a
  typo before it becomes a failed review (D3).

---

# The one we owe back

We wrote up **W7** — `lookupHuman()` returning a bare `null` for both "no" and "could not ask", in an
authorization primitive — and then shipped the identical bug ourselves the same day, in code whose entire
purpose is not making false claims about other people's work.

Our licence gate fetched `LICENSE` from a repository through a helper that returned `null` on any failure. A
404 (a real answer: no such file) and a 429 (no answer at all) collapsed into the same value, and the gate
concluded *no licence file found* → **ineligible** → published `unreviewable`, rendered on our site as *"no
licence permits us to store this source"* — a public statement about somebody else's correctly licensed package,
caused by a rate limit. We found it because `@modelcontextprotocol/server-everything` came back
licence-ineligible during a 58-package loop having come back Apache-2.0 and eligible minutes earlier; probing it
five times on a healthy network gave `eligible=true spdx=Apache-2.0` five times out of five. The difference was
load, not licensing.

```bash
node scripts/review-known.mjs --no-review --only server-everything   # licence Apache-2.0
```

The fetch now reports *why* it failed: a 404 is an answer and moves to the next candidate filename; a
429/5xx/timeout is retried and, failing that, returns `undetermined: true` — not eligible, but explicitly
refusing to claim ineligibility — and the caller leaves the entry alone rather than publishing about it.

**The transferable lesson, and the reason W7 is the finding we most want a maintainer to read:** any function
that returns a bare falsy value for both *"no"* and *"could not ask"* will eventually publish the wrong one,
and the wrong one is usually the harmful one.

---

*Every claim above was checked against a primary source — a live RPC read, a reproduced failure, a decoded
selector, a measurement — or is labelled as not reproduced. Full narrative, exact versions and every repro
command: [`../FRICTION-LOG.md`](../FRICTION-LOG.md). We are happy to walk through any of these at the booth,
and happier still to be told we got one wrong.*
