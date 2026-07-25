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

### W14 · AgentBook registration reverts `NonExistentRoot()` on World Chain — a valid Orb proof the target tree does not have — **[VERIFIED on chain]**
**Severity: high.** It is the last step of the whole AgentKit flow, everything upstream of it works, and the error is undecodable by the CLI itself.

- **Expected:** with an Orb-verified World ID, `npx @worldcoin/agentkit-cli register <address>` verifies the human, the hosted relay pays, and the agent is registered. The DevRel confirmed any wallet works — it need not be the human's own.
- **Happened:** the World ID verify **succeeded** — real Orb scan, valid Merkle root, nullifier `0x1f2fe25…`, a full 8-element ZK proof. Then the on-chain `register()` **reverted**, and the CLI could not decode the error: `The contract function "register" reverted … 0xddae3b71 … not found on the provided ABI`. Registration did not land; `status` still reports `unregistered`.
- **Decoded and diagnosed against chain state** (the CLI does not): `keccak256("NonExistentRoot()")[:4] = 0xddae3b71`. So World Chain's World ID router does not recognise the Merkle root the proof was built against. Read live on World Chain 480:
  - `AgentBook.worldIdRouter()` = `0x17B354dD2595411ff79041f930e491A4Df39A278`
  - `router.routeFor(1)` = `0xdFCa0A882eF7793485B3d052142B60647E82009E` (the group-1 identity manager)
  - its `latestRoot()` = `12796…349`, the proof's root = `13007…511`, and `checkValidRoot(proofRoot)` **reverts**.
  - The tree is live (it has a different, valid latest root) and a real third-party registration exists on the same contract — so the router works. The specific proof's root is simply not in World Chain's group-1 history. World App anchored the proof on a root the state bridge to World Chain has not propagated, or on a different tree.
- **How we found out:** the CLI printed the raw revert and a "likely causes" list that pointed at "not Orb-verified" — which was wrong; the proof was accepted. Decoding the selector and reading the router's `latestRoot`/`checkValidRoot` against the proof's root is what isolated it.
- **Why it matters:** this is the exact last mile of the World track's novel use, and the failure surfaces as an undecodable selector with a misleading "maybe not Orb-verified" hint. A team that trusts that hint burns hours re-scanning a perfectly good Orb ID.
- **What would fix it:** the relay should verify against — or wait for — a root already bridged to World Chain, and its error should decode `NonExistentRoot` and say "the proof root has not propagated to World Chain yet, retry shortly" instead of a generic ABI-decode failure. Documenting the World Chain root-propagation delay next to the AgentBook quickstart would remove the whole class.

### W5 · `createAgentBookVerifier` defaults to a shared public RPC
- No `rpcUrl` means viem's public World Chain endpoint. Under demo load a rate-limit throw surfaces as an exception in the middle of the identity check, which reads exactly like a rejected agent. Docs should recommend passing `rpcUrl` explicitly, next to the first code sample.

### W6 · Name collision with Coinbase AgentKit
- Searching "agentkit testnet" lands on `@coinbase/agentkit`. Cost us time before we knew to distrust the results. Worth a disambiguation line in the docs and a note in the npm description.

### W7 · 🐛 `lookupHuman()` swallows every error and returns `null` — **[VERIFIED, live + from source]**
**Severity: high, and it is a correctness bug in an authorization primitive, not a DX annoyance.**
**This also corrects our own W5, which was wrong about the failure mode.**

- **Expected (and what W5 assumed):** a rate-limited or unreachable RPC makes `lookupHuman` *throw*, so a caller can tell "this agent is not registered" from "we could not ask".
- **Happened:** it never throws. `@worldcoin/agentkit-core@0.2.0`, `src/agent-book.ts`, ends the read with a bare `} catch { return null }`. **Every** failure — HTTP 429, dead endpoint, wrong contract address, and even a mis-checksummed input address — returns exactly what an unregistered agent returns.
- **Why it matters more than it looks:** `null` is the deny signal. A resource server following the quickstart (`if (!humanId) return 403`) tells an honest, registered, human-backed agent that no human stands behind it **because the server's own RPC was throttled**. On a demo day with one shared public RPC, that is the single most likely way an AgentKit integration fails, and it fails *silently and wrongly* rather than loudly.
- **Repro** (live World Chain 480, 2026-07-25; `0xea7d…4171` is a real registration read off `AgentRegistered` logs):
  ```js
  import { createAgentBookVerifier } from '@worldcoin/agentkit';
  const ok     = createAgentBookVerifier({ rpcUrl: 'https://480.rpc.thirdweb.com' });
  const broken = createAgentBookVerifier({ rpcUrl: 'http://127.0.0.1:9' });
  await ok.lookupHuman('0xeA7D8B94F6e8044a22738FFe78a2CB356D114171');      // 0x249394758bdbf66…  ✅
  await broken.lookupHuman('0xeA7D8B94F6e8044a22738FFe78a2CB356D114171');  // null              ❌ RPC down
  await ok.lookupHuman('0xea7d8b94f6E8044A22738fFE78a2cb356D114171');      // null              ❌ bad checksum
  ```
  Ours, runnable: `node apps/api/test/world-live.smoke.mjs`.
- **Workaround we shipped:** never believe a `null`. On null we re-read `lookupHuman` through our own viem client, where a transport error is an exception, and only a confirmed `0` becomes `403 agent_not_human_backed`; a throw becomes `503 upstream_unavailable` with "standing is UNKNOWN — this is not a refusal". `apps/api/src/verifiers.mjs` → `lookupHumanStrict()`.
- **Fix we'd suggest:** return `{ humanId | null, error? }`, or throw on transport failures and reserve `null` for `0n`. Whichever — a library whose deny answer is indistinguishable from its error answer cannot be used safely for authorization, and the quickstart's `if (!humanId) reject()` line teaches exactly the unsafe usage. A one-line `catch (e) { throw e }` would be a strict improvement over today's behaviour.

### W8 · Base Sepolia's AgentBook is real, correctly wired, and has never been used — **[VERIFIED]**
Follow-up to W4, resolving the "is there a no-Orb path?" question as far as it can be resolved from outside.

- Read on 2026-07-25: `eth_getCode` at `0xA23aB…944dA` on Base Sepolia returns 3,569 bytes; Blockscout has it verified as `AgentBook`; `worldIdRouter()` = `0x42FF98C4E85212a5D31358ACbFe76a621b50fC02` (the documented Base **Sepolia testnet** WorldIDRouter) and `groupId()` = `1`. So it is genuinely pointed at the World ID testnet tree. Base **mainnet** 8453 has **no contract at that address** — if a Base mainnet deployment exists it is elsewhere, and we could not confirm it. **UNVERIFIED.**
- **But its entire log history is two events**, both from deployment: `AgentBookInitialized` and `OwnershipTransferred`. **Zero `AgentRegistered`.** Nobody has ever registered an agent there.
- So: **not usable as a no-Orb path today**, and we are saying that plainly rather than leaving it as a rumour. Three things block it, and only the first is ours to solve: the CLI cannot target it (W2, no `--network`), so you would reimplement `register(agent, root, nonce, nullifierHash, proof)` yourself; the proof must satisfy `externalNullifierHash`, which is derived from **World's own** `app_id` + `agentbook-registration` action, and whether the simulator will issue a staging proof for someone else's app is not something we could establish; and `lookupHuman` in the SDK resolves against World Chain 480 unless you inject a custom client, so a Base Sepolia registration is invisible to a default integration anyway.
- **Ask for the booth:** is the Base Sepolia deployment supported, abandoned, or a staging artifact? It is discoverable, it is verified on a public explorer, and teams *will* find it and assume it is the testnet path. Either document it as one — which would remove the biggest onboarding blocker AgentKit has — or say it is not, because the current silence is the worst of the three options.

### W9 · The AgentKit request header is `agentkit`, and nothing says so where you look
- **Expected:** the docs or the quickstart to name the request header an agent sends, the way x402 documents `x-payment`.
- **Happened:** no page we found names it. The only source of truth is `@worldcoin/agentkit@0.2.0`, where the client does `headers.set(AGENTKIT, header)` and the server hook does `getHeader(AGENTKIT)`, with `AGENTKIT = 'agentkit'` in `agentkit-core`. Cost us a route that classified a correctly signed agent as a *human* — it only looked for `x-payment` — and refused it for having no World ID proof. A wrong-and-confident 401.
- **Worth stating explicitly** in the SDK reference next to `createHeader`, because anyone not using `@x402/hono` (which is anyone doing identity without payment) has to wire the header themselves. Same for the fact that `createHeader` is usable standalone: the docs only show it via `agentkit.fetch`, which is broken (W1), so the working path is currently the undocumented one.

### W10 · Two documented test environments that contradict each other, and an OpenAPI enum that omits one — **[VERIFIED against the live endpoint]**
- `world-id/idkit/integrate` step 4 says: *"To test during development, use the simulator and set `environment` to `"staging"`"*. The `world-id/sandbox/*` pages say Sandbox is the integration-testing environment, `environment: "sandbox"`, installed via TestFlight (iOS) or a Firebase link you must ask a World contact for (Android). Nothing on either page mentions the other. A team has no way to tell which is blessed, and they have very different setup costs — one is a web page, the other is a mobile build and a human contact.
- **And the published contract disagrees with both:** the `POST /api/v4/verify/{rp_id}` OpenAPI spec documents `environment` as `production | staging` only. `IDKitRequestConfig` in `@worldcoin/idkit-core@4.2.2` types it as `production | staging | sandbox`. The **live endpoint accepts `sandbox`** — we sent it and it passed validation through to proof verification. So a client generated from the published spec rejects the value the Sandbox guide tells you to send.
  ```bash
  # 400 all_verifications_failed → the envelope was accepted, only our synthetic proof failed
  curl -s -X POST https://developer.world.org/api/v4/verify/app_a7c3e2b6b83927251a0db5345bd7146a \
    -H 'content-type: application/json' \
    -d '{"protocol_version":"3.0","nonce":"1","action":"agentbook-registration","environment":"sandbox","responses":[{"identifier":"orb","merkle_root":"0x0","nullifier":"0x1","proof":"0x2"}]}'
  ```
- **Impact on us, concretely:** it is the reason this project cannot claim a completed simulator round trip. Add `environment` to the verify enum, and put one line at the top of both pages saying which environment a new integration should use in July 2026.

### W11 · `verification_level` is gone, and every third-party snippet still uses it
- **Expected:** `verification_level: "device"`, which is what our own tech spec §7.1 was written against and what every blog post and LLM answer still produces.
- **Happened:** IDKit 4.x has no `verification_level`. The replacement is a preset — `deviceLegacy({ signal })` — and it additionally requires `allow_legacy_proofs: true` on the request or TypeScript fails on a missing prop. The mapping table exists, but only on `world-id/from-idkit-standalone`, a *migration* page a new integration has no reason to open.
- **What would have prevented it:** the mapping table (or at least `deviceLegacy`) on `world-id/idkit/credentials` and in the integration prompt, which currently shows only `orbLegacy` and `proofOfHuman`. Requiring Orb of a maintainer defending their own code is not realistic, so `deviceLegacy` is the preset a lot of real integrations need and it is the hardest one to find.

### W12 · `hashSignal` is not importable server-side without pulling in a browser SDK
- Enforcing the `signal` binding server-side means recomputing `hashToField(signal)` and comparing it to `signal_hash`. The docs say *"the backend should enforce the same value"* but the only shipped implementation, `hashSignal`, lives in `@worldcoin/idkit-core` — a browser SDK a read-only backend has no other reason to depend on.
- We reimplemented it (`keccak256(bytes) >> 8`, left-padded to 32 bytes) and cross-checked it against `hashSignal` on four vectors including the documented empty-signal default `0x00c5d246…85a4`. It matches. But every backend team will either redo this or skip the check, and skipping it is the difference between a proof bound to one dispute and a proof replayable across the whole registry.
- **Fix we'd suggest:** publish it in a server-shaped package (`@worldcoin/idkit-server` already exists and already carries `signRequest`), and state the shift-right-8 formula in the verify reference so it can be implemented in any language. Two lines of prose.

### W13 · A minor sharp edge: `humanId` is returned unpadded
- `lookupHuman` returns `toHex(uint256)`, which drops leading zeros: the same registration reads as `0x1c2d8c2a0abcd…` from the SDK and `0x01c2d8c2a0abcd…` from the `AgentRegistered` event topic. Anyone using `humanId` as a map key, a database key, or a cross-check against the event will get two identities for one human depending on where they read it. Return it zero-padded to 32 bytes, or document it as a numeric value rather than a hash-shaped string.

### W15 · The documented failure mode for a Face-Check-disabled app is *nothing happens* — **[NOT reproduced by us; sourced from World's own docs]**
- **Context:** switching `/submit` and `/d/[fp]` from `deviceLegacy` to Selfie Check (`selfieCheckLegacy`), 2026-07-25, `@worldcoin/idkit@4.2.1`.
- **The preset itself is well documented and the swap is genuinely one line** — `world-id/idkit/credentials#selfie-check` gives the exact React call, and it is correct: `selfieCheckLegacy({ signal })` on the standard `IDKitRequestWidget` with `allow_legacy_proofs`. Credit where due; W11's complaint does not apply here.
- **What is not documented next to it:** Selfie Check is gated per app (`enable_face_check`), and World's own gotcha table describes the failure as *"Face Check appears unresponsive or never starts"* → "the app may not be enabled for Face Check" (`world-id/SKILL`, Phase 7). A **silent no-op** is the worst available failure mode for a beta feature behind an entitlement: there is no error code, nothing in `onError`, and nothing distinguishes "not entitled" from "user closed the sheet".
- **We could not reproduce either branch.** Our app *is* enabled (`enable_face_check: true`), and completing the flow needs a phone with World App — so we have verified the code path and the request shape, not the camera. Recorded as an unverified-by-us doc claim on purpose.
- **What would have prevented it:** have IDKit reject the request with a named code (`credential_not_enabled`) when the app lacks the entitlement, the same way `user_presence_failed` exists for a failed liveness step. Failing that, put the `enable_face_check` precondition in the Selfie Check section of `idkit/credentials` — not only in the gotcha table of a separate skill page, which is the last thing a developer reads and the first thing they need.

### W16 · The only full-narrative React example for `selfieCheckLegacy` pairs it with the **invite-code** widget, which reads as a requirement
- `world-id/idkit/react` → *"Migrating from QR / connect-URL"* shows the before/after as `orbLegacy` + `IDKitRequestWidget` → `selfieCheckLegacy` + `IDKitInviteCodeRequestWidget`. Two things change in one diff (the component *and* the credential) while the prose only explains the component swap.
- Read quickly — which is how a migration snippet is read — that says *Selfie Check needs the invite-code widget*. It does not: `idkit/credentials#selfie-check` uses the plain `IDKitRequestWidget`, and that is what we shipped and what type-checks. So the docs contain the right answer and a louder wrong-looking one.
- **Not a bug, and nothing broke** — logged because it is a 20-minute detour that costs nothing to remove.
- **What would have prevented it:** keep the credential constant across a migration example (`orbLegacy` → `orbLegacy`), so the only thing the diff teaches is the thing the heading promises.

---

## MCP Registry (registry.modelcontextprotocol.io)

### R1 · The official registry does not contain the canonical `@modelcontextprotocol` servers — **[VERIFIED]**
**Severity: medium**, and it quietly misrepresents the ecosystem to anyone building on the registry.

- **Expected:** the official MCP registry lists the servers people actually run, so a crawl of it produces a
  recognisable set — github, filesystem, postgres, playwright, slack.
- **Happened:** it does not. We crawled **795 active rows over 8 pages** and seeded 50 real servers, and not
  one was a name anyone would recognise: `@certscore/mcp`, `@circulara/plugin`, `borealhost-mcp`,
  `fodda-mcp`. The first reaction on seeing the result was *"are these placeholders?"* — real data that reads
  as fabricated, which for a registry is just as damaging.
- **Confirmed by search, not inferred from the crawl order.** `?search=github` returns
  `ai.smithery/Hint-Services-obsidian-github-mcp`, `ai.smithery/saidsef-mcp-github-pr-issue-analyser`,
  `ai.smithery/smithery-ai-github`. `?search=filesystem` → `com.pulsemcp/remote-filesystem`,
  `io.github.Digital-Defiance/mcp-filesystem`. `?search=playwright` → `com.pulsemcp/playwright-stealth`,
  `com.thenextgennexus/playwright-mcp-server`. The `@modelcontextprotocol/*` packages themselves are absent;
  what dominates is Smithery mirrors and one-off forks. Two genuinely canonical entries do exist
  (`io.github.upstash/context7`, `io.github.getsentry/sentry-mcp`), which is what makes the gap look like an
  onboarding gap rather than policy.
- **Repro:**
  ```bash
  curl -s 'https://registry.modelcontextprotocol.io/v0/servers?search=github&version=latest&limit=5'     | jq -r '.servers[].name'
  ```
- **Why it matters to anyone else building on it:** a registry is the natural source for a tool that needs to
  identify servers, and a crawl of this one produces a corpus that neither matches real user configs nor
  looks credible. We had to seed the well-known servers from **npm** instead, and record `seedSource` as npm
  rather than the registry, because an entry that lies about where it came from is worse than one nobody
  recognises.
- **What would fix it:** publish the first-party `@modelcontextprotocol/*` servers, or make the ranking
  surface official/verified publishers above mirrors. Right now the front page of the ecosystem's own index
  is forks of itself.

### R2 · The canonical MCP servers switched from `MIT` to `SEE LICENSE IN LICENSE` — **[VERIFIED]**
Not a bug, but it silently breaks any tool that requires an SPDX identifier, and it took a real debugging
detour to establish.

- `@modelcontextprotocol/server-filesystem@2026.7.10` declares `"license": "SEE LICENSE IN LICENSE"`, as do
  `server-memory`, `server-sequential-thinking` and `server-everything` at their 2026 versions. The older
  publishes of the same packages (`2025.*`, `0.6.2`) declare plain `MIT`.
- Our licence gate treats an unmatched licence expression as **ineligible** on purpose — guessing wrong
  writes someone else's code to permanent storage with no delete — so those four came back blocked while
  their own older versions passed. Resolving the repo `LICENSE` (MIT) is what clears them.
- **Repro:** `curl -s https://registry.npmjs.org/@modelcontextprotocol%2Fserver-filesystem | jq -r '.versions[."dist-tags".latest].license'`
- Worth noting alongside: npm's **abbreviated** metadata format
  (`Accept: application/vnd.npm.install-v1+json`) strips `license`, `description` and `repository` — 6 keys
  instead of 24 — so a tool that requests it sees no licence at all and, if it fails closed, marks
  MIT packages ineligible. That one was ours, and it cost a false negative on four well-known servers.

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

### S9 · A quilt tells you the patch ids and, separately, the identifiers — and no call gives you both — **[VERIFIED, 49 of 50 records mis-mapped]**
Measured with `@mysten/walrus@1.2.9` while seeding 50 registry records into one quilt.
- **Expected:** `writeFilesFlow()` mirrors `writeBlobFlow()`, so stepping `encode -> register -> upload ->
  certify` and then calling `flow.listFiles()` returns the per-patch addresses **for the files you passed
  in, in that order** — the way every other batch API in the ecosystem behaves.
- **Happened:** `listFiles()` returns `{ id, blobId, blobObject }` — **no `identifier` field at all** — and
  **not in input order**. Mapping positionally was correct for **1 of 50** patches. "Sorted by identifier"
  was correct for **5 of 50**, so it is not that either. The result is 50 Arkiv records each pointing at a
  different record's bytes: every `contentSha256` check fails later, and a failing content check is exactly
  what tampering looks like.
- **How we found out:** not from the SDK. We fetched one patch back and its `getIdentifier()` returned a
  different record's key than the one we had filed it under, with a byte length of 884 against a recorded
  1055.
- **Repro:**
  ```js
  const flow = client.walrus.writeFilesFlow({ files });       // files[i] identifier = fp_i
  await flow.encode(); /* register, upload, certify ... */
  const listed = await flow.listFiles();
  const back = await client.walrus.getFiles({ ids: listed.map((f) => f.id) });
  console.log(await back[0].getIdentifier() === await files[0].getIdentifier()); // -> false
  ```
- **The trap underneath it:** `client.walrus.writeQuilt()` **does** return the mapping you need —
  `index.patches[]` carries both `patchId` and `identifier` — but, exactly like `executeCertify()` (S4), it
  **discards the register and certify transaction digests**. So one call gives you provenance without
  addressing, the other gives addressing without provenance, and no call gives both. Anything that has to
  cite a record on chain has to write with the flow and then read the mapping back out of the certified
  quilt, which is what we ended up doing.
- **And you cannot re-derive the ids later.** `WalrusFile` exposes `getIdentifier()` but not its own patch
  id, and there is no exported encoder from (blobId, index range) to a patch id — `blobIdFromInt` /
  `blobIdToInt` are blob-level only. Lose the `listFiles()` output and the patches are unaddressable even
  though the quilt is certified and readable.
- **Fix we'd suggest:** put `identifier` on the `listFiles()` result. It is one field, it is already in the
  quilt index the SDK just parsed, and its absence turns the natural way to write a quilt into silent data
  corruption. Failing that, have `writeQuilt()` return the two digests, so that at least one call is
  complete.

### S10 · Quilt is not an optimisation on testnet — without it the seed does not fit in the wallet — **[VERIFIED, measured both ways]**
- **Measured, one quilt:** 50 record bodies, 49,968 bytes total, 53 epochs → **2 Sui transactions**,
  **8,157,120 MIST** of gas and **11,312,154 FROST** of storage.
- **That FROST figure is the same 11,312,154 we paid for a single 129-byte blob** (S8). Confirmed against
  `storageCost()`, which quotes an identical `storage=10901835 write=410319 total=11312154` for 4 KB, 64 KB
  and 256 KB — the storage unit, not the byte count, is what gets billed.
- **So the comparison is stark:** the same 50 records as standalone blobs would have been **100
  transactions** and **565,607,700 FROST**, against a funded balance of **488,687,846 FROST**. It would not
  merely have been slower or dearer — **it would not have fitted**, and it would have died around record 43
  with a half-populated registry and a faucet that takes 53 blind attempts to answer (S1).
- **Why it matters for an event:** the docs frame Quilt as a cost optimisation for small blobs, which reads
  as advice you can defer to later. On testnet, for anything that writes tens of records, it is the
  difference between finishing and not finishing. Worth saying in those terms in the Quilt docs.
- **The honest trade, for the record:** a quilted record has **no certified Sui object of its own**, so it
  has no per-record explorer link — it is addressed as (quilt blob, patch id). We keep standalone blobs for
  source trees, reviews and dispute evidence, where citing one record individually is the entire point, and
  every quilted pointer we write carries `addressing: 'quilt-patch'` so a reader can tell the two apart.

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

### A6 · Three separate traps in one pagination loop, and each fails in a different direction — **[VERIFIED]**
Reading back a 50-entity seed with `@arkiv-network/sdk@0.7.0`.
- **Expected:** the shape every JS pagination API has used for a decade —
  `while (result.hasNextPage) { result = await result.next(); }`.
- **Happened:** three things, and only the third throws anywhere near the mistake.
  1. **`hasNextPage` is a METHOD, not a property.** `result.hasNextPage` evaluates to a function object,
     which is **always truthy**, so the guard never stops the loop. Nothing warns; the code just paginates
     until something else breaks.
  2. **`next()` mutates the result in place and returns `undefined`.** So the idiomatic
     `result = await result.next()` sets `result` to `undefined`, and the following line throws on
     `.entities` — a `TypeError` several frames from the cause.
  3. **`.limit()` is mandatory for pagination.** With no limit, `_limit` is `undefined` and `next()` throws
     `NoCursorOrLimitError: Cursor and limit must be defined to fetch next`. A builder with no `.limit()`
     looks paginable and is not.
- **Repro:**
  ```js
  const r = await pub.buildQuery().where([eq('project', P)]).createdBy(W).fetch();
  console.log(typeof r.hasNextPage);   // -> 'function'  (so `if (r.hasNextPage)` is always true)
  console.log(!!r.hasNextPage);        // -> true, even on a single complete page
  console.log(await r.next());         // -> undefined   (and `r` itself has already moved on)
  ```
- **What the correct loop is:**
  ```js
  const r = await builder.limit(100).fetch();
  const all = [...r.entities];
  while (r.hasNextPage()) { await r.next(); all.push(...r.entities); }
  ```
- **Why it matters:** the failure is not "pagination is awkward", it is that the natural spelling **silently
  reads one page and reports success**. For a registry read that is a truncated answer presented as a
  complete one.
- **Fix we'd suggest:** rename to `hasMore()` or expose it as a getter so the property form cannot be
  misread; return `this` from `next()` so the assignment form works; and throw a named error at `fetch()`
  time when a query cannot be paginated, rather than one page later.

### A7 · `mutateEntities` is ~50x cheaper in wall-clock than 50 `createEntity` calls, and nothing says so — **[VERIFIED, measured]**
- **Measured:** `createEntity()` takes ~4.6 s because it awaits the receipt (A4).
  `mutateEntities({creates})` with **50 creates** returned in **4,629 ms** — one transaction, one receipt,
  the same 4.6 s. Four creates took 4,597 ms. The per-entity marginal cost inside a batch is roughly
  **zero**, so a 100-entity seed is two receipts instead of a hundred: **~9 s against ~7.5 minutes.**
- **Also confirmed, because we had to rely on it:** `createdEntities[]` comes back in **the same order as
  `creates[]`**. Verified rather than assumed — we wrote four entities with distinguishing attributes, then
  read each returned key back and compared the stored attribute against the input. 4/4 matched, and again
  across 50. This is load-bearing for anyone recording keys against specific records, and it is not stated
  anywhere.
- **And:** a numeric attribute holding epoch **milliseconds** (`1784950249894`) round-trips exactly, so
  timestamps do not have to be scaled down to seconds to stay integers.
- **Why it matters:** the docs present `createEntity` as the normal path and `mutateEntities` as a
  convenience. At 4.6 s per call that framing costs a seeding job an order of magnitude, and it is the same
  discoverability trap as batch writes elsewhere — the singular call never mentions the plural one.
- **Fix we'd suggest:** one line on `createEntity`'s JSDoc — *"awaits the receipt (~4.6 s); to write more
  than one entity use `mutateEntities`, which batches into a single transaction"* — plus an explicit
  guarantee that `createdEntities` preserves input order, since callers cannot use the result safely without
  it.

---

## ENS

> All entries below found while building the offchain resolver and CCIP-Read gateway
> (`contracts/`, `apps/web/app/api/ens/`). Repro for every entry: `node probes/ens-resolve.mjs <mode>`
> after `cd probes && pnpm install --ignore-workspace`. Versions: `@adraffy/ens-normalize@1.11.1`,
> `viem@2.55.8`, `ethers@6.13.5`, `solc@0.8.28`, node v22.22.2.

### E1 · Our own published identifier is not a legal ENS label, because of its separator — **[VERIFIED, measured]**
**Severity: medium.** Found in ten minutes rather than ten hours, but it invalidates the obvious design —
`<fingerprint>.surex.eth` — and anyone who writes that in a spec without running it will not find out
until a wallet silently refuses to resolve the name.

- **Expected:** an SXF-1 fingerprint, `sxf1_` + 64 lowercase hex, would be usable as a subname label.
  It is 69 characters of `[a-z0-9_]`, which reads as conservative.
- **Happened:** ENSIP-15 normalisation rejects it outright. The underscore is legal only as the FIRST
  character of a label:

  ```
  Invalid label "sxf1_b1dad32ff73fe0791aa5430006…ec235b1af446740e81b53fcef92edb1": underscore allowed only at start
  ```

- **How we found out:** ran it, before writing the label encoding. `probes/ens-resolve.mjs labels`
  normalises both the raw fingerprint and the candidate label and prints what each did.
- **Repro:**

  ```bash
  cd probes && pnpm install --ignore-workspace
  node ens-resolve.mjs labels
  ```

- **Fix we shipped:** a distinct label encoding, `sxf1-` + the first 40 hex characters, in
  `apps/web/lib/ens.ts`. The hyphen normalises. The full fingerprint is returned as the
  `surex:fingerprint` text record, so the truncation is a naming convenience and never the identity.
- **Fix we'd suggest:** ENSIP-15 is precise and `@adraffy/ens-normalize` is a genuinely good library —
  the error message names the exact rule, which is more than most validators do. The gap is upstream of
  it: nothing in the ENS *documentation* for subname or wildcard designs mentions that a namespace
  built on hashes with a conventional separator will not normalise. One sentence in the ENSIP-10
  wildcard docs — *"labels must pass ENSIP-15; `_` is legal only in first position"* — would have saved
  the lookup.

### E2 · viem and ethers disagree about how long a label may be, and the disagreement is silent — **[VERIFIED, measured]**
**Severity: medium.** Nothing throws at the boundary; a name simply resolves for some of your users and
not others, and which ones depends on a library they chose, not on anything you did.

- **Expected:** one limit, applied by everyone. DNS says 63 bytes per label; ENSIP-10 defines an
  encoded-label form for longer ones. Both clients implement ENS, so both should behave the same.
- **Happened:** they behave differently in the 64–255 range, and neither warns.

  | label length | `viem` `packetToBytes` | `ethers` `dnsEncode` |
  |---|---|---|
  | 45 | ok, 51 bytes | ok, 51 bytes |
  | 63 | ok, 69 bytes | ok, 69 bytes |
  | **64** | **ok, 70 bytes** | **throws** |
  | **69** | **ok, 75 bytes** | **throws** |
  | **255** | **ok, 261 bytes** | **throws** |
  | 256 | ok, 72 bytes — switches to the ENSIP-10 labelhash form | throws |

  ethers' message is clear once you hit it — `label "aaa…" exceeds 63 bytes`, `code:
  INVALID_ARGUMENT` — and the limit *is* configurable: `dnsEncode(name, 255)` succeeds. But it is a
  second positional argument almost nobody passes, so the default is what ships.
- **How we found out:** measured across both libraries at 45/63/64/69/255/256 rather than reading either
  one's source, because the question was what real callers would experience.
- **Repro:** `node probes/ens-resolve.mjs labels` — rows where the two disagree are marked `!`.
- **Fix we shipped:** a 45-character label. Under both limits, with no reliance on either library's
  defaults. `apps/web/test/ens.test.mjs` asserts the length stays under 64 so a future change to the
  encoding cannot quietly re-enter the disagreement band.
- **Fix we'd suggest:** ethers should default `dnsEncode` to 255 to match ENSIP-10 and the rest of the
  ecosystem, or say in the error that the limit is a parameter. Failing that, both libraries could warn
  in the 64–255 band that portability is not guaranteed there.

### E3 · A `string[]` setter cannot be written the obvious way without via-ir — **[VERIFIED, reproduced]**
**Severity: low.** A compile error, so it fails loudly. Logged because the fix is non-obvious and the
error message does not name it.

- **Expected:** `function setUrls(string[] calldata next) external { _urls = next; }` — `calldata` being
  the cheaper and more idiomatic choice for an external setter.
- **Happened:** `UnimplementedFeatureError: Copying nested calldata dynamic arrays to storage is not
  implemented in the old code generator.` The message describes the internal limitation, not the
  remedy, and does not mention that either `memory` or `via_ir = true` resolves it.
- **How we found out:** first compile of `SureXOffchainResolver.sol`.
- **Repro:** `node probes/ens-resolve.mjs contract` with the parameter changed back to `calldata`.
- **Fix we shipped:** `string[] memory`. Turning on via-ir for one setter is a poor trade on a contract
  this small, and the setter is owner-only and rare.
- **Fix we'd suggest:** append the remedy to the error — *"use `memory`, or enable via-ir"*.

### E4 · Foundry cannot be installed behind a locked-down egress policy, and there is no offline path — **[VERIFIED]**
**Severity: low for us, high for anyone in a managed environment.** Not a sponsor SDK issue; logged
because it shaped how this contract is tested and someone else will hit it.

- **Expected:** `curl -L https://foundry.paradigm.xyz | bash && foundryup`, the documented install.
- **Happened:** `foundry.paradigm.xyz` is refused at the proxy (`403` to `CONNECT`), and the fallback of
  pulling release binaries from the `foundry-rs/foundry` GitHub repository is also unavailable in that
  environment. There is no npm-distributed `forge`, so there is no path that uses an
  already-allowed registry.
- **How we found out:** tried it, then read the proxy's own failure record rather than guessing at the
  cause.
- **Repro:** `curl -L https://foundry.paradigm.xyz` from behind a policy that allowlists
  `registry.npmjs.org` but not `paradigm.xyz`.
- **Workaround we shipped:** `probes/ens-resolve.mjs contract` compiles the resolver with `solc` from
  npm and executes it on `@ethereumjs/vm`, in process. It covers the digest, both interface IDs and six
  `resolveWithProof` acceptance and rejection paths. `contracts/test/SureXOffchainResolver.t.sol`
  remains the canonical suite for anyone who has `forge`.
- **Fix we'd suggest:** publish `forge` and `anvil` to npm as platform-specific optional dependencies,
  the way esbuild and swc distribute their binaries. It would make Foundry installable in every
  environment that already permits an npm install, which is most of them.

---

### E5 · `.eth` registration on Sepolia has been broken network-wide since early June 2026 — **[VERIFIED, from on-chain transaction history]**
**Severity: critical for anyone developing against ENS on a testnet.** This is not a bug in our code, and
it is not specific to us: **nobody** has registered a `.eth` name on Sepolia in seven weeks.

- **Expected:** register `surex.eth` on Sepolia the documented way — `commit`, wait `minCommitmentAge`,
  `register` — before pointing the parent at our offchain resolver.
- **Happened:** every `register` reverts with **bare `0x`** — no revert string, no error selector. The
  commitment is valid and mature, `available()` and `valid()` both return true, and the value sent exceeds
  `rentPrice`. We rebuilt the commitment hash on-chain and confirmed it matched byte for byte.
- **How we found out:** stopped debugging our own call and read other people's. Counting `register`
  calls (`0x74694a2b` and `0xef9c8805`) in the most recent 200 transactions to each controller:

  | Controller | register calls | succeeded | failed | last success |
  |---|---|---|---|---|
  | `0xFED6a969…` (wrapper-era) | 67 | 54 | 13 | **2026-05-24** |
  | `0xfb3cE5D0…` (current, per ENS's own manifest) | 32 | **0** | 32 | **never** |
  | `0x7e02892c…` (legacy) | 3 | 3 | 0 | — |

  Successes on `0xFED6a969…` run 2026-02-07 → 2026-05-24. Failures start 2026-06-02. Nothing has
  succeeded on any controller since **2026-06-15**.
- **Root cause, as far as we can see from outside:** `BaseRegistrarImplementation.controllers()` returns
  `false` for the NameWrapper and for every controller in ENS's published Sepolia deployment. The
  registrar that owns the `.eth` node no longer authorises the contracts that register into it, so every
  attempt dies in `onlyController` — a bare `require`, hence the empty revert data.
- **Repro:**
  ```bash
  cast call 0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85 'controllers(address)(bool)' \
    0x0635513f179D50A207757E05759CbD106d7dFcE8 --rpc-url https://sepolia.drpc.org   # → false
  curl -s "https://eth-sepolia.blockscout.com/api?module=account&action=txlist\
&address=0xFED6a969AaA60E4961FCD3EBF1A2e8913ac65B72&sort=desc&offset=200"
  ```
- **What made it expensive:** `commit()` still succeeds. We counted **53 successful commits** on
  `0xfb3cE5D0…`, a controller that has never completed a single registration. Users are paying gas for
  the first half of a two-step flow that cannot finish, and the second half fails with no message.
- **Fix we'd suggest:** two things, in order. Re-authorise a controller on the Sepolia registrar so the
  testnet works at all. Then make `register` fail loudly — the current controller declares eleven custom
  errors (`NameNotAvailable`, `InsufficientValue`, `CommitmentTooNew`…) and this path returns none of
  them, because the failure happens one contract deeper. A `ControllerNotAuthorised()` error on the
  registrar would have saved us most of an afternoon. Failing that, have `commit()` revert when the
  controller cannot register, so nobody pays for step one of a dead flow.

---

### E6 · ENS's published Sepolia deployment manifest points at a controller that has never worked — **[VERIFIED]**
**Severity: high.** The manifest is the thing an integrator is supposed to trust.

- **Expected:** `ensdomains/ens-contracts@deployments/sepolia/ETHRegistrarController.json` names the
  controller to integrate against.
- **Happened:** it names `0xfb3cE5D01e0f33f41DbB39035dB9745962F1f968`, which is **0 for 32** on
  `register` and is not authorised on the registrar. The one that used to work, `0xFED6a969…`, is not in
  that file. An integrator reading the official manifest builds against a contract that cannot succeed.
- **How we found out:** built against the manifest, failed, then compared with on-chain history.
- **Repro:** `gh api repos/ensdomains/ens-contracts/contents/deployments/sepolia/ETHRegistrarController.json`
  then check `BaseRegistrar.controllers()` for the address it returns.
- **Fix we'd suggest:** either deploy-and-wire in one step, or mark unwired deployments in the manifest.
  A deployed-but-unauthorised address is indistinguishable from a working one until you spend gas.

---

### E7 · An unregistered name renders as *registered and owned* in the ENS app, because of a reverse record — **[VERIFIED]**
**Severity: medium, but it is the single most misleading thing we hit all weekend.** It sent us down an
hour-long wrong path, chasing a migration that had not happened.

- **Expected:** if the app shows a name with an owner, a registration date and an expiry, the name is
  registered.
- **Happened:** `app.ens.dev/surex.eth` showed **Owner `0x9d49…d3e5`, Registered JUL.25.2026, Expires
  JUL.26.2027** for a name that was never registered. `viem.getEnsAddress('surex.eth')` on Sepolia also
  returned that address. The account had only ever called `setName(string)` on the reverse registrar —
  setting a *primary name* pointing at a name it does not own. No registration transaction exists in its
  history, and no ETH was ever spent on one.
- **How we found out:** the on-chain registry disagreed with the app. `registry.owner(namehash)` was
  zero and `available()` was true, so we read the account's full transaction list: six transactions,
  two of them `setName` (`0xc47f0027`), none of them `register`. We had already concluded from the app
  that the name lived in a newer registry — it did not. Nothing did.
- **Repro:** call `setName("<any unregistered name>.eth")` on the Sepolia reverse registrar from a fresh
  account, then open that name in the app and resolve it with viem. Compare against
  `registry.owner(namehash(name))`.
- **Control:** an unrelated unregistered name (`definitely-not-registered-zzq7x.eth`) resolves to `null`,
  so the forward resolution genuinely comes from the reverse record.
- **Fix we'd suggest:** do not accept a primary name for a name the account does not own — or, if that
  is deliberate, do not render an unowned name with an ownership block and registration dates. The dates
  shown were not real. A "not registered — claim it" state would be correct and is what the underlying
  data supports.

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

### C6 · An MCP server config is not portable across platforms, and nothing normalises it — **[VERIFIED]**
**Severity: medium**, and it silently breaks anything that treats a server definition as an identity.

- **Expected:** that the same MCP server, configured the same way, looks the same in `~/.claude.json` on
  Windows and on macOS.
- **Happened:** it does not. On Windows every stdio server is written as
  `{"command": "cmd", "args": ["/c", "npx", "@playwright/mcp@latest"]}`; the identical server on macOS is
  `{"command": "npx", "args": ["@playwright/mcp@latest"]}`. The package name is not in the same position,
  and a naive reader of `command` sees `cmd` and learns nothing at all.
- **How we found out:** ran our fingerprinter over this machine's real configuration. Every Windows-added
  server produced `runner: "other:cmd", package: {name: "", version: "unpinned"}` — the package identity
  gone entirely. A Windows user and a macOS user running the same server would never have matched.
- **Also in the same family:** `npx mcp-remote <url>` is a *remote* server wearing a stdio costume. Read
  literally, every remote server behind that shim collapses onto one identity — the shim's.
- **What would have prevented it:** a documented canonical form for a server definition, or a helper in the
  MCP spec/SDK that returns one. Every tool that wants to reason about "which server is this" — a registry,
  an allowlist, a lockfile, a policy engine — is re-deriving this and will get it wrong in the same way.

**A second finding from the same run, worth more than the bug.** Across 15 real MCP servers in three config
scopes on a working developer's machine, **not one was version-pinned** — the ecosystem convention is
`npx -y pkg@latest`. Any scheme that ties a security claim to a reviewed *version* is, in the ecosystem as
it exists today, describing code that is not the code about to run. We grade that as Tier C and say so on
every verdict rather than let it read as a pass.

### C7 · A plugin's `bin/` does **not** join the PATH — **[VERIFIED]**
**Severity: high for us**, because the command that does not exist is the one printed in every block.

- **Expected:** the documented behaviour — executables in a plugin's `bin/` are added to the PATH while the
  plugin is enabled, so a plugin can ship a real terminal command with no separate global install. We had
  this written down as a verified fact and designed the override UX on it.
- **Happened:** `surex: command not found`, exit 127. The binary is installed and present at
  `~/.claude/plugins/cache/surex/surex/0.1.0/bin/surex`, but no plugin directory appears in `PATH` in the
  shell the agent runs `Bash` commands in.
- **How we found out:** installed the plugin the real way —
  `claude plugin marketplace add https://github.com/SantiagoDevRel/surex` then
  `claude plugin install surex@surex`, both of which succeeded and
  `claude plugin details surex` correctly reports `Hooks (2) PreToolUse, SessionStart` — then asked a
  session to run `surex status`. Repro:
  ```bash
  claude plugin install surex@surex
  echo 'run: surex status' | claude -p --allowedTools Bash
  # → /usr/bin/bash: line 2: surex: command not found
  echo "$PATH" | tr ':' '\n' | grep -i plugin    # → nothing
  ```
- **Why it matters beyond convenience:** SureX prints an override command in every block message, and that
  escape hatch is the entire reason blocking a tool call is defensible — a block a user cannot pass is a
  block that gets the gate uninstalled the first time it is wrong. A printed command that does not exist is
  worse than no command at all.
- **Our fix:** the gate resolves its own install location and prints an invocation that works
  (`node "<abs>/bin/surex" allow <fp>`), preferring the bare form only when `bin/` genuinely is on PATH. We
  also ship a `/surex` slash command, which works regardless.
- **What would have prevented it:** either add the directory to PATH as documented, or drop the claim from
  the docs and tell plugin authors to expect `${CLAUDE_PLUGIN_ROOT}/bin`. Right now the documentation
  describes a capability that a plugin author will build a user-facing instruction on top of.

### C5 · `session_id` stability across `/clear` and `/compact` is undocumented
`/branch` is documented to produce a new session id. `/clear`, `/compact` and `/resume` are not described
either way. Any hook implementing "approve once per conversation" depends on this, and it is not guessable.

**`/compact` is answered directly. `/clear` is not.**

- ✅ **`/compact` preserves `session_id` — VERIFIED by direct observation.** It turns out `/compact` *can*
  be driven headlessly: `claude -p --session-id <uuid>` for the first turn, then `printf '/compact' |
  claude -p --resume <uuid>`, then another tool call on the same resumed session. The transcript confirms
  the compaction really happened (a `compact_boundary` record with `isCompactSummary`, and the `/compact`
  command recorded), it carries exactly **one** distinct `sessionId` throughout, and the hook invoked
  *after* the boundary saw that same id. Repro in `probes/hook/README.md`. A hook's per-session state
  therefore survives compaction.
- ⚠️ **`/clear` is still inference, not observation.** It cannot be driven this way. Across every
  transcript on this machine there are 10 genuine `/clear` records and all 10 sit at line index 3–7 — i.e.
  `/clear` opens a **new** transcript file and the previous session's file simply ends. Consistent, and
  consistent with a new `session_id`, but not the same standard of evidence as the line above. Labelled
  that way rather than rounded up.
`probes/hook/` leaves a logging hook in place so the `/clear` half can be settled interactively too; see
`probes/hook/README.md`.

**What would have prevented it:** one row in the hooks reference —
`/clear` → new · `/compact` → same · `/branch` → new · `/resume` → ?. It is three lines of documentation
guarding a behaviour every stateful hook has to reverse-engineer.

---

## How this gets used at submission

- **World** — W1 is a real, reproducible bug with a root cause and a suggested patch. Lead the booth conversation with it.
- Beta tracks (Selfie Check / Identity Check) grade **testing documentation covering both developer and user feedback** as a required deliverable. If we touch either, the user-side half has to be written too — it is not optional.
- Keep the repro scripts. "Here is the failing case" beats a paragraph.

---

## MCP SDK

Building `packages/fixture-mcp` (the malicious fixture) against `@modelcontextprotocol/sdk@1.29.0`, Node 22.22.3.

### M1 · To ship tool descriptions that intentionally diverge from behaviour, you need the low-level `Server`, not `McpServer`

**What we expected.** The SDK's headline API, `McpServer.registerTool(name, { description, inputSchema }, handler)`, would let us hand-author a tool description that lies about what the handler does — the whole premise of the fixture.

**What happened.** It can, but it is built around *honest* tools: `inputSchema` is a Zod raw shape, the framework derives the advertised JSON Schema from it, and the mental model couples the declared surface to the implementation. For a fixture whose declared metadata must be arbitrary hand-written JSON (a plain JSON Schema, description free-text, deliberately unrelated to the code), the clean primitive is the **low-level `Server`** from `@modelcontextprotocol/sdk/server/index.js` with `setRequestHandler(ListToolsRequestSchema, …)` and `setRequestHandler(CallToolRequestSchema, …)` returning the tool list you author by hand. It also drops the Zod dependency entirely.

**How we found out.** Read `dist/esm/server/{index,mcp}.js` exports and confirmed the low-level handler API against the installed build (`ListToolsRequestSchema.shape.method.value === 'tools/list'`). Not a bug — an API-selection gotcha.

**What would have prevented it.** One line in the server README: *"use the low-level `Server` when you need full control over the raw tool metadata (or want no Zod)."* Not observed there; the docs lead with `McpServer`.

### M2 · A stray non-JSON line on the server's stdout did **not** break the stdio handshake — correcting a common assumption — **[VERIFIED, reproduced]**

**What we expected.** MCP stdio framing is newline-delimited JSON-RPC on stdout, so a stray `console.log(...)` in the server (e.g. a startup banner) would corrupt the stream and make the client's `initialize` fail. We designed the fixture to print status to **stderr** on that assumption.

**What happened.** On `@modelcontextprotocol/sdk@1.29.0`, a server that prints a plain-text line to stdout *before* `server.connect(new StdioServerTransport())` still completes the client handshake — the probe client reported `connected OK`, not a parse failure. The SDK's client-side read buffer tolerated the leading non-JSON line rather than treating it as fatal. (Scope: tested for a line emitted around startup/connect; a line interleaved *between* JSON-RPC messages mid-session was not tested and may differ.)

**How we found out.** Minimal repro, run from inside the repo so the SDK resolves:

```js
// _probe-bad-server.mjs
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
console.log('STRAY STDOUT LINE');                       // the supposed bug
const s = new Server({name:'bad',version:'1'},{capabilities:{tools:{}}});
s.setRequestHandler(ListToolsRequestSchema, async () => ({tools:[]}));
await s.connect(new StdioServerTransport());
```
```js
// _probe-client.mjs — spawns the above, attempts the MCP initialize handshake
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const t = new StdioClientTransport({ command: process.execPath, args: [process.argv[2]] });
const c = new Client({name:'probe',version:'1'});
try { await c.connect(t); console.log('RESULT: connected OK'); await c.close(); }
catch (e) { console.log('RESULT: FAILED ->', e.message); }
```
`node _probe-client.mjs "$(pwd)/_probe-bad-server.mjs"` → `RESULT: connected OK`.

**What would have prevented it.** Nothing to fix in our code — this *corrects our own assumption*. The fixture still routes status to stderr as good hygiene (and because interleaved mid-session output is untested), but the belief "any stdout noise breaks a stdio MCP server" is not true for this SDK version around the handshake. Worth knowing before spending time hunting a non-existent corruption bug.

---

## DGX / OpenAI-compatible endpoint

Building `packages/reviewer` against the on-site DGX Spark (GB10, 122 GiB unified memory) running
**ollama 0.30.11**, reached over its `/v1` OpenAI-compatible surface. Node 22.22.3, Windows 11 client.
Not a sponsor SDK, but the reviewer is a load-bearing dependency of every verdict and these cost real time.
Service env on the box: `OLLAMA_HOST=0.0.0.0:11434`, `OLLAMA_MAX_LOADED_MODELS=1`, `OLLAMA_NUM_PARALLEL=4`.

### D1 · A 51 GiB model with a 262k declared context is killed by earlyoom mid-load, and the error blames the model — **[VERIFIED, reproduced twice]**
**Severity: high.** Two dead ends totalling ~15 minutes, and the error message points nowhere near the cause.

- **Expected:** `qwen3-coder-next:q4_K_M` (51.7 GiB on disk) loads into 122 GiB of unified memory with room
  to spare.
- **Happened:** the load ran for **2m55s** and then died. Ollama reported
  `Load failed ... error="llama-server process has terminated: signal: terminated"` and returned `500` on
  `POST /api/generate` after 2m55s. Nothing in that message suggests memory, and `ollama ps` afterwards
  shows an empty model list — it reads as a corrupt model or an ollama bug.
- **How we found out.** `journalctl -u earlyoom`, only after the second failure:
  ```
  low memory! at or below SIGTERM limits: mem 10.00%, swap 10.00%
  mem avail: 11750 of 124610 MiB (9.43%), swap free: 207 of 16383 MiB (1.27%)
  sending SIGTERM to process 2677144 uid 996 "llama-server": badness 1022, VmRSS 11791 MiB
  ```
  Note `VmRSS 11791 MiB` — earlyoom's own view of the process was 11 GiB, so the footprint was mostly
  outside RSS (unified-memory allocation plus mmap page cache). The box's `dgx-gpu-watchdog` looked at the
  same pressure and correctly declined to act; earlyoom got there first.
- **Root cause:** the model declares `n_ctx_train = 262144` and ollama sizes the KV cache from that. With
  `OLLAMA_NUM_PARALLEL=4` that is ~1M tokens of KV. Available memory went 117 GiB to 12 GiB and swap to
  zero. The model file is 51.7 GiB; the load was reaching for roughly twice that.
- **Fix, and it is two lines.** Cap the context in a derived model — the OpenAI-compatible API has no
  `num_ctx`, so it cannot be done per request:
  ```
  FROM qwen3-coder-next:q4_K_M
  PARAMETER num_ctx 32768
  PARAMETER use_mmap false
  ```
  `ollama create qwen3-coder-next:surex32k -f Modelfile`. Ollama then reports
  `projected to use 50250 MiB of device memory vs. 120175 MiB of free`, offloads 49/49 layers, and loads in
  ~90 s. Measured after: **53 GiB used, 68 GiB available, swap untouched**, versus 112 GiB used and a kill.
- **What would have prevented it:** a load-time check comparing the projected KV cache against free memory
  *before* spending three minutes reading weights, and an error that says "killed by an external signal,
  check the OOM killer" instead of naming the model. Ollama has the projection — it prints
  `common_params_fit_impl` — it just prints it after committing to the load.
- **Carry into the event:** on a shared box, `num_ctx` is not a tuning knob, it is a prerequisite. And check
  `journalctl -u earlyoom` before believing any local-inference error message.

### D2 · A reasoning model spends `max_tokens` on thinking and returns empty `content` with `finish_reason: "length"` — **[VERIFIED]**
**Severity: high.** This is the one that could have silently produced wrong verdicts.

- **Expected:** `max_tokens: 8` with a trivial prompt returns a short answer, or an error.
- **Happened:** HTTP **200**, and:
  ```json
  {"choices":[{"message":{"role":"assistant","content":"",
    "reasoning":"The user says \"say"},"finish_reason":"length"}],
   "usage":{"prompt_tokens":69,"completion_tokens":8,"total_tokens":77}}
  ```
  `content` is `""`. The whole budget went to `message.reasoning`, a **non-standard field** the OpenAI schema
  does not define, and the response is a success by every status check.
- **Why it matters here:** a reviewer that reads `choices[0].message.content` and treats "no findings" as
  "nothing found" would emit a `clean` verdict from a model that never answered. That is the exact
  laundering failure the spec's hard rule exists to stop, arriving through a 200.
- **How we found out:** our own `--ping` returned `empty_response` where a naive parser would have returned
  a pass.
- **Fix:** treat `finish_reason: "length"` as a **failed** review, never a result (`src/model.mjs` ->
  `code: 'truncated'`); require non-empty content or fail; budget 8192 output tokens by default; and strip
  inline `<think>...</think>` for servers that embed reasoning in `content` instead.
- **Repro:**
  ```bash
  curl -s http://HOST:11434/v1/chat/completions -H 'content-type: application/json' \
    -d '{"model":"gpt-oss:20b","messages":[{"role":"user","content":"say ok"}],"max_tokens":8}'
  ```
- **What would have prevented it:** documenting that `max_tokens` budgets reasoning *and* content on
  reasoning models, and that `reasoning` is where the tokens went. Everything about the response says success.

### D3 · `GET /v1/models` is the only liveness probe that can tell "down" from "loading" — **[VERIFIED]**
**Severity: medium.** Not a bug; a design constraint that is easy to get wrong.

- **Expected:** a one-token completion is a cheap health check.
- **Happened:** the first completion after a cold start takes **90 s to 3 min** while weights load, so a
  probe with any sane timeout reports the endpoint as down when it is merely loading. Ours did.
- **Fix:** `GET /v1/models` — same OpenAI-compatible surface, so it stays swappable — answered in **371 ms**
  and also confirms the configured model id is actually present, which catches a typo'd
  `SUREX_REVIEWER_MODEL` before it becomes a failed review. `ollama ps` returning `{"models":[]}` during a
  load is not evidence of a problem either.

### D4 · Ollama accepts `response_format: {type:"json_object"}` and still returns fenced or prefaced JSON — **[VERIFIED]**
**Severity: low, but it decides your parser.**

- **Expected:** JSON mode means the body is a JSON object.
- **Happened:** across the real runs, output arrived variously bare, inside a fenced block, and with a
  sentence of preamble. No error, and no warning that the request's `response_format` was not honoured.
- **Fix:** parse defensively but never *repair*: try `JSON.parse`, then a single fenced block, then brace
  balancing that ignores braces inside strings. A truncated object fails. `src/schema.mjs` -> `extractJson`.
- **What would have prevented it:** a response field stating whether `response_format` was applied. Silent
  non-enforcement of a request parameter is worse than rejecting it.

### D5 · The model shortens the file paths you gave it, which turns a real finding into an unopenable one — **[VERIFIED on the first real run]**
**Severity: medium.** Not the model's fault, and entirely our problem to solve.

- **Expected:** findings cite the paths supplied in the prompt.
- **Happened:** asked to review `packages/fixture-mcp/src/tools/search.mjs` — the path is in the prompt's own
  `--- FILE: ... ---` header — `gpt-oss:20b` reported every finding against `src/tools/search.mjs`. Line
  numbers were mostly right (130 and 146 exact; 107 vs 110, 118 vs 117 off by a few). The larger
  `qwen3-coder-next:surex32k` used the full paths correctly, so this is a capability-dependent failure that a
  smaller endpoint will reintroduce the moment the DGX is swapped out.
- **Why it matters:** a SureX block message tells a developer to open a file at a line. A path that does not
  resolve is a fabricated `file:line` from the reader's point of view, whatever the model intended.
- **Fix:** reconcile every model-reported path against the files actually supplied — exact match, else a
  *unique* suffix match rewritten with `pathNormalisedFrom` recording what the model said, else keep the
  finding and mark it `pathUnresolved`. Lines past the end of a file are marked `lineOutOfRange`. Nothing is
  dropped; nothing unplaceable is quoted as *the* evidence. `src/review.mjs` -> `reconcileFindingPaths`.
- **Carry into the event:** never render a model-supplied path or line without checking it against the input
  you sent. This is cheap, and it is the difference between evidence and a plausible-looking string.

### D6 · An over-long prompt is silently truncated to fit `num_ctx` — there is no error to catch — **[VERIFIED by construction, not yet by a failing review]**
**Severity: high** for anything that reviews real packages, and invisible until it burns you.

- **Expected:** a prompt larger than the model's context returns an error, the way an oversized request does
  on a hosted API.
- **Happened:** it does not. ollama sizes the KV cache from `num_ctx` and **drops tokens to make the request
  fit**. The call returns 200 with a well-formed answer about the part of the input that survived. There is
  no field in the response that says anything was discarded.
- **How we found it:** wiring the reviewer at real npm packages rather than at our own fixtures. The
  reviewer's prompt budget (`LIMITS.maxTotalChars = 120_000`, roughly 30–40k tokens) was sized when every
  input was a three-file fixture. The review model is `qwen3-coder-next:surex32k` — 32 768 tokens, of which
  8 192 are reserved for the reply. A single real package would have gone over the line, and the failure
  would have been **a confident `clean` about files the model never received**. That is the single worst
  output this system can produce, and nothing in the transport would have reported it.
- **Fix:** the budget is now a parameter (`renderSource(files, limits)` → `buildPrompt` → `reviewServer`),
  callers reviewing real packages pass one that fits their model, and the review record carries
  `run.sourceCoverage` — files supplied, files omitted or truncated, and which. A verdict that could not see
  a file now says so.
- **Carry into the event:** with a local OpenAI-compatible endpoint, the context limit is **your** invariant
  to enforce. Budget the prompt against `num_ctx` yourself, and record what you left out — the server will
  not tell you, and "it answered" is not evidence that it read the input.

### D7 · Two greedy readings of the same code disagree often enough to publish an accusation by accident — **[VERIFIED, 3× over 16 fixtures]**
**Severity: high.** This one is about panel design, not about a bug in anything.

- **Expected:** at `temperature: 0`, two prompt variants over identical source either agree, or disagree
  because they genuinely read the code differently.
- **Happened:** `honest-sqlite` — a fixture we wrote to be well behaved, and which the other 15 runs agree is
  clean — came back **flagged, clean, clean** across three identical inputs. Greedy sampling is not
  determinism when the prompt carries a fresh nonce: the split is *noise*, and the merge rule at the time
  resolved a split by keeping the more accusatory side. So a coin flip became a published `flagged`.
- **How we found it:** `scripts/calibrate.mjs --runs 3`, which scores every fixture against the ground truth
  its own specification recorded before any review ran. Of 16 fixtures, the 15 correct verdicts all came back
  with `agreementRuns: 2`; the single wrong one was the only one with `agreementRuns: 1`. Disagreement was a
  perfect predictor of error on this set.
- **Fix:** a split now buys one more reading of **each** prompt — a balanced panel of four, fresh nonce each — and the majority decides; with no majority
  the verdict is `unreviewable` / `no-agreement` rather than the cautious side of the split. Note what does
  *not* change: `decide()` already answered `warn` for a severity-2 flag, and answers `warn` for
  `unreviewable` — the user-facing action is identical. What changed is whether the registry makes a claim
  about somebody's code that it cannot support.
- **Carry into the event:** if you are voting two model runs, measure how often they split on inputs whose
  answer you already know, before you decide what a split means. Ours split on 1 in 16, and the tie-break
  costs one extra call on exactly those.

### D8 · GNU `tar` reads a Windows absolute path as a remote host, and it fails on every package — **[VERIFIED, reproduced]**
**Severity: low** on its own; it is here because of *when* it would have been discovered.

- **Expected:** `tar -xzf <abs>.tgz -C <abs-dir>` extracts an npm tarball. Windows ships bsdtar as `tar.exe`
  and accepts exactly that.
- **Happened:** in a POSIX shell `tar` is **GNU tar**, which reads any argument containing a colon as
  `host:path` and tries to fetch a remote archive. Every package failed identically:

  ```
  tar (child): Cannot connect to C: resolve failed
  gzip: stdin: unexpected end of file
  tar: Child returned status 128
  ```

- **How we found out:** `node scripts/review-known.mjs --no-review --limit 4`, a mode added for exactly this —
  it runs resolve → licence gate → fetch → extract → install → `tools/list` → prompt budgeting and stops
  before the model. Four packages, seconds, four identical failures. Without it the first evidence would have
  been 58 `unreviewable(source-unavailable)` rows at the end of an hour of GPU time, and "the tarball could not
  be extracted" reads exactly like a fact about the package rather than about our shell.
- **Fix:** extract with `cwd` set to the destination and a **relative** filename — no colon, works under both
  tars. `scripts/review-known.mjs` → `fetchTarball`.
- **Carry into the event:** before any long unattended batch, run the whole pipeline with the expensive stage
  disabled. And on Windows, treat every absolute path handed to a POSIX tool as suspect — the drive letter is a
  colon, and a colon means something else to half of them.

### D9 · A real MCP server needs far longer than a fixture to answer `tools/list` — **[VERIFIED]**
- **Expected:** 8 s is plenty for an stdio handshake plus `tools/list`. It is, for a fixture.
- **Happened:** `@modelcontextprotocol/server-everything` and `@modelcontextprotocol/server-puppeteer` both
  timed out — a real server may build a driver or an index before it serves. At 20 s puppeteer answers.
- **Why it matters here:** the declared tool list is the sharpest axis a review has ("the code does more than
  the tools say" needs the tools). Losing it degrades the review to README-only, quietly.
- **Also worth recording:** of six well-known servers started with a scrubbed environment, three exited
  immediately (`exited:1`) because they require an API key to boot. That is not a failure of the review — it
  is a fact about the server, it is recorded in `toolSource`, and the verdict says which servers were read
  against their README alone rather than against their own declarations.

### D10 · We shipped World's `lookupHuman` bug in our own licence gate — **[VERIFIED, 5/5 vs 1 failure under load]**
**Severity: high**, and the reason it is in this log is that we wrote W7 about somebody else's SDK and then
did the identical thing.

- **W7, about `@worldcoin/agentkit-core`:** `lookupHuman()` ends its AgentBook read with a bare
  `} catch { return null }`, so a dead RPC, a 429 and a genuinely unregistered agent are indistinguishable —
  and `null` is the deny signal. Never believe a `null`.
- **What we did:** `licenceGate` fetched `LICENSE` from the repo through a helper that returned `null` on any
  failure. A 404 (a real answer: no such file) and a 429 (no answer at all) collapsed into the same value, and
  the gate concluded *no licence file found in repo* → **ineligible**.
- **What that publishes:** `unreviewable`, reason `licence`, rendered on the site as *"no licence permits us
  to store this source"* — a public statement about somebody else's correctly licensed package, caused by a
  rate limit.
- **How we found out:** `@modelcontextprotocol/server-everything` came back licence-ineligible during a
  58-package loop, having come back **Apache-2.0 and eligible** in a smaller run minutes earlier. Probing it
  five times on a healthy network: `eligible=true spdx=Apache-2.0` five times out of five, and the LICENSE
  file 200s. The difference was load, not licensing.
  ```bash
  node scripts/review-known.mjs --no-review --only server-everything   # licence Apache-2.0
  ```
- **Fix:** the fetch reports *why* it failed. 404 is an answer and moves to the next candidate filename;
  429/5xx/timeout is retried, and if it still fails the gate returns `undetermined: true` — not eligible, but
  explicitly refusing to claim ineligibility. The caller then leaves the entry alone instead of publishing a
  verdict about it. Five tests, mutation-checked.
- **Carry into the event:** this is the most transferable lesson we have. **Any function that returns a bare
  falsy value for both "no" and "could not ask" will eventually publish the wrong one**, and the wrong one is
  usually the harmful one. We found it in a sponsor SDK, wrote it up, and still shipped it ourselves the same
  day, in code whose entire purpose is not making false claims about other people's work.

### D11 · Two "paraphrased" prompts were asking different questions, and only real packages revealed it — **[VERIFIED, reproduced 4/4]**
**Severity: high** for anything using multi-prompt agreement as a confidence signal.

- **Expected:** two paraphrases of one review prompt disagree occasionally, on genuinely borderline code.
- **Happened:** on real npm packages they disagreed *systematically*, each variant reproducing its own answer
  in both rounds of a four-reading panel. On `@modelcontextprotocol/server-memory` — a server whose declared
  purpose is persisting a knowledge graph to a file — the panel read **clean, flagged, clean, flagged**.
- **Cause, found by dumping both raw outputs:** variant A carried the line *"do not report ordinary
  implementation detail, style, or a capability the description accounts for"*. Variant B carried no
  equivalent, and drifted into a general hardening audit. Its findings were: that the server writes its memory
  file in the install directory (which its README states), that someone who controls `MEMORY_FILE_PATH` could
  point it elsewhere (someone who sets a server's environment can already run anything), and that the
  migration path logs to stderr. All true; none of them the question the product asks.
- **Why fixtures never caught it:** our fixtures carry exhaustive, hand-written descriptions that account for
  every capability, so both variants agree on them. Real packages have a README. **A calibration set that is
  more articulate than the population it stands for will not surface this class of defect** — which is worth
  more than the fix itself.
- **Fix:** the scope rule — what is and is not a finding — moved into a block **both** variants carry
  (`SCOPE_RULE`, prompt `rv-3`), with a test asserting both prompts contain it verbatim. Recall on the
  malicious fixtures held at 6/6 blocking after the change, which is the check that separates "fixed the
  prompt" from "tuned it toward silence".
- **Second finding, same investigation:** the per-file prompt budget was 12 000 characters and a published MCP
  server is typically **one** compiled file — `server-memory` is 19 000 characters of `dist/index.js` and
  nothing else. The model was being shown the first 63%: imports and path setup, every tool implementation cut
  off. It then flagged the only code it could see. A budget shaped for "many small files" is the wrong shape
  for the packages that exist.

---

## Vercel / Hono

Written while building `apps/api` (the read path) on 2026-07-25. Node v22.22.3, Windows 11,
`hono@4.12.32`, `@hono/node-server@1.19.15`, `@arkiv-network/sdk@0.7.0`, `viem@2.55.8`.

### V1 · Arkiv 0.7.0 `QueryResult` pagination fails three different ways, and the first two fail *silently* — **[VERIFIED, reproduced live on Braga]**

> **Belongs in the Arkiv section as A6.** It is filed here only because the API lane owns this
> section of the log; whoever owns the A-series should renumber and move it.

**What we expected.** A conventional cursor loop over a query result:

```js
let result = await builder.fetch();
const all = [...result.entities];
while (result.hasNextPage) {          // ← wrong twice over
  result = await result.next();        // ← wrong again
  all.push(...result.entities);
}
```

**What happened.** Three separate faults, in the order we hit them:

1. **`hasNextPage` is a METHOD, not a getter.** `while (result.hasNextPage)` reads a function
   reference, which is always truthy, so the loop always enters. Nothing warns; there is no type error
   at runtime and no lint rule catches it in plain `.mjs`.
2. **`next()` mutates the result in place and returns `undefined`.** So `result = await result.next()`
   sets `result` to `undefined` and the next line throws `Cannot read properties of undefined`. The
   name `next()` reads like an iterator step that yields the next page; it is a `void` mutator.
3. **Pagination does not exist without an explicit `.limit()`.** From the shipped source,
   `_endOfIteration = !limit || entities.length < limit`. With no limit the result declares itself
   finished after one page — so a listing query quietly returns only the first page — and if you call
   `next()` anyway it throws `NoCursorOrLimitError: Cursor and limit must be defined to fetch next`.
   The error names the requirement but not the fact that **you** must set the limit; nothing on
   `buildQuery()` suggests a limit is a pagination prerequisite rather than a cap.

Fault 3 is the dangerous one for us: `GET /v1/flagged` and `GET /v1/stats` would have silently served
only the first page of a growing registry, with no error and no truncation flag — a flagged server
missing from the public feed because it sorted onto page two.

**How we found out.** Not from the docs and not from the unit suite (which is hermetic). The live
smoke test against Braga crashed with `NoCursorOrLimitError` on the very first listing query. Faults 1
and 2 only became visible after reading the SDK's own `queryResult.ts` in `node_modules` — they had
been masked because `_endOfIteration` was already `true`, so the broken loop body never ran.

**Repro.** `node apps/api/test/live-arkiv.smoke.mjs` against the pre-fix `fetchAllPages`. The correct
shape, now in `apps/api/src/arkiv.mjs`:

```js
const result = await builder.limit(PAGE_SIZE).fetch(); // the limit is REQUIRED
const all = [...result.entities];
while (result.hasNextPage()) {   // a call, not a property
  await result.next();           // mutates `result`, returns undefined
  all.push(...result.entities);
}
```

**What would have prevented it.** Three lines of JSDoc on `QueryResult`: that `hasNextPage()` is a
method, that `next()` mutates and returns `void`, and that `limit()` is required for pagination rather
than optional. Better still, make `next()` return the result (`return this`) so the natural
`result = await result.next()` works, and either default the page size or **throw at `fetch()` time**
when a query is paginated without one — instead of returning a silently truncated first page.

### V2 · `@hono/node-server/vercel` is the Node-runtime adapter and `hono/vercel` is not — the two are one character apart in an import — **[VERIFIED by inspection of both packages' exports]**

**What we expected.** One documented Vercel adapter for Hono.

**What happened.** There are two, they have nearly the same specifier, and they target different
runtimes: `hono/vercel` is the Edge adapter, `@hono/node-server/vercel` is the Node one. Our API needs
Node — `node:crypto` for the timing-safe admin compare, the Arkiv SDK's viem transport, and JSON
import attributes for the fixtures all require it. Importing `handle` from the wrong one produces a
function with the right name and the right signature that fails only at deploy time, on the platform,
in whichever way the missing Node built-in surfaces first.

**How we found out.** Read `exports` in both `package.json` files before writing the entry file,
because the near-identical names looked like a trap. They were.

**What would have prevented it.** A one-line note in either package's README: *"for the Node.js runtime
on Vercel, import from `@hono/node-server/vercel`; `hono/vercel` is Edge-only."* Cheaper still, a
runtime warning when the Edge adapter finds itself in a Node process.

### V3 · Our own bug, recorded because it is a general shape: an un-cleared `AbortController` timer held the process open for 120 s — **[VERIFIED, reproduced by test]**

`loadModel()` set `setTimeout(() => controller.abort(), 120_000)` for the reviewer request and cleared
it on neither the success nor the failure path. Every call therefore left a live 120-second timer
holding the event loop open. Symptom: `node --test` printed all 62 passing assertions in ~370 ms and
then **sat for 100 seconds** before exiting, which reads exactly like a hanging test rather than a
leaked handle. On a serverless invocation the same leak keeps the function alive long after it has
answered.

**Repro / guard.** `apps/api/test/admin.test.mjs` → *"loadModel leaves no pending timer behind"*,
asserting `process.getActiveResourcesInfo()` returns to its baseline `Timeout` count after the call.
Fix: `finally { clearTimeout(timer) }`.

**Worth writing down** because the shape is generic — every fetch-with-timeout helper in this repo has
it — and because the *symptom* points at the wrong culprit. If a test file hangs after reporting all
its passes, look for a leaked timer, not for a slow test.

---

### V6 · `@hono/node-server/vercel` loses the request body, so every POST hangs — **[VERIFIED]**
**Severity: high.** Every GET works, so the deployment looks healthy; only the routes that read a body are
dead, and they are dead by *timeout* rather than by error.

- **Expected:** `export default handle(app)` from `@hono/node-server/vercel` serves a Hono app on Vercel's
  Node runtime, bodies included. It is the adapter the package exists for.
- **Happened:** every GET answered in well under a second — `/`, `/healthz`, `/v1/registry`, `/v1/stats`,
  `/v1/verdict` — and **every request with a body returned 504 after 20 s**: `/v1/verdicts/batch`,
  `/v1/disputes`, `/v1/submissions`. `Vercel Runtime Timeout Error: Task timed out after 20 seconds`.
- **The tell that separated cause from coincidence:** `POST /nope`, which matches no route and therefore
  never reads a body, answered **404 in 1.3 s**. So it is not POST that breaks, and not the routing — it is
  reading the body.
- **Root cause:** Vercel's Node runtime **pre-parses the request body onto `req.body`** and leaves the
  underlying stream consumed. An adapter that constructs a Web `Request` from that stream is waiting on
  something that will never emit another byte.
- **Why it hides:** a read-mostly API is all GETs. Ours looked completely healthy on every route a browser
  would touch. The route it actually broke is the gate's `SessionStart` prefetch — a security component
  silently losing its warm-up path.
- **Repro:** deploy a Hono app via `handle(app)` on the Node runtime, then
  `curl -X POST https://<url>/<any route that reads json> -d '{}'` → 504 after the function timeout, while
  `curl -X POST https://<url>/<no such route> -d '{}'` → 404 immediately.
- **Fix:** a hand-written entry (`apps/api/api/index.mjs`) that reads `req.body` when Vercel has already
  parsed it — object, string or Buffer — and only drains the stream when it has not, with a bounded wait so a
  spent stream can never hold the function open.
- **One trap inside the fix, worth its own line:** the bounded wait must **not** be `unref()`'d. An unref'd
  timer does not hold the event loop open, so with a spent stream and nothing else pending it never fires and
  the promise never settles — the same hang in a different hat. A test caught it; reasoning did not.
- **What would have prevented it:** the adapter reading `req.body` when it is present, or the docs saying
  plainly that Vercel consumes the stream. Either way, a body-carrying request in the package's own Vercel
  example would have surfaced it immediately.

### V4 · An auto-detected framework preset makes `/` HANG instead of reaching the function — **[VERIFIED]**
**Severity: medium**, and nastier than a 500, because a hang reads as a network fault on the caller's side
rather than as a problem with the deployment.

- **Setup:** an `api/index.mjs` function plus `"rewrites": [{ "source": "/(.*)", "destination": "/api/index" }]`
  — the documented pattern for putting one server behind a Vercel project. `vercel link` auto-detected the
  framework as **Hono** and we left that alone.
- **Expected:** every path reaches the function, root included.
- **Happened:** every path did — `/healthz` 200, `/v1/stats` 200, `/nope` a clean 404 from the app's own
  handler — but `GET /` never returned at all. Connection established, request sent, nothing back until curl
  gave up at 25 s.
- **How we found out:** runtime logs, the only place the answer is visible. Every other path logs
  `[info/serverless]`; the root logs **`GET / 0 [info/static]`** — status 0, source *static*. The function
  module had even booted (its startup line appears in the same log entry), so from outside it looked exactly
  like our app hanging on one route.
- **The wrong fix, recorded because it cost a deploy:** adding an explicit `{ "source": "/", "destination":
  "/api/index" }` before the catch-all changed nothing. Rewrites are evaluated *after* the filesystem check,
  so a root already claimed by the static layer never reaches them.
- **The actual cause:** the **auto-detected framework preset**. It gives the project a static output root,
  and the bare `/` resolves there first. Setting `framework: null` — a plain functions-plus-rewrites project
  — fixed it immediately: `/` went from a 25 s hang to `200` in 0.41 s, with every other route unchanged.
- **Repro:** deploy an `api/*` function with a catch-all rewrite and framework `hono`; `curl -v https://<url>/`
  times out with 0 bytes while `curl https://<url>/nope` answers instantly. Set framework to none, redeploy,
  and the root answers.
- **What would have prevented it:** the static handler returning **404** when it has nothing to serve. A
  platform that hangs where it means "not found" costs far more debugging time than the same condition
  reported as a status code — and auto-detecting a framework for a project that is only functions is what put
  the static handler in the path at all.

### V5 · `vercel build` cannot run locally here, which is exactly when you need it — **[VERIFIED]**
- **Expected:** `vercel pull && vercel build` reproduces the remote build locally, so a routing problem can be
  diagnosed by reading the generated `.vercel/output/config.json` instead of by redeploying.
- **Happened:** `Error: spawn cmd.exe ENOENT`, in both Git Bash and PowerShell, on a machine where
  `$env:ComSpec` is `C:\Windows\system32\cmd.exe`, that file exists, and `System32` is on `PATH` twice.
  No `.vercel/output` is produced, so there is nothing to inspect.
- **Why it matters:** the rule after a failed remote fix is to stop guessing and reproduce locally. This is the
  tool for that, and on Windows it was unavailable precisely when the routing behaviour needed explaining —
  which is how V4 above cost an extra deploy instead of being read off a config file.

### V7 · A project with a Root Directory can only be deployed by CLI from the **repo root**, and the error message points at a path nobody wrote — **[VERIFIED]**

Adding the third app in this monorepo (`apps/docs`) hit this twice, once in each direction.

- **First direction — link from the subdirectory, get a project with no root.** `vercel link --yes --project
  surex-docs` run inside `apps/docs` creates the project and writes a `.vercel/project.json` with **no
  `settings` block**, so `rootDirectory` is unset. The next `vercel deploy` uploads only `apps/docs`
  (220 KB, 66 files) and the build dies on `npm install` — because `@surex/core` is a `workspace:*`
  dependency that does not exist outside the workspace root. The failure names npm, not the layout.
- **Second direction — set the Root Directory, and the CLI stops working from that directory.** With
  `rootDirectory: "apps/docs"` set on the project, running `vercel deploy` from `apps/docs` fails with:

  ```
  Error: The provided path “…\projects\surex\apps\docs\apps\docs” does not exist.
  ```

  The CLI resolves `rootDirectory` **relative to the working directory** rather than to the repository, so
  the correct place to run it is the repo root — which is the one directory that is not linked to the
  project. Copying `.vercel/project.json` to the root and deploying from there works first time.
- **Also:** there is no `vercel project update`, so `rootDirectory` cannot be set from the CLI at all. It is a
  dashboard field, or `PATCH /v9/projects/{id}` with `{"rootDirectory": "..."}`. Connecting the project to
  the GitHub repository is `POST /v9/projects/{id}/link` — `gitRepository` on the PATCH body is rejected
  with *"should NOT have additional property"*.
- **What would have prevented it:** `vercel link` inside a workspace member could offer to set the Root
  Directory it can already infer from `pnpm-workspace.yaml` — it detects the framework in that same step. And
  the path error could say which directory it resolved from: `apps/docs/apps/docs` is unmistakably a doubled
  prefix, and naming the base would have made the fix obvious instead of a guess.
- **Fix we shipped:** the project is connected to the repository, so a push to `main` deploys it and nobody
  needs the CLI dance. The dance is written down in `apps/docs/AGENTS.md` for the day someone does.

## Next.js / Tailwind v4

Found while building `apps/web` (the registry site) on **Next 15.5.21 · Tailwind 4.3.3 · React 19 ·
Node 22.22.3 · pnpm 9.12.3 · Windows 11**.

### N1 — Editing `package.json` under a running `next dev` silently 404s the CSS route [VERIFIED]

**Expected:** adding `"type": "module"` to `apps/web/package.json` is a metadata change; `next dev` either
picks it up or ignores it.

**What happened:** the running dev server kept serving pages with **HTTP 200** but
`/_next/static/css/app/layout.css?v=…` began returning **404**. Every page rendered as unstyled HTML —
correct DOM, zero CSS — while the terminal showed
`TypeError: __webpack_modules__[moduleId] is not a function` and
`Could not find the module …/next-devtools/userspace/app/segment-explorer-node.js#SegmentViewNode in the
React Client Manifest`.

**How we found out:** a headless screenshot came back as unstyled black-on-white text even though
`pnpm build` was green and the compiled bundle contained the Tailwind output. `curl` on the stylesheet URL
taken from that same HTML response confirmed the 404.

```bash
# reproduce
pnpm --filter @surex/web dev &
# ... edit apps/web/package.json (add or remove "type": "module")
U=$(curl -s http://localhost:4311/ | grep -o '/_next/static/css/[^"]*' | head -1)
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:4311$U"   # → 404

# fix
kill %1 && rm -rf apps/web/.next && pnpm --filter @surex/web dev
U=$(curl -s http://localhost:4311/ | grep -o '/_next/static/css/[^"]*' | head -1)
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:4311$U"   # → 200
```

**What would have prevented it:** the dev server failing loudly. A 404 on the app's only stylesheet is not a
recoverable condition, and returning 200 for the page while dropping its CSS produces a symptom
("Tailwind isn't working") that sends you to `@theme`, PostCSS and `content` globs — none of which is the
problem. Next already restarts itself on `next.config.ts` changes; `package.json` `type` deserves the same
treatment, or at minimum a fatal error instead of a silent asset 404.

### N2 — `animation-delay` + `fill-mode: both` deletes content in any renderer that skips animations [VERIFIED]

**Expected:** a staggered reveal (`animation: draw .4s .35s both`) is decoration. Worst case it appears
instantly.

**What happened:** it is not decoration — it is a hidden element. `both` applies the *backwards* fill during
the delay, so for the first 350 ms the element sits at its `from` state (`transform: scaleX(0)`,
`opacity: 0`). Anything that captures before the animation finishes, or never runs it, gets nothing. Our
tier meter — the primary display for *how strongly the reviewed bytes are linked to the installed bytes* —
rendered as one visible segment out of three, and the "AUTOMATED · NO HUMAN AUDIT" counter-stamp did not
render at all. The page was factually wrong about its own verdict.

**How we found out:** headless screenshots via `chrome-headless-shell --screenshot`. CDP
`getBoundingClientRect()` reported the elements present and correctly positioned, which is what pointed at
timing rather than layout.

```bash
# 3 filled segments expected; 1 rendered
chrome-headless-shell --headless --screenshot=out.png --virtual-time-budget=4000 \
  http://localhost:4311/r/<fingerprint>
```

**Fix, and the general rule:** put the stagger in the **duration**, never in a delay — all elements start at
`t=0` and finish in sequence, so none is ever pinned at `scaleX(0)`. Where a real hold is needed, put it
inside the keyframe (`0%,60% { opacity: 0 }`) rather than in `animation-delay`. `prefers-reduced-motion`
handling does not save you here: reduced motion collapses the duration, and the delay survives.

**What would have prevented it:** treating "does this element still exist with animations off?" as part of
writing the animation. A `prefers-reduced-motion` block is not the same check — and it is worth noting this
class of bug is invisible in a browser you are watching and obvious the moment you screenshot.

### N3 — Tailwind v4 `@theme` vs `@theme inline` decides whether a token can be themed at all

**Expected:** put the palette in `@theme`, override the variables per theme, done.

**What happened:** a plain `@theme { --color-clean: #6aa87c }` resolves the hex into the generated utility,
so `text-clean` is frozen at build time and re-declaring `--color-clean` under
`:root[data-theme="light"]` changes nothing. Only `@theme inline { --color-clean: var(--sx-clean) }` emits
`color: var(--sx-clean)` into the utility, which is what lets one class follow the theme.

**How we found out:** reading the compiled `layout.css` — the utility contained the literal hex.

**What would have prevented it:** the v4 docs lead with `@theme` and treat `inline` as an optimisation
detail. For a themed design system it is the load-bearing choice, and the failure is silent: the light
variant simply does not apply. Rule of thumb — token that flips at runtime → `@theme inline` over a
`--sx-*` variable; token that never flips (radii, durations, type scale) → plain `@theme`.

### N4 — Node 22 type-stripping makes a `.ts` copy module directly testable, with two constraints

**Not a bug** — worth recording because it removed a build step from the copy-law test.

`node --test test/copy.test.mjs` imports `../lib/copy.ts` directly: Node 22.18+ strips types by default, so
the law is enforced against the same file the app imports, with no compile step in between. Two constraints
that are easy to trip:

- **explicit `.ts` extensions are required** in the import specifier (`./types.ts`, not `./types`), which
  means `allowImportingTsExtensions: true` in `tsconfig.json` — harmless with `noEmit`, and Next resolves
  the literal path fine.
- **`node --test test/` does not work** — a bare directory is resolved as a module path and fails with
  `MODULE_NOT_FOUND`. Use a glob: `node --test test/*.test.mjs`.

Without `"type": "module"` on the nearest `package.json`, every run also prints
`MODULE_TYPELESS_PACKAGE_JSON` and reparses the file. Adding it is the fix — see N1 for what that costs if
the dev server is already running.

### N5 — A fresh `nextra@4.6.1` docs site 500s on **every** page, and the error names a prop you did pass — **[VERIFIED, reduced to 6 lines]**

**Severity: high for anyone starting a Nextra site today.** A clean install of the current version, following
the current quickstart verbatim, cannot render a single page. Cost: about an hour, most of it spent bisecting
content because the production error is redacted.

- **Expected:** `nextra` + `nextra-theme-docs` 4.6.1 with the documented App Router layout
  (`<Layout navbar footer pageMap>{children}</Layout>`) builds and prerenders.
- **Happened:** `next build` fails at prerender on the first page with

  ```
  Error occurred prerendering page "/concepts/copy-law".
  [Error: An error occurred in the Server Components render. The specific message is omitted
   in production builds …] { digest: '2150316170' }
  ```

  Every page fails; the build only reports the first. Under `next dev` the real message appears:

  ```
  ⨯ [Error: ✖ Invalid input: expected nonoptional, received undefined
    → at children]
  ```

  Which is maddening, because `children` **is** passed — it is the one prop the documented example
  definitely has.

- **Root cause: version skew between `nextra-theme-docs` and zod, not a mistake in the site.**
  `dist/layout.js` destructures `children` **out** of the props and validates only what is left:

  ```js
  const { children, ...themeConfig } = t0;
  const { data, error } = LayoutPropsSchema.safeParse(themeConfig);   // children is GONE
  ```

  and `dist/schemas.js` declares it required: `LayoutPropsSchema = z.strictObject({ …, children: reactNode, … })`,
  where `reactNode` is a `z.custom()` whose predicate returns `true` for `null`/`undefined`. That combination
  used to pass. **zod 4.4.0 changed it: a *missing* key now fails a `z.custom()` field, while an explicit
  `undefined` still passes.** nextra depends on `zod: ^4.1.12`, so a clean install today resolves 4.4.3 and
  the theme validates a schema against an object it just removed the required key from.

- **Repro, no Next.js involved** (zod 4.4.3 vs 4.3.6):

  ```js
  const { z } = require('zod');
  const reactNode = z.custom((d) => d == null || typeof d === 'string');
  const S = z.strictObject({ children: reactNode, other: z.string().default('x') });
  S.safeParse({}).success            // zod 4.3.6 → true      zod 4.4.0+ → false
  S.safeParse({ children: undefined }).success  // true on both — a missing key ≠ an undefined key
  ```

  Bisected: **4.3.6 passes · 4.4.0, 4.4.2, 4.4.3 fail.**

- **Workaround (what we shipped):** scope the pin rather than the whole workspace, in the root `package.json`:

  ```json
  "pnpm": { "overrides": { "nextra>zod": "4.3.6", "nextra-theme-docs>zod": "4.3.6" } }
  ```

  There is no application-side fix: `Layout` strips `children` itself, so no way of passing it helps.

- **What would have prevented it:**
  1. **In nextra** — either drop `children` from `LayoutPropsSchema` (it is destructured out before parsing,
     so it can never be validated) or parse `{ ...themeConfig, children }`. Pinning `zod` to `~4.3` in
     `dependencies` would also do it.
  2. **In zod** — the 4.4.0 change from "missing key satisfies a permissive `z.custom()`" to "missing key is
     an error" is a breaking change to a very common pattern, released in a minor.
  3. **In Next.js** — a prerender failure that redacts its own message sends you bisecting *content* when the
     fault is in `app/layout.tsx`. `next dev` prints the real error in one request; if a build fails at
     prerender, go there first. That is the transferable lesson.

---

## Node `child_process` (the DGX ingest queue)

### I1 · A failed `spawn` emits BOTH `error` and `close`, so the completion path runs twice — and a concurrency-1 queue silently becomes concurrency-2 — **[VERIFIED, reproduced locally]**

Ours, not a sponsor's, and recorded because the shape is general: any queue whose "job finished" handler is
reachable from more than one event will eventually run it twice for one job.

`infra/dgx-ingest/ingest.mjs` runs the ingest pipeline one job at a time. One at a time is not a preference:
the box has one GPU and one wallet, and two concurrent pipelines would sign two transaction sets at once.

- **What we expected:** a child process finishes once, so `finish(job)` runs once.
- **What happened:** on a spawn failure node emits `error` *and then* `close`. Both handlers called `finish`,
  which ends with `activeId = null; pump()`. The second call cleared `activeId` while the job `pump()` had
  just started was still running, and `pump()` started a **second** pipeline alongside it. The same double-run
  also overwrote the useful `pipeline failed to run: ENOENT` with a bare `the pipeline exited -4058`
  (`UV_ENOENT`), which is the diagnosis you actually need pointing at the wrong thing.
- **The second path to the same bug:** on shutdown the handler marks the running job `failed` +
  `interrupted` ("may have partially written — check the registry"), then kills the child. The child's
  `close` then relabelled it as an ordinary `exited 143`, deleting the one warning that tells a human to go
  look at the registry before re-submitting.
- **How we found out:** running the service locally against stub commands before it ever went near the DGX.
  The ENOENT case printed the wrong error, which is what exposed the double call; the concurrency break was
  found by reading why.
- **Repro** (needs no GPU, no wallet, no DGX — `SUREX_INGEST_CMD` exists for exactly this):

  ```bash
  SUREX_INGEST_TOKEN=test-token-0123456789abcdefghijklmn SUREX_INGEST_PORT=11695 \
  SUREX_INGEST_STATE=/tmp/i.json SUREX_INGEST_REPO_DIR=/tmp \
  SUREX_INGEST_CMD='["definitely-not-a-real-binary-xyz"]' node infra/dgx-ingest/ingest.mjs &
  curl -s -X POST localhost:11695/v1/ingest -H 'Authorization: Bearer test-token-0123456789abcdefghijklmn' \
    -H 'content-type: application/json' \
    -d '{"repo":"acme/nocmd","commit":"7777777777777777777777777777777777777777"}'
  # before the fix: "error":"the pipeline exited -4058"   (close won, error lost)
  # after:          "error":"pipeline failed to run: ENOENT"
  ```

- **What would have prevented it:** treat job completion as a **state transition, not an event handler** —
  `if (job.status !== 'running') return;` at the top of `finish`, so the first writer wins and every later
  path is a no-op. A `shuttingDown` flag that makes `pump()` a no-op belongs with it: a queue must never
  start work in a process that is seconds from exiting. Node's docs do say `error` and `close` can both fire;
  what they do not say is that the cost lands on an invariant three functions away.

### I2 · Signal handlers do not run on Windows, so the graceful-shutdown path cannot be tested off the target OS — **[VERIFIED]**

`process.on('SIGTERM')` is what `systemctl restart` triggers, and it is the handler that marks a running job
`interrupted`. On Windows the process is terminated instead: the handler never runs.

```bash
node -e "const {spawn}=require('child_process');
const c=spawn(process.execPath,['-e',\"process.on('SIGINT',()=>{console.log('HANDLER RAN');process.exit(0)});setInterval(()=>{},1000)\"],{stdio:'inherit'});
setTimeout(()=>process.kill(c.pid,'SIGINT'),800); c.on('close',(x)=>console.log('closed',x));"
# prints: closed 1        — never "HANDLER RAN"
```

- **What would have prevented it:** do not let a durability guarantee rest on a signal handler. The state
  file is written **before every transition**, and the recovery that matters runs at **boot** — a job found
  `running` in the file is failed as interrupted no matter how the process died. That path is verified with
  `kill -9`, covers power loss too, and needs no signal at all. The SIGTERM handler is a nicety on top, and
  is the one thing in this service that remains unverified until it runs on the DGX.
