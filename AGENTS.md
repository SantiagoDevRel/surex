# AGENTS.md — SureX

Canonical guide for any AI agent or human working in this repo. `CLAUDE.md` points here; do not
duplicate rules across the two files.

---

## 1. What this is

**SureX is a trust registry for MCP servers, plus a gate that reads it.**

Adding an MCP server to a coding agent is currently a leap of faith: the server runs with the agent's
permissions, sees your files and secrets, and nothing checks it. SureX puts a check in the path. Before
the agent calls any MCP tool, a `PreToolUse` hook looks the server up. Reviewed and clean → nothing
happens, silently. Flagged → the call is blocked, the evidence is shown, and the user can override in one
command. Unknown → a warning, and the call proceeds.

The other half is how entries get there: source code is written to Walrus as a content-addressed blob, an
open-source model reads that source against what the server *claims* to do, and the verdict is written as
its own separate blob. Arkiv holds the queryable entity pointing at both. Anyone — a person via World ID,
or an autonomous agent via World AgentKit — can contest a verdict.

Built at **ETHGlobal Lisbon 2026** (24–26 July). Target tracks: **Sui — Best app built on Sui** and
**World — AgentKit New Use Cases**.

## 2. Status — read this before assuming anything exists

**Design phase. No service is running. No code has been written yet.**

| Area | State |
|---|---|
| Product specs (PRD, tech spec, track fit, failure modes) | written — `docs/` |
| Design system + screens | first round done — `design/` |
| Architecture diagram | done — `design/architecture-plate.html` |
| Public explainer | done — deployed |
| Gate, API, worker, reviewer, web app | **not started** |
| Any on-chain write, any real review | **none yet** |

Everything numeric currently visible in `design/prototype.html` is **placeholder content**. It is served
behind a banner saying so. Never remove that banner while the data is fake, and never quote those numbers
anywhere as if they were real.

## 3. What to read, in order

1. `docs/surex-prd.md` — what the product is and the verdict model (states, tiers, wording rules).
2. `docs/surex-tech-spec.md` — how it is built. Fingerprint algorithm, hook contract, data model, APIs.
3. `docs/surex-failure-modes.md` — what breaks it. Read before planning any build order.
4. `docs/surex-track-fit.md` — how it maps to the two prize tracks, and the honest answers to the
   questions judges will ask.
5. `FRICTION-LOG.md` — verified problems found in sponsor SDKs while building. Also §7 below.

## 4. Hard rules

**Copy law — binding on every surface, UI and API alike.**
Never write *safe*, *trusted*, *verified* or *secure* about a reviewed server. The word is **reviewed**.
Every verdict must state what was reviewed (commit + blob ID), when, by which model and prompt version,
and that it was automated with no human audit. Never imply the registry knows what is running on a user's
machine — it knows what was reviewed. Corrections are as prominent and as durable as the original claim;
verdicts are superseded, never deleted.

**Never fabricate.** No invented registry counts, no fake tx digests, no placeholder verdicts presented as
real, no backdated commits. If a number is illustrative, it is labelled illustrative on the same screen.
This is both an integrity rule and a submission rule — see §6.

**Never publicly flag a real, named third-party project** on the strength of an unaudited model verdict.
The only thing flagged in any demo is the fixture we wrote ourselves.

**Log friction the moment it happens** → `FRICTION-LOG.md`. Sponsors run these events to find out where
their products break, and some tracks grade that feedback directly. An entry written while it is costing
you twenty minutes is worth many times one reconstructed on Sunday. Format: what we expected · what
happened · how we found out · what would have prevented it. Mark `[VERIFIED]` only when reproduced, and
keep the repro command.

**Commit continuously, with honest timestamps.** ETHGlobal presumes a repo with one large final commit to
be unqualified unless the team can prove when the work was done. Small, real, dated commits.

**Secrets never enter this repo.** Wallet addresses are fine; private keys live in
`claude-code-environment/.secrets/` and in deployment env vars only.

## 5. Stack, and why each piece is there

| Piece | Job | Load-bearing because |
|---|---|---|
| **Claude Code `PreToolUse` hook** | enforcement point | without a native interception point there is no product |
| **Arkiv** (Braga testnet) | queryable index; the `VerdictHead` the gate reads | the gate must resolve a decision in one query before every tool call |
| **Walrus on Sui** (testnet) | content-addressed record store for source, verdicts, disputes | a verdict points at the exact bytes it judged; nobody, including us, can quietly swap them |
| **World ID** | proves a unique human for maintainer submission and human disputes | anti-sybil on submissions and appeals |
| **World AgentKit / AgentBook** | proves a human stands behind an autonomous agent that contests a verdict | gives an agent *standing to dispute*, which is the novel use |

Sponsor SDK budget is **3** and we use **2** (Sui/Walrus, World). Arkiv is not an event sponsor so it does
not count. ENS is a deliberate later phase — do not add it without an explicit decision.

**Do not add Move contracts, x402 payment flows, Seal, or ENS** unless someone decides to. They have been
discussed and deliberately deferred. Adding scope silently is the failure mode here.

## 6. ETHGlobal integrity

State plainly in the submission, and keep it true:

- The project was **started during the event**. There is no prior codebase.
- The product specs in `docs/` were authored during the event (2026-07-24/25) with AI assistance.
- The design in `design/` was produced during the event with Claude Design.
- AI assistance is permitted by the event rules; using it is not the issue, misrepresenting authorship or
  timing would be.
- Anything not built gets listed as not built. The README carries an explicit "what we cut" section.

## 7. Verified facts — do not re-derive, do not contradict

Checked against primary sources on 2026-07-24/25. Where something is marked UNVERIFIED, it is genuinely
unresolved — test it, do not guess.

**Claude Code hooks**
- Deny shape is `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"…"}}`, exit code 0. `permissionDecision` is current; the older `decision`/`reason` form is not.
- `permissionDecisionReason` reaches **both** the user's terminal and the model. Hook output strings cap at **10,000 characters**; beyond that the output is written to a file and replaced with a preview plus the path.
- `systemMessage` is a valid top-level field and is **display-only** — it does not enter the model's context.
- Matcher is a **regex**. `mcp__.*` catches every MCP tool; a bare `mcp__github` is exact-match and fires on nothing. Plugin-provided servers are named `mcp__plugin_<plugin>_<server>__<tool>`.
- Hook input has **no server-name field** — parse it out of `tool_name`, and handle the plugin shape.
- Claude Code already ships static allowlists: `allowedMcpServers` / `deniedMcpServers` (managed settings) and `permissions.deny: MCP(x)`. Our wedge is the dynamic, evidence-backed, continuously re-reviewed verdict — not the existence of a list. Know this before pitching.
- Default command-hook timeout is 600s and is configurable; set ours low. **UNVERIFIED:** whether exceeding it fails open or closed.
- **UNVERIFIED:** whether `session_id` survives `/clear`, `/compact` and `/resume`. `/branch` is documented to produce a new one. The "approve once per conversation" behaviour depends on this — test it early.

**Distribution — ship as a Claude Code plugin**
- A plugin registers hooks via `hooks/hooks.json` at plugin root, same shape as settings. Bundled scripts are referenced with `${CLAUDE_PLUGIN_ROOT}`.
- **Persistent state goes in `${CLAUDE_PLUGIN_DATA}`, never `${CLAUDE_PLUGIN_ROOT}`** — the root changes on every plugin update and the docs say to treat it as ephemeral. Put the user's overrides there or an update wipes their approvals.
- Executables in `bin/` join the PATH while the plugin is enabled, so a real `surex` terminal command needs no separate global install.
- Installable from a plain git repo: `/plugin marketplace add <owner>/<repo>` then `/plugin install <name>@<owner>`. Minimum manifest is `.claude-plugin/marketplace.json` with a name and a repository.
- On install, Claude Code shows the user a "Will install" list naming the hooks and MCP servers, behind a trust gate. Plugin hooks run **unsandboxed** — say so in the README.

**World**
- **AgentBook registration requires an Orb-verified World ID.** The contract checks `groupId = 1` and only Orb credentials exist on-chain; device-level and Selfie Check proofs cannot register an agent. This is a hard dependency on a physical human.
- Registration is **gasless** — a hosted relay pays. The agent wallet needs no balance. `npx @worldcoin/agentkit-cli register <address>`, scan the QR, then confirm with `status <address>`.
- **One human may register many agents**, and they all return the **same `humanId`**. The contract only guards a per-agent nonce.
- AgentBook is live on World Chain 480 at `0xA23aB2712eA7BBa896930544C7d6636a96b944dA`. It is **also** live on Base 8453 (different address) and **Base Sepolia 84532** — the widespread "mainnet-only" claim is false. `lookupHuman` still resolves against World Chain 480 by default.
- The shipped CLI 0.2.0 hardcodes World Chain and has **no `--network` flag**; its own README and REGISTRATION.md claim otherwise and are stale.
- 🐛 **`agentkit.fetch` silently no-ops against `@x402/hono@2.19.0`** — it reads the challenge from the JSON body, but x402 2.19 puts it in a base64 `payment-required` header and leaves the body `{}`. No signature, no retry, no error, no event. Use `agentkit.createHeader()` and do the retry by hand. See `FRICTION-LOG.md` W1.
- Pass `rpcUrl` explicitly to `createAgentBookVerifier`; the default is a shared public RPC and a rate-limit throw looks exactly like a rejected agent.
- Not to be confused with `@coinbase/agentkit`.
- Track exclusions are explicit: *agent reputation* and *human-backed benefits for AI agents (API calls, discounts)*. Never describe anything here as reputation — SureX reviews **servers**, not agents.

**Sui / Walrus**
- One blob write = **two Sui transactions** (register, then certify). Cost is per blob, not per byte.
- Blob IDs are content-derived and deterministic; identical bytes deduplicate. A blob ID is **not** `sha256(bytes)` — deriving it needs the Walrus encoder.
- Do not hardcode Walrus package or object IDs; testnet has been redeployed before. Read them at runtime.
- The public HTTP publisher caps requests at 10 MiB.
- Record `blobId`, `suiObjectId`, and both tx digests on every record, and link them to an explorer.
- The Lisbon Sui track names Walrus explicitly and calls it *"the most natural entry point"*, so Walrus alone qualifies. It also says *"the deeper you reach into the Sui stack, the stronger the submission"* — depth is scored separately.

**Arkiv (Braga)**
- Chain ID `60138453102`, RPC `https://braga.hoodi.arkiv.network/rpc`, gas token GLM.
- Writer wallet: `0xBD33E1855F68Ce2DF1979377f3bc9fCaCd0015e6` (index 2 in `golem-project/tooling/hackathon-wallets/wallets.json`, 1 GLM confirmed live). Backup is index 3. Key is in `.secrets/`, never here.
- Entities **always expire** — pass a positive integer `expiresIn`. Renewal is a design requirement, not a deployment detail.
- `updateEntity` is a **full replacement**: read, merge, write, and always re-include the project attribute or the entity silently drops out of every scoped query.
- **Filter every consumer read with `.createdBy(WRITER_ADDRESS)`.** A shared public testnet has no uniqueness constraint; without it anyone can write a colliding fingerprint and the gate would read their verdict.
- Indexing lags the transaction — poll `getEntity` at ~250 ms for up to 5 s before trusting a read that depends on a write you just made.
- No attribute-to-attribute comparison in queries, so anything derived must be precomputed and stored.

## 8. What is next

1. Decide the final product name — `surex` is the working name and the repo can be renamed.
2. Verify the three external surfaces before writing feature code: the hook actually blocking a real MCP
   tool call, one Walrus blob written and certified with digests captured, one Arkiv entity written and
   read back filtered by `.createdBy`.
3. Freeze the `/v1` contract and mock both sides, so nothing waits on anything.
4. Build the fixture MCP server — a deliberately malicious one we author, whose tool descriptions disagree
   with its code, and which carries a planted prompt-injection aimed at the reviewer. It is a build
   deliverable, not a prop, and it is the only thing ever publicly flagged.
5. Then the chain, end to end, one real integration at a time.

## 9. Layout

```
docs/       product specs (PRD, tech spec, track fit, failure modes)
design/     Claude Design output — prototype, tokens, verdict system, architecture plate
public/     the static site currently deployed (explainer as landing)
FRICTION-LOG.md   sponsor SDK feedback, written as it happens
```
