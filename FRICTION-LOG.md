# Friction log — ETHGlobal Lisbon 2026

> Developer feedback captured while building. Every sponsor wants this; some grade it directly.
> **Rule: log it when it happens, not at the end.** An entry written from memory on Sunday is worth
> a fraction of one written the moment it cost you twenty minutes.
>
> Format per entry: what we expected · what happened · how we found out · what would have prevented it.
> Mark **[VERIFIED]** only when reproduced. Keep repro commands — they are the value.

---

## World — AgentKit / AgentBook / IDKit

### W1 · `agentkit.fetch` silently does nothing against current `@x402/hono` — **[VERIFIED, reproduced locally]**
**Severity: high.** Costs a team their whole demo, at night, with no error to search for.

- **Expected:** `createAgentkitClient({signer}).fetch(url)` sees a 402, signs, retries. That is what the quickstart shows.
- **Happened:** nothing. No signature, no retry, no thrown error, and **not a single `onEvent`**. The raw 402 is returned. From the outside it is indistinguishable from the server rejecting a legitimate human-backed agent.
- **Root cause:** version skew. `@worldcoin/agentkit@0.2.0` reads the challenge from the JSON **body** (`response.clone().json()` → `.extensions.agentkit`). `@x402/hono@2.19.0` returns body `{}` and puts the challenge in a base64 **`payment-required` response header**. Extension resolves `undefined`, and the client bails through a silent `return response`.
- **Why every new team hits this:** agentkit declares `"@x402/core": "^2.4.0"`. The caret happily resolves to 2.19.0, so a clean `npm install` today produces the broken pairing by default. `@worldcoin/agentkit` has not been published since 2026-06-22; `@x402/hono@2.19.0` shipped 2026-07-17.
- **Workaround:** `agentkit.createHeader(ext)` is fine — read the challenge from the header yourself and do the retry by hand.
- **Fix we'd suggest:** have `parsePaymentRequired` check the `payment-required` header before falling back to the body, and emit an event on the bail-out path instead of returning silently. A one-line `onEvent({type:'no_challenge_found'})` would have saved us the debugging session entirely.

### W2 · The CLI's own docs contradict the shipped binary — **[VERIFIED]**
- **Expected:** `cli/README.md` on npm and `cli/REGISTRATION.md` on GitHub `main` both document `--network base | base-sepolia` and say the CLI *"defaults to `base`"*, with the relay *"only for sponsoring `AgentBook.register(...)` on Base."*
- **Happened:** the shipped `0.2.0` binary has **no `network` option in its arg schema** and hardcodes `viem/chains` `worldchain`, `eip155:480`, and `0xA23aB…944dA`. Passing the documented flag fails.
- **How we found out:** reading `cli/package/dist/index.js` after the flag was rejected.
- **Fix:** the live docs page agrees with the code — the npm README and REGISTRATION.md are stale Base-era docs. Delete or update them; they are the first thing a new dev reads.

### W3 · "Orb required" is the single most important fact and it is not where you look first
- **Expected:** from the AgentKit material, a human with a verified World App can register an agent.
- **Happened:** registration verifies `groupId = 1` on-chain, and only Orb credentials exist on-chain. A device-level or Selfie Check credential **cannot** register an agent. The CLI passes no `verification_level` and silently defaults to `orb`.
- **Why it matters:** this is a hard physical dependency on an Orb-verified human. A team that discovers it on Sunday has no qualifying submission. It belongs in the first paragraph of the AgentKit quickstart, in bold, not inferred from a contracts reference page.

### W4 · There is a Base Sepolia AgentBook, and nobody says so — **[VERIFIED by RPC]**
- AgentBook is live at `0xA23aB…944dA` on **Base Sepolia (84532)** with `groupId=1` and the official World ID **testnet** router, and its `externalNullifierHash` is byte-identical to mainnet's. Base mainnet (8453) also has a deployment at a different address.
- The docs and every summary we found say AgentBook is World Chain mainnet only.
- **Impact:** a possible no-Orb, no-phone testing path exists and is invisible. If it is supported, document it — it would remove the biggest onboarding blocker in the product. If it is not supported, say that too, because it is discoverable and teams will find it and trust it.

### W5 · `createAgentBookVerifier` defaults to a shared public RPC
- No `rpcUrl` means viem's public World Chain endpoint. Under demo load a rate-limit throw surfaces as an exception in the middle of the identity check, which reads exactly like a rejected agent. Docs should recommend passing `rpcUrl` explicitly, next to the first code sample.

### W6 · Name collision with Coinbase AgentKit
- Searching "agentkit testnet" lands on `@coinbase/agentkit`. Cost us time before we knew to distrust the results. Worth a disambiguation line in the docs and a note in the npm description.

---

## Sui / Walrus

> Context for every entry below: `@mysten/sui@2.22.1` + `@mysten/walrus@1.2.9` on Node 22.22.3 /
> Windows 11, against Sui testnet (`sui-node/1.76.0`, chain `69WiPg3D…`) and Walrus testnet
> (system object `0x6c2547cb…f6af`, package `0x849e95d2…d8cc`, walrus epoch 469). Repro script:
> `probes/walrus-write.mjs`. It wrote blob `-SzjTmxUSjs01bmC2AZ48iqz-fTCcllwcLu3nc2rb2Y`.

### S1 · The testnet SUI faucet is effectively unusable at an event, and its `retry-after` is fiction — **[VERIFIED]**
**Severity: high.** This is the single thing most likely to cost a team at Lisbon their Saturday.

- **Expected:** `POST https://faucet.testnet.sui.io/v2/gas` returns test SUI, or a rate-limit response that tells you when to come back.
- **Happened:** `429 Too Many Requests` continuously for ~7 minutes. The body and the `retry-after` header say **`Wait for 0s`**, `1s`, `2s`, `3s`, `4s` — seemingly at random — and honouring that value never once worked. Success finally came on **attempt 53** of a blind 8-second retry loop.
- **It is not per-IP.** We re-issued the identical request from a completely different egress (a machine in Colombia, vs. the venue NAT in Lisbon, `colo=LIS`) and got `429 … Wait for 0s` on the *first* try from that fresh IP. So a hackathon venue cannot route around it, and the advertised backoff is meaningless.
- **The SDK makes it worse:** `requestSuiFromFaucetV2` throws `FaucetRateLimitError: "Too many requests from this client have been sent to the faucet. Please retry later"` and **discards the `retry-after` header**. From TypeScript there is no way to distinguish a 3-second throttle from a daily ban, so the natural reaction is to give up on a faucet that would have worked 5 minutes later.
- **Repro:**
  ```bash
  curl -i -X POST https://faucet.testnet.sui.io/v2/gas -H 'Content-Type: application/json' \
    -d '{"FixedAmountRequest":{"recipient":"0x79d8e8063dd83035f72b5b7c464474ad737c9a17f994611781f91ec2c479ff35"}}'
  # → HTTP 429, retry-after: 3, body "Too Many Requests! Wait for 3s"  (repeat for 7 min)
  ```
- **Fix we'd suggest:** return a real `retry-after` / `x-ratelimit-reset`, propagate it onto `FaucetRateLimitError` as a field, and give hackathons an event-scoped quota or a per-address rather than global bucket. A one-line "retry in N seconds" that is actually true removes the whole failure mode.

### S2 · An out-of-range `epochs` comes back as HTTP 500 with a raw Move abort — and the real maximum is not what the docs say — **[VERIFIED]**
- **Expected:** testnet max storage term is 183 epochs (what our own briefing and several docs pages say). Store with `?epochs=183`.
- **Happened:** `HTTP 500` with `{"error":{"status":"INTERNAL","code":500,"message":"client internal error: transaction execution failed: contract execution failed in walrus::system_state_inner::reserve_space at address 0x849e95d2…d8cc with error type EInvalidEpochsAhead"}}`. A user input error is reported as an internal server error carrying a Move abort code.
- **The real number, read on chain:** `max_epochs_ahead = 53`, i.e. `SystemStateInner.future_accounting.length` (`current_index=45`, ring buffer length 53). `epochs=53` succeeded immediately. On a 1-day testnet epoch that is a 53-day ceiling, not 183.
- **How we found out:** there is no other way — `GET https://publisher.walrus-testnet.walrus.space/v1/info` **404s**, and `WalrusClient.systemState()` does not surface `max_epochs_ahead` as a named field. We had to know that the ring buffer length *is* the maximum.
- **Repro:**
  ```bash
  curl -X PUT "https://publisher.walrus-testnet.walrus.space/v1/blobs?epochs=183&permanent=true" --data-binary @blob.txt
  ```
- **Fix we'd suggest:** `400` with `"max epochs is 53"`; serve `/v1/info` on publishers; expose `maxEpochsAhead` on `systemState()` so nobody has to learn that a ring buffer length is a policy limit.

### S3 · Identical bytes deduplicate through the HTTP publisher but **not** through the TS SDK — you silently pay twice — **[VERIFIED]**
**Severity: high — this one costs real money on mainnet.**

- **Expected:** blob IDs are content-derived and deterministic, so re-storing identical bytes deduplicates and returns `alreadyCertified`. That is what the docs and every summary say, without qualification.
- **Happened:** true for the HTTP publisher, false for `@mysten/walrus`.
  - Publisher, same bytes second time → `{"alreadyCertified":{"blobId":"-SzjTmx…b2Y","event":{"txDigest":"Frk5H32…JQmd"},"endEpoch":522}}`, no new object, no cost.
  - `client.walrus.writeBlobFlow()` on bytes **already certified on chain** → happily ran the full register + certify, minted a *second* `Blob` object (`0xe0ad0c98…f5e8`) for the same blob ID, and charged **11,312,154 FROST of WAL + 6,163,520 MIST of gas**.
- **How we found out:** after our own certify, `getVerifiedBlobStatus({blobId})` returned `statusEvent.txDigest = Frk5H32…JQmd` — a digest that was **not ours**. It pointed at the earlier publisher certification of the same content. The blob was already certified before we paid to certify it.
- **Why it matters:** dedup is a *publisher behaviour*, not a protocol guarantee, and the SDK is the path you take precisely when you care about paying for your own storage. Anyone who assumes the documented dedup applies to `writeBlob` will re-buy storage on every retry — including on crash-recovery retries, which is exactly when it will happen.
- **Fix we'd suggest:** have `writeBlobFlow`/`writeBlob` check blob status after `encode()` and short-circuit (or expose `skipIfCertified: true`); and state explicitly in the docs that `alreadyCertified` is something the publisher does for you, not something the protocol does.

### S4 · `flow.executeCertify()` throws away the certify transaction digest — **[VERIFIED, from the shipped source]**
- **Expected:** the flow's typed helpers give you the outcome of each step. `executeRegister` returns `{step:'registered', blobId, blobObjectId, txDigest}`.
- **Happened:** `executeCertify` returns `{step:'certified', blobId, blobObjectId, blobObject}` — **no `txDigest`**. The interface `WriteBlobStepCertified` simply has no such field, and the implementation drops the value: `await ctx.executeTransaction(transaction, signer, "certify blob")` discards its own return.
- **Why it matters:** a blob's on-chain proof is *both* transactions. Any app that records provenance — ours records `blobId`, `suiObjectId`, register digest and certify digest per record — cannot use the ergonomic API at all. You have to drop to `flow.certify()` (which returns an unsigned `Transaction`) and execute it yourself, which is what `probes/walrus-write.mjs` does.
- **How we found out:** reading `node_modules/@mysten/walrus/dist/flows/write-blob.mjs` after the returned object had no digest on it.
- **Fix we'd suggest:** add `txDigest` to `WriteBlobStepCertified`. It is one field and the value is already in hand.

### S5 · `client.core.getObject({ objectId, version })` silently ignores `version` — **[VERIFIED]**
- **Expected:** passing a historical `version` returns the object at that version (we were walking a `Blob` object's history backwards to find its register transaction).
- **Happened:** it returns the **latest** version, with no error and no warning. Asking for `952302826` returns `952302828`. Our history walker therefore looped on the same transaction ten times before we noticed the version never moved.
- **Repro:**
  ```js
  const at = await client.core.getObject({ objectId: OBJ, version: '952302826', include: { previousTransaction: true } });
  console.log(at.object.version); // → 952302828
  ```
- **Fix we'd suggest:** honour it, or reject unknown/unsupported options loudly. A silently-ignored argument that changes the meaning of the result is worse than an unimplemented one.

### S6 · JSON-RPC is not "deprecated" on testnet — it is gone, and it 404s with an empty body — **[VERIFIED]**
- **Expected:** JSON-RPC is deprecated in favour of gRPC but still answers, per most current material.
- **Happened:** `POST https://fullnode.testnet.sui.io:443` with `{"method":"sui_getChainIdentifier"}` → **`HTTP 404`, `Content-Length: 0`**, server `sui-node/1.76.0`. No JSON, no error object, no pointer to the replacement. An empty 404 from a *correct* URL reads like a network problem, not an API removal.
- **Why it matters:** essentially every pre-2026 tutorial, StackOverflow answer and LLM completion for "query Sui transaction history" emits JSON-RPC. `suix_queryTransactionBlocks` is still the first thing anyone reaches for to find the transactions that touched an object, and there is no obvious gRPC equivalent. We had to reconstruct history from `effects.dependencies` + `previousTransaction` instead.
- **Fix we'd suggest:** return a JSON error body — `{"error":"JSON-RPC was removed in <version>; use gRPC at …"}` — instead of a bare 404. One string saves every migrating developer the same 20 minutes.

### S7 · `Ed25519Keypair.generate()` dies with an error that names neither the SDK nor the culprit — **[OBSERVED, NOT MINIMALLY REPRODUCED]**
- **Expected:** `Ed25519Keypair.generate()` works after `npm install @mysten/sui`.
- **Happened:** `TypeError: ed25519.utils.randomSecretKey is not a function` at `@mysten/sui/dist/keypairs/ed25519/keypair.mjs:44`.
- **Root cause:** `@mysten/sui@2.22.1` requires `@noble/curves ^2.2.0` (where the method is `randomSecretKey`), but an older `@noble/curves@1.9.1` — pulled in by `viem` → `ox` — had won top-level resolution in our `node_modules`. In 1.x the method is `randomPrivateKey`. Confirmed by `npm ls @noble/curves` reporting `1.9.1 invalid: "^2.2.0" from node_modules/@mysten/sui`, and by `Object.keys(ed25519.utils)` → `['getExtendedPublicKey','randomPrivateKey','precompute']`.
- **Honesty note:** we could **not** reduce this to a clean-room repro. Three attempts (`npm i @mysten/sui viem`; `npm i @mysten/sui` then `pnpm add viem`; and the same with a package.json that omitted `@mysten/sui`) all resolved `@noble/curves@2.2.0` and worked. Our tree got into the bad state through mixed npm/pnpm installs in a directory two agents were sharing. So: the version skew is real and the failure is real, the exact install sequence that produces it is not pinned down. `pnpm install` fixed it.
- **The sponsor-actionable half is the error quality:** a `@noble/curves` major mismatch surfaces as a `TypeError` on a private helper, naming neither `@mysten/sui` nor `@noble/curves` nor the word "version". Given that Sui SDK + `viem` in one `node_modules` is the *normal* case at a multi-chain hackathon, a guard at import time (`if (typeof ed25519.utils.randomSecretKey !== 'function') throw new Error('@mysten/sui requires @noble/curves ^2.2.0; found an incompatible copy')`) would turn a 30-minute dig into a one-line fix.

### S8 · Things the docs got right, recorded so nobody re-litigates them
- One blob write really is **two Sui transactions**, and the register one is a PTB: `system::reserve_space` + `system::register_blob` (net gas 4,683,480 MIST), then `system::certify_blob` (net gas 1,480,040 MIST). Total **6,163,520 MIST ≈ 0.0062 SUI** of gas plus **11,312,154 FROST ≈ 0.0113 WAL** of storage, for **129 bytes over 53 epochs**. Cost is per blob, not per byte — a 129-byte blob is billed on an encoded length of 66,034,000.
- A blob ID is **not** `sha256(bytes)`. For our payload, blobId `-SzjTmxUSjs01bmC2AZ48iqz-fTCcllwcLu3nc2rb2Y` vs `sha256` base64url `8EV8MBKjUbid8poZDYGJWVB0zy_oQ9ha7_gEfMH_Ktc`. Deriving a blob ID needs the Walrus encoder (`flow.encode()` / `client.walrus.encodeBlob()`), which is WASM — it cannot be done with a stdlib hash.
- The SDK does read package/object IDs at runtime, so nothing has to be pinned by hand: `TESTNET_WALRUS_PACKAGE_CONFIG` gives the system object and the SUI→WAL `exchangeIds`, and the exchange *package* ID falls out of the on-chain type of the exchange object (`0x82593828…ef9f::wal_exchange::Exchange`).
- Read-after-certify did **not** need a retry: the public aggregator served the blob on the first attempt.

---

## Arkiv

> All entries below found while writing `probes/arkiv-write-read.mjs` — one entity written to Braga and read
> back filtered by `.createdBy`, plus the adversarial case. Repro for every entry:
> `node probes/arkiv-write-read.mjs` with `ARKIV_WRITER_PK` and `ARKIV_FOREIGN_PK` set to two funded Braga
> wallets. Versions: `@arkiv-network/sdk@0.7.0`, `viem@2.55.8`, node v22.22.3, Braga chainId 60138453102.

### A1 · Upgrading 0.6.8 → 0.7.0 breaks every existing snippet at the import line, and there is no changelog — **[VERIFIED, reproduced twice]**
**Severity: medium.** Loud rather than silent, but it strands every tutorial, README and blog post written
against 0.6.x, and there is nothing in the package telling you what changed.

- **Expected:** `import { createPublicClient, createWalletClient, http } from '@arkiv-network/sdk'` and
  `import { privateKeyToAccount } from '@arkiv-network/sdk/accounts'` — the shape used by every 0.6.x
  example, including two production apps of ours.
- **Happened:** two consecutive hard failures on a clean install of `0.7.0`:
  1. `ERR_PACKAGE_PATH_NOT_EXPORTED: Package subpath './accounts' is not defined by "exports"`
  2. `SyntaxError: The requested module '@arkiv-network/sdk' does not provide an export named 'http'`
- **Root cause:** `0.6.8`'s `src/index.ts` began with `export * from "viem"`, and `./accounts` was a subpath
  whose entire content was `export * from "viem/accounts"`. `0.7.0` dropped both. `viem` is a *peer*
  dependency, so it is now the consumer's job to install and import it.
- **How we found out:** ran the probe. Fixed it by reading `node_modules/@arkiv-network/sdk/README.md`,
  which is correct for 0.7.0 (`import { http } from "viem"`, `import { privateKeyToAccount } from
  "viem/accounts"`) — but you only find that after the failure.
- **What would have prevented it:** a `CHANGELOG.md` in the published package. There is none — `ls` on the
  package root shows `LICENSE.md README.md dist package.json src` and nothing else. Two lines
  ("0.7.0 — BREAKING: viem is no longer re-exported; import `http` from `viem` and `privateKeyToAccount`
  from `viem/accounts`. The `/accounts` subpath is removed.") would have cost us zero minutes.
- **Also worth doing:** `0.7.0` is a minor bump carrying breaking changes. Under semver this is a major.

### A2 · `orderBy` is on the query builder, is accepted silently, and does nothing — **[VERIFIED, reproduced twice]**
**Severity: medium.** A query API with a no-op sort is a correctness trap: you write `orderBy("severity",
"number", "desc")`, it does not throw, results come back, and they are simply not sorted.

- **Expected:** `client.buildQuery().where(...).orderBy("severity", "number", "desc")` orders the results.
  The builder exposes `orderBy()` with two overloads plus exported `asc()` / `desc()` helpers, and the
  chain plumbs `orderBy` all the way into the RPC params — nothing at the call site suggests it is inert.
- **Happened:** identical result order for `asc` and `desc` over two entities with `severity` 0 and 4.
  Severities came back `0,4` both times. No throw, no warning at runtime.
- **How we found out:** we tested it deliberately (step 5 of the probe) because it was unconfirmed. The
  answer is also in the source: `0.7.0` marks `orderBy`, `asc` and `desc` `@deprecated` with the line
  *"Server-side ordering is not supported by the network."* — `0.6.8` carried no such note.
- **What would have prevented it:** don't ship an inert method. Throw `NotSupportedError`, or drop it from
  the builder. Failing that, put the deprecation where a developer actually reads it — the README's query
  section still shows `orderBy: [{ name: "key", type: "string", desc: "asc" }]` in the `query()` options
  with no warning at all.
- **Consequence for us:** all ordering is client-side. Anything the gate needs ranked must be sorted in JS,
  and any "top N" must fetch the full scoped set first.

### A3 · `expiresIn` is seconds but must be an even number of them, and 0.6.8 → 0.7.0 turned silent rounding into a throw — **[VERIFIED, reproduced twice]**
- **Expected:** `expiresIn` is "the expires in of the entity in seconds" (0.6.8 JSDoc, verbatim), so any
  positive integer works.
- **Happened on 0.7.0:** `expiresIn: 3601` throws
  `InvalidExpirationError: Invalid expiresIn: 3601. expiresIn must be a positive integer and a multiple of
  the Arkiv block time (2 seconds), because expiration is measured in whole blocks (1 block = 2 seconds).`
  The error message is genuinely good — it explains the *why*, not just the *what*.
- **The skew:** `0.6.8` did `Math.ceil(item.expiresIn / BLOCK_TIME)` and silently accepted anything;
  `0.7.0` calls `validateExpiresIn()` first. So an odd `expiresIn` that worked on 0.6.8 is a hard throw
  after the upgrade, and this is not in a changelog either (see A1).
- **Confirmed on chain:** `expiresIn: 3600` → `expiresAtBlock - createdAtBlock = 1800` blocks, both runs.
  Seconds in, blocks stored, 2 s per block. Units check out.
- **What would have prevented it:** the constraint is now in the JSDoc (good), but it should also be in the
  README's write example, which just passes a number. The single most common value a developer will try is
  `expiresIn: 3600` — which happens to be legal — so the trap only springs later on something like `86401`
  or a computed value.

### A4 · The indexing lag everyone warns about is ~40 ms; the 4.6 s wait is `createEntity` itself, and nothing says so — **[VERIFIED, reproduced twice]**
**Severity: low, but it sends teams optimising the wrong thing.**

- **Expected:** from Arkiv guidance we had been carrying (poll `getEntity` at 250 ms for up to 5 s before
  trusting a read-after-write) we assumed a meaningful indexing delay after the transaction lands.
- **Measured, from the moment `createEntity()` returns:**
  | | run 1 | run 2 |
  |---|---|---|
  | `createEntity()` call itself | 4624 ms | 4571 ms |
  | receipt → visible via `getEntity` | 42 ms (1 poll) | 38 ms (1 poll) |
  | receipt → visible via the **query index** | 79 ms total | 77 ms total |
  Every read-after-write in the probe — including after `updateEntity` — landed on the **first** poll.
- **So:** the lag is real but sub-100 ms, and the query index (what our gate actually reads) trails
  `getEntity` by only ~37 ms. The 4.5 s is `createEntity` blocking on the transaction receipt, which the
  JSDoc does not mention — it returns `{entityKey, txHash}` and reads like a submit, not a wait.
- **What would have prevented it:** say in the JSDoc that the write actions await the receipt, and publish
  a real number for index lag instead of a defensive "poll for 5 s". Teams budget latency off these
  numbers; ours would have been wrong by two orders of magnitude in one direction and 50x in the other.

### A5 · `ownedBy` and `createdBy` sit side by side in the builder with nothing saying one of them is spoofable — **[VERIFIED — exclusion proven end-to-end]**
**Severity: high (security-shaped, docs-fixable).** This is the entry we most want a maintainer to read.

- **The situation:** Braga is a shared public database with no uniqueness constraint on attributes. Anyone
  can write an entity carrying exactly your `project` + `entityType` + `fingerprint`. If a consumer scopes
  its reads only by attributes, an attacker picks the answer it gets.
- **What we proved** (probe step 4, both runs). Same `project`, same `entityType`, same `fingerprint`;
  ours `state=flagged severity=4 tier=B`, the attacker's `state=clean severity=0 tier=A` from a second
  wallet:
  - unfiltered query → **2 entities** (the collision is real, not hypothetical)
  - `.createdBy(WRITER)` → **1**, ours only, run 1 `0x72ebc165…fb77`, run 2 `0x79aaa607…da36`
  - `.createdBy(FOREIGN)` → **1**, theirs only — our entity is absent, so the filter is a real partition
    and not just a coincidence of ordering
  - identical results via the non-deprecated `client.select('*')` path
- **The docs gap:** `QueryBuilder` exposes `ownedBy()` and `createdBy()` as symmetrical one-line filters
  with near-identical JSDoc. But the wallet client also ships `changeOwnership`, so **ownership is
  transferable and therefore attacker-influenceable** — an attacker can transfer a crafted entity *to* your
  address and have it pass an `ownedBy(you)` filter. Creator is immutable. `ownedBy` is a convenience
  filter; `createdBy` is the security boundary, and only one of them can be used for trust.
- **What would have prevented it:** one sentence on `ownedBy()` — *"Ownership is transferable via
  `changeOwnership`; do not use `ownedBy` as a trust boundary. Use `createdBy`, which is immutable."* — and
  the same note in the query docs next to `$owner` / `$creator`. Right now the safe choice is discoverable
  only by noticing that `changeOwnership` exists.

---

## Claude Code (not a sponsor, but the enforcement surface — worth sending upstream)

> Probes: `probes/hook/` — a minimal zero-dependency stdio MCP server plus a hook script, driven by
> headless `claude -p --include-hook-events`. Repro for every entry below:
> `cd probes/hook && bash run.sh <mode>`, and `NO_ALLOWLIST=1 bash run.sh <mode>` for the permission-flow
> variants. Versions: **Claude Code 2.1.220**, node v22.22.3, Windows 11.

### C1 · A `PreToolUse` hook that exceeds its timeout **fails OPEN** — undocumented — **[VERIFIED]**
**Severity: high** for anyone using a hook as a security control.

- **Expected:** unknown. The docs give a 600s default and say it is configurable, but never say what happens
  to the tool call when a *blocking* PreToolUse hook exceeds it. For a security hook that is the entire
  difference between fail-open and fail-closed, and it cannot be guessed.
- **Happened:** the hook is killed (`outcome: "cancelled"`, `exit_code: 1`, empty stdout) and **the tool
  call proceeds and returns normally**. The deny the hook was about to emit is discarded.
- **How we found out:** `HOOK_TIMEOUT=5 bash run.sh hang 20` — a hook that sleeps 20s under a 5s timeout.
  The model received `PROBE_TOOL_RAN`, i.e. the tool executed.
- **Why it matters:** fail-open is a defensible default and it is the one we want — a registry outage must
  not brick every agent that installed us. But it is also a bypass: anything that can make the hook slow
  (a hung DNS lookup, a stalled registry, a large local cache read) silently disables enforcement, with no
  signal to the user that a check was skipped. A hook cannot opt into fail-closed today.
- **What would have prevented it:** one sentence in the hooks reference, and ideally a
  `"onTimeout": "allow" | "deny"` field per hook. At minimum, surface the cancellation to the user the way
  a `deny` is surfaced — right now a security hook can be timed out into silence.

### C2 · `permissionDecision: "allow"` from a hook **bypasses the normal permission prompt** — **[VERIFIED]**
**Severity: high.** This is a footgun that turns a *warning* into a *silent grant*.

- **Expected:** that `allow` means "this hook has no objection", leaving Claude Code's own permission
  system to decide as it normally would. Our own spec drafted the "server is unknown, warn the user and
  proceed" path as `permissionDecision: "allow"` + a `systemMessage`, on that reading.
- **Happened:** `allow` is authoritative. With **no** `--allowedTools` entry and no prior user grant, the
  MCP tool executed. A trust layer whose *unknown* path emits `allow` therefore makes its users strictly
  less safe than not installing it — it auto-approves precisely the servers it knows nothing about.
- **How we found out:** `NO_ALLOWLIST=1 bash run.sh allow-warn` vs `NO_ALLOWLIST=1 bash run.sh warn-only`.
  With `allow`: tool ran. With `systemMessage` alone and no decision field: `Claude requested permissions
  to use mcp__probe__read_notes, but you haven't granted it yet` — normal flow preserved. Silent exit 0
  behaves the same as `warn-only`.
- **Fix in our build:** the warn path emits `systemMessage` **only**, never `permissionDecision`.
- **What would have prevented it:** the docs describe `allow` as "bypasses the permission system" in one
  place, but the hook examples use it for advisory cases. A named `notify`/`no-opinion` decision — or a
  warning next to the `allow` example that it *grants*, not *permits* — would remove the whole class.

### C3 · No MCP server name in the hook payload — **[VERIFIED]**
For `mcp__<server>__<tool>` calls, `PreToolUse` input carries `tool_name` but no server name and no server
config. Confirmed by dumping the raw payload (`probes/hook/.out/last-hook-input.json`). The complete key
set on 2.1.220 is:

```
cwd · effort · hook_event_name · permission_mode · prompt_id · session_id ·
tool_input · tool_name · tool_use_id · transcript_path
```

Nothing identifies the server. Every consumer re-implements the same parse, including the
`mcp__plugin_<plugin>_<server>__<tool>` special case. A `server_name` field — or better, the resolved
server config block — would remove a class of bugs.

Three of those keys are undocumented in the hooks reference and two are useful: **`transcript_path`** (an
absolute path to the live session `.jsonl`, which is how a hook can answer questions about its own session)
and **`prompt_id`** (stable per user turn, distinct from `session_id`). `effort` is `{level: "high"}`.

### C4 · `permissionDecisionReason` is **not** truncated at 10,000 characters — **[VERIFIED]**
- **Expected:** the documented cap on hook output — beyond 10,000 characters the output is written to a
  file and replaced with a preview plus the path. We designed the block message around that ceiling.
- **Happened:** a **12,054-character** `permissionDecisionReason` reached the model *complete and
  unaltered* — start marker, 12,000 characters of padding, end marker, newlines intact.
  `bash run.sh long 12000`.
- **But the interesting failure is not truncation.** At that length the model stopped recognising it as a
  block: it reported "the call ran (no permission block) and the probe server returned an error result".
  The 12-line version (`bash run.sh deny`) was quoted back verbatim and correctly described as a block.
- **Takeaway for anyone building on this:** the practical limit on a block message is *comprehension*, not
  bytes. Keep it short and structured. The documented cap is the wrong thing to design against.

### C5 · `session_id` stability across `/clear` and `/compact` is undocumented
`/branch` is documented to produce a new session id. `/clear`, `/compact` and `/resume` are not described
either way. Any hook implementing "approve once per conversation" depends on this, and it is not guessable.

**Not resolvable headlessly** — both are interactive-only, so `claude -p` cannot exercise them. Answered
instead by inspecting real session transcripts under `~/.claude/projects/<slug>/<session-id>.jsonl`:

- **`/compact` preserves `session_id`.** Five transcripts containing compact-boundary records each carry
  exactly **one** distinct `sessionId`, equal to the filename UUID, identical on both sides of the
  boundary. A hook's per-session state therefore survives compaction.
- **`/clear` starts a new session.** Across every transcript on this machine there are 10 genuine `/clear`
  records and all 10 sit at line index 3–7 — i.e. `/clear` is written as the *opening* message of a
  **new** transcript file, never mid-conversation. The previous session's file simply ends.

Inferred from transcript layout, not from a hook observing itself across the two commands. `probes/hook/`
leaves a logging hook in place so the direct observation can be made in one interactive session; see
`probes/hook/README.md`.

**What would have prevented it:** one row in the hooks reference —
`/clear` → new · `/compact` → same · `/branch` → new · `/resume` → ?. It is three lines of documentation
guarding a behaviour every stateful hook has to reverse-engineer.

---

## How this gets used at submission

- **World** — W1 is a real, reproducible bug with a root cause and a suggested patch. Lead the booth conversation with it.
- Beta tracks (Selfie Check / Identity Check) grade **testing documentation covering both developer and user feedback** as a required deliverable. If we touch either, the user-side half has to be written too — it is not optional.
- Keep the repro scripts. "Here is the failing case" beats a paragraph.
