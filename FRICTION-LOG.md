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

*(nothing yet — log as we build)*

---

## Arkiv

*(nothing yet — log as we build)*

---

## Claude Code (not a sponsor, but the enforcement surface — worth sending upstream)

### C1 · `PreToolUse` hook timeout behaviour is undocumented
Default is 600s and configurable, but the docs do not say what happens to the tool call when a *blocking* PreToolUse hook exceeds it — allowed or denied? For a security hook that is the difference between fail-open and fail-closed, and it cannot be guessed.

### C2 · `session_id` stability is undocumented
`/branch` is documented to produce a new session id. `/clear`, `/compact` and `/resume` are not described either way. Any hook implementing "approve once per conversation" depends on this.

### C3 · No MCP server name in the hook payload
For `mcp__<server>__<tool>` calls, `PreToolUse` input carries `tool_name` but no server name and no server config. Every consumer re-implements the same parse, including the `mcp__plugin_<plugin>_<server>__<tool>` special case. A `server_name` field would remove a whole class of bugs.

---

## How this gets used at submission

- **World** — W1 is a real, reproducible bug with a root cause and a suggested patch. Lead the booth conversation with it.
- Beta tracks (Selfie Check / Identity Check) grade **testing documentation covering both developer and user feedback** as a required deliverable. If we touch either, the user-side half has to be written too — it is not optional.
- Keep the repro scripts. "Here is the failing case" beats a paragraph.
