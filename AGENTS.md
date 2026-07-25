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

**Building. The chain runs end to end. The registry is not yet populated from real reviews.**

| Area | State |
|---|---|
| Product specs (PRD, tech spec, track fit, failure modes) | written — `docs/`, corrected against measurement as we go |
| Design system + screens | first round done — `design/` |
| Public explainer | done — deployed |
| `packages/core` | **done** — SXF-1, the frozen `/v1` contract, verdict decision, copy law, blob verification |
| `packages/plugin` | **done** — the gate + `surex` CLI, zero dependencies, installable from this repo |
| `packages/fixture-mcp` | **done** — the deliberately malicious fixture, safe to run |
| **The chain, end to end** | **verified — `node demo/chain.mjs`, 13/13** |
| One Walrus blob written + certified | **done**, both Sui digests captured — §7 |
| One Arkiv entity written + read filtered by `.createdBy` | **done**, including the adversarial case — §7 |
| Reviewer, API, web app, worker + seeding | in progress |
| Any **real** review of a real server | **none yet** — nothing in the registry describes a real review |

**What is real and what is not, right now.** The gate, the fingerprint, the block message, the Walrus fetch
and the blob-ID recomputation are real and tested. The *verdict content* in the demo is a hand-written head
pointing at a real certified blob — the mechanism is genuine, the finding is about our own fixture, and no
third-party server has been reviewed by anything. Say it that way.

Everything numeric in `design/prototype.html` is **placeholder content** served behind a banner. Never
remove that banner while the data is fake, and never quote those numbers as if they were real. Anything the
API serves in mock mode carries `illustrative: true`, and no surface may strip it.

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

**Claude Code hooks** — measured on **2.1.220**, not read from docs. Probes and repro commands in
`probes/hook/` (`bash run.sh <mode>`); write-ups in `FRICTION-LOG.md` C1–C5.

- Deny shape is `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"…"}}`, exit code 0. `permissionDecision` is current; the older `decision`/`reason` form is not. ✅ **verified** — it stops a real `mcp__` tool call, and it beats an explicit `--allowedTools` grant.
- `permissionDecisionReason` reaches the model **verbatim**: a 12-line reason arrived with newlines intact and was quoted back in full. ✅ **verified**
- ❌ **The documented 10,000-character cap did not apply.** A **12,054-character** reason arrived complete and unaltered — no file spill, no preview. But at that size the model stopped recognising it as a block and described it as a tool error. **The real limit is comprehension, not bytes: keep block messages short and structured.**
- ⚠️ **`permissionDecision: "allow"` GRANTS — it does not merely permit.** With no allowlist entry and no user grant, the tool ran. **So the `unknown`/warn path must never emit `allow`**: doing so auto-approves precisely the servers SureX knows nothing about, making users worse off than not installing it. Emit `systemMessage` alone (no decision field) — verified to preserve the normal permission flow. Silent `exit 0` preserves it too, which is the `clean` path.
- `systemMessage` is a valid top-level field and is **display-only** — it does not enter the model's context.
- Matcher is a **regex**. `mcp__.*` catches every MCP tool; a bare `mcp__github` is exact-match and fires on nothing. Plugin-provided servers are named `mcp__plugin_<plugin>_<server>__<tool>`.
- Hook input has **no server-name field** — parse it out of `tool_name`, and handle the plugin shape. The full key set is `cwd · effort · hook_event_name · permission_mode · prompt_id · session_id · tool_input · tool_name · tool_use_id · transcript_path`. **`transcript_path`** (absolute path to the live session `.jsonl`) and **`prompt_id`** (stable per user turn) are undocumented and useful.
- Claude Code already ships static allowlists: `allowedMcpServers` / `deniedMcpServers` (managed settings) and `permissions.deny: MCP(x)`. Our wedge is the dynamic, evidence-backed, continuously re-reviewed verdict — not the existence of a list. Know this before pitching.
- Default command-hook timeout is 600s and is configurable; set ours low. ✅ **Exceeding it FAILS OPEN** — the hook is killed (`outcome: "cancelled"`, exit 1, stdout discarded) and **the tool call proceeds**. That matches the fail-open design we want, but it is also a bypass: anything that makes the gate slow silently disables enforcement. There is no fail-closed opt-in. Budget the gate's own timeout accordingly and never rely on the timeout as a control.
- `session_id` **survives `/compact`** and **resets on `/clear`** — established from transcript forensics, not from a hook observing itself (both commands are interactive-only). "Approve once per conversation" is therefore safe to build. See FRICTION-LOG C5 for the thirty-second interactive confirmation still worth doing.

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

**Sui / Walrus** — measured with `@mysten/sui@2.22.1` + `@mysten/walrus@1.2.9` via `probes/walrus-write.mjs`.
Write-ups in `FRICTION-LOG.md` S1–S8. **A real certified blob, for use as a test fixture:**

| | |
|---|---|
| `blobId` | `-SzjTmxUSjs01bmC2AZ48iqz-fTCcllwcLu3nc2rb2Y` |
| `suiObjectId` | `0xe0ad0c98f40f23b5990ea5bee344e6fbb245366507910f93120975b25c6af5e8` |
| `registerTx` | `2s1ogVLi6Gc2uEY3ZB4Ztb52DNxyHqftMa4aVrTRqeND` |
| `certifyTx` | `7BiSZkhzAjucM2PNY8bMVi9cWBvtiLDBE6T8AEtm1tkq` |
| sha256 of the bytes | `f0457c3012a351b89df29a190d8189595074cf2fe843d85aeff8047cc1ff2ad7` |

- One blob write = **two Sui transactions** — register is a PTB (`reserve_space` + `register_blob`), then `certify_blob`. Confirmed: 129 bytes billed on an **encoded** length of 66,034,000, so **cost is per blob, not per byte**.
- ⚠️ **Testnet max is 53 epochs, not 183.** `epochs=183` returns HTTP 500 carrying a raw `EInvalidEpochsAhead` Move abort. The real ceiling is only discoverable as `future_accounting.length` on chain. (S2)
- ⚠️ **A blob ID is NOT `sha256(bytes)`** — it is a commitment over the erasure-coded sliver structure. Confirmed: `-SzjTmxU…rb2Y` vs sha256/base64url `8EV8MBKj…H_Ktc`. **Deriving it needs the Walrus WASM encoder**, so it is vendored into the plugin (376 KB, `packages/plugin/lib/vendor/walrus-wasm/`, Apache-2.0). With `n_shards = 1000` and encoding `RS2`, `BlobEncoder.compute_metadata()` reproduces the on-chain ID exactly, and one flipped bit does not. **This closes tech-spec §13 open question 1** — the gate verifies bytes against a blob ID locally, trusting neither the aggregator nor the API.
- ⚠️ **`alreadyCertified` dedup is PUBLISHER behaviour, not protocol.** The HTTP publisher returns it for free; the TS SDK re-registers, re-certifies and **re-charges** for bytes already certified. Re-running a seed job pays again. (S3)
- ⚠️ `flow.executeCertify()` does not return the certify digest — run `encode → register → upload → certify` step by step, or provenance is unrecordable. (S4)
- ⚠️ **The testnet SUI faucet is the single biggest event risk.** Continuous 429s for ~7 minutes with a `retry-after` that is fiction (`Wait for 0s`), not per-IP (a second egress made no difference), and the SDK discards the header. Success came on **attempt 53** of a blind 8-second loop. Fund early, and never make a demo depend on funding on the day. (S1)
- ⚠️ JSON-RPC is **removed** from `fullnode.testnet.sui.io` — a bare 404 with an empty body. (S6)
- Do not hardcode Walrus package or object IDs; testnet has been redeployed before. Read them at runtime.
- Blob mode: **owned + permanent** (`deletable: false`). The public HTTP publisher caps requests at 10 MiB.
- Record `blobId`, `suiObjectId`, both tx digests, `encodingType` and `nShards` on every record. Blob IDs are deterministic over content **and** network configuration, so a future mismatch can then be explained rather than read as tampering. Explorer: `https://suiscan.xyz/testnet/tx/<digest>` (bot-blocks WebFetch and curl; render it if you need to confirm one).
- The Lisbon Sui track names Walrus explicitly and calls it *"the most natural entry point"*, so Walrus alone qualifies. It also says *"the deeper you reach into the Sui stack, the stronger the submission"* — depth is scored separately.

**Arkiv (Braga)** — measured on `@arkiv-network/sdk@0.7.0` via `probes/arkiv-write-read.mjs`, twice.
Write-ups in `FRICTION-LOG.md` A1–A5.

- Chain ID `60138453102`, RPC `https://braga.hoodi.arkiv.network/rpc`, gas token GLM.
- Writer wallet: `0xBD33E1855F68Ce2DF1979377f3bc9fCaCd0015e6` (index 2 in `golem-project/tooling/hackathon-wallets/wallets.json`, 1 GLM confirmed live). Foreign/second wallet for adversarial tests: index 3 `0x4C12202c7A818f9e6A34627dd3B71951d8Abfa85`. ⚠️ The `[arkiv-writer]` entry in `.secrets/surex-wallets.txt` has a **zero balance** — do not reach for it, use index 2. Keys are in `.secrets/`, never here.
- **SDK 0.7.0 no longer re-exports viem.** `import { http } from 'viem'` and `import { privateKeyToAccount } from 'viem/accounts'`; the `@arkiv-network/sdk/accounts` subpath is gone. Every 0.6.x snippet on the internet fails at the import line and there is no CHANGELOG. (A1)
- `expiresIn` is in **seconds** and must be a positive **even** integer — 0.7.0 throws `InvalidExpirationError` on an odd value where 0.6.8 silently rounded. 2 s per block, so `3600` → 1800 blocks. Compute it, then round to even. (A3)
- `updateEntity` is a **full replacement**: read, merge, write, and always re-include the project attribute or the entity silently drops out of every scoped query. Confirmed — dropping it made the entity vanish from the scoped query in 35 ms while still existing on chain.
- **Filter every consumer read with `.createdBy(WRITER_ADDRESS)`.** Proven, not assumed: a colliding entity written from a second wallet with the same project + entityType + fingerprint and the opposite verdict shows up in the unfiltered query (2 results), and `.createdBy` partitions them cleanly in both directions.
- ⚠️ **Use `createdBy`, never `ownedBy`.** They sit side by side with near-identical JSDoc, but the SDK also ships `changeOwnership` — ownership is transferable, so `ownedBy` is attacker-influenceable and `createdBy` is not. Getting this wrong is a silent authorisation bypass. (A5)
- **Index lag is ~40 ms to `getEntity` and ~80 ms to the query index**, not the 5 s previously written here. The real cost is that `createEntity()` **awaits the receipt** — ~4.6 s — which the JSDoc reads as a submit. Budget for that, not for the index. (A4)
- **`orderBy` exists, is accepted silently, and does nothing** — 0.7.0 marks it `@deprecated: "Server-side ordering is not supported by the network."` **Sort client-side, always.** (A2)
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
