# Developer feedback for World — building SureX on AgentKit / AgentBook / World ID

Submission material for the **World — AgentKit New Use Cases** track, ETHGlobal Lisbon 2026.

We built [SureX](https://arkiv-surex.vercel.app) — a trust registry for MCP servers with a Claude Code hook
that stops a flagged tool call — and used **World AgentKit / AgentBook** to give an autonomous agent
*standing to dispute* a verdict, and **World ID** for human maintainer submissions and disputes. This is
what we hit while integrating, verified with repros. It is written to be useful, not to complain: every item
is something a doc line or a one-character fix would remove.

The full running log with exact repro commands and versions is in [`FRICTION-LOG.md`](../FRICTION-LOG.md)
under **## World**, entries W1–W14. This is the consolidated version, ordered by impact.

Integration is **live and correct** — the agent path recovers the address from the signature, reads
AgentBook on World Chain 480, and returns the honest verdict; a signed request from an unregistered wallet
gets `403 agent_not_human_backed` with the right reason, and a registered wallet gets `202` with AgentBook
standing — the full flow is now verified live in both directions. Registration itself (W14) blocked us for
hours with a `NonExistentRoot()` revert, then cleared when the World Chain state bridge advanced; the evidence
pointed at the bridge, not our code.

---

## 🟠 Hit us for hours, then cleared — W14: `register()` reverted `NonExistentRoot()` until the World Chain root bridged

**A valid Orb proof, rejected because the proof's Merkle root hadn't bridged to World Chain yet — it cleared on
a retry once the bridge advanced (tx `0xaa4c255c…fd870`, wallet now `registered`; full dispute flow then
verified live `202`/`403`).**

- The World ID verify **succeeds** — real Orb scan, valid Merkle root, valid nullifier, full 8-element ZK
  proof. Then the on-chain `register()` **reverts**, and the CLI cannot decode the error:
  > `The contract function "register" reverted … 0xddae3b71 … not found on the provided ABI`
- We decoded it: `keccak256("NonExistentRoot()")[:4] = 0xddae3b71`. World Chain's World ID router does not
  recognise the root the proof was built against. Read live on **World Chain (480)**:
  - `AgentBook(0xA23aB2712eA7BBa896930544C7d6636a96b944dA).worldIdRouter()` = `0x17B354dD2595411ff79041f930e491A4Df39A278`
  - `router.routeFor(1)` = `0xdFCa0A882eF7793485B3d052142B60647E82009E` (group-1 identity manager)
  - its `latestRoot()` = `12796…349`, sealed `2026-07-25T13:20:39Z`
  - the proof's root = `13007…511`, and `checkValidRoot(proofRoot)` **reverts**
- **Confirmed non-transient:** a second attempt produced the **identical** proof root, and World Chain's
  `latestRoot` did not move. So World App consistently anchors against a root the state bridge has not
  propagated to World Chain. Retrying does not help until the bridge advances.
- The router works — a real third-party registration exists on the same contract — so this is the World Chain
  identity-tree **bridge being behind the canonical tree**, not a bad Orb ID and not our code.

**What would fix it, and what to tell teams:**
1. The relay should verify against, or wait for, a root already bridged to World Chain — and surface a
   decoded `NonExistentRoot` with *"the proof root has not propagated to World Chain yet"* instead of an
   undecodable selector.
2. **The CLI's own error hint is actively misleading here:** it lists "the World ID used is not Orb-verified"
   as a likely cause. It was a perfectly good Orb ID. A team that trusts that hint re-scans for hours.
3. Document the World Chain root-propagation delay next to the AgentBook quickstart, and how to obtain a
   bridged-root proof. It cleared on its own once the bridge advanced — but nothing told us to just wait, so
   we spent hours treating a transient bridge lag as a broken integration.

---

## 🟠 Highest-impact for other teams — W1: `agentkit.fetch` silently does nothing

**Costs a team their whole demo, at night, with no error to search for.** ([VERIFIED, reproduced])

- `createAgentkitClient({signer}).fetch(url)` is supposed to see a 402, sign, and retry. It does **nothing** —
  no signature, no retry, no thrown error, and not a single `onEvent`. The raw 402 is returned, indistinguishable
  from the server rejecting a legitimate human-backed agent.
- **Root cause — version skew.** `@worldcoin/agentkit@0.2.0` reads the challenge from the JSON **body**
  (`.extensions.agentkit`). `@x402/hono@2.19.0` returns body `{}` and puts the challenge in a base64
  **`payment-required` response header**. The extension resolves `undefined` and the client bails via a
  silent `return response`. agentkit declares `"@x402/core": "^2.4.0"`, so a clean `npm install` today
  produces the broken pairing by default.
- **Workaround we shipped:** `agentkit.createHeader(ext)` — read the challenge from the header yourself and
  retry by hand. This is what makes our live agent-dispute flow work.
- **Suggested fix:** have `parsePaymentRequired` check the `payment-required` header before the body, and
  emit `onEvent({type:'no_challenge_found'})` on the bail-out path instead of returning silently. One line
  would have saved the debugging session.

---

## 🟡 Documentation and API surface — each is a doc line away from removed

- **W7 · `lookupHuman()` swallows every error and returns `null` — and `null` is the deny signal.** ([VERIFIED])
  A dead RPC, a 429, a wrong address and a bad checksum all return exactly what an *unregistered* agent
  returns, because `@worldcoin/agentkit-core@0.2.0` ends its AgentBook read with a bare `} catch { return null }`.
  So a throttled RPC is indistinguishable from "no human stands behind this agent." **We never trust a null:**
  we re-read it through our own viem client where a transport error actually throws, and only a confirmed
  on-chain zero becomes 403. Otherwise a team tells an honest agent it is not human-backed because their RPC
  hiccuped. Fix: throw on transport errors, or return a discriminated result.

- **W9 · The request header is `agentkit`, and no doc says so.** We classified on `x-payment` (the natural
  guess) and a correctly-signed agent got refused as a human for having no World ID proof. One line in the
  docs removes it.

- **W2 · The CLI's own docs contradict the shipped binary.** `cli/README.md` and `REGISTRATION.md` document
  `--network base | base-sepolia`; the shipped `0.2.0` has no such option and hardcodes World Chain. Passing
  the documented flag fails. The stale docs are the first thing a new dev reads.

- **W3 · "Orb required" is the single most important fact and it is not where you look first.** Registration
  checks `groupId = 1` and only Orb credentials exist on-chain; device-level and Selfie Check cannot register.
  This belongs in the first paragraph of the AgentKit quickstart, in bold — not inferred from a contracts
  reference page.

- **W5 · `createAgentBookVerifier` defaults to a shared public RPC.** Under demo load a rate-limit throw in
  the middle of the identity check reads exactly like a rejected agent. Recommend passing `rpcUrl` explicitly,
  next to the first code sample.

- **W6 · Name collision with Coinbase AgentKit.** Searching "agentkit testnet" lands on `@coinbase/agentkit`.
  A disambiguation line in the docs and the npm description would save the time it cost us.

- **W11 · `verification_level` no longer exists** in IDKit 4.x; `deviceLegacy` + `allow_legacy_proofs` is only
  documented on a migration page, not the main integration guide.

- **W12 · `hashSignal` ships only in a browser SDK,** so server-side signal enforcement gets reimplemented or
  skipped. We reimplemented it and cross-checked against the real `hashSignal()` on 4 vectors — but a
  server-usable export would stop teams either skipping the check or getting it subtly wrong.

- **W13 · `humanId` is returned unpadded,** so the SDK and the on-chain event log give two different strings
  for one human. A consumer comparing them will see a false mismatch.

## 🔵 Worth documenting, discovered not broken

- **W4 · There is a Base Sepolia AgentBook, and nobody says so.** ([VERIFIED by RPC]) It is live at the same
  address on 84532 with `groupId=1`, the official World ID testnet router, and a `externalNullifierHash`
  byte-identical to mainnet's. Every summary we found says AgentBook is World Chain mainnet only. **W8:**
  however, its entire log history is two deployment events and **zero registrations** — so as a no-Orb testing
  path it is invisible *and* untravelled. Either make it a documented testnet path, or say plainly it is not
  supported, because it is discoverable and teams will find it and trust it.

- **W10 · Two contradictory documented test environments** (simulator + `staging` vs Sandbox + TestFlight +
  `sandbox`), and the verify endpoint's OpenAPI enum omits `sandbox` — which the live endpoint accepts.

---

*Every claim above was verified against a primary source (a live RPC read, a reproduced failure, a decoded
selector). Versions and exact repro commands are in [`FRICTION-LOG.md`](../FRICTION-LOG.md) §World. Happy to
walk through any of them at the booth.*
