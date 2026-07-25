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
