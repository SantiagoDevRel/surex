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
| Public explainer (GitHub Pages) | superseded by the deployed app — it still says "design phase" and understates the project |
| `packages/core` | **done** — SXF-1, the frozen `/v1` contract, verdict decision, copy law, blob verification |
| `packages/plugin` | **done** — the gate + `surex` CLI, zero dependencies, installable from this repo |
| `packages/fixture-mcp` | **done** — the deliberately malicious fixture, safe to run |
| `packages/reviewer` | **done** — real review run on the DGX; the injection defence held |
| `apps/api` | **done and deployed** — read path, live against Braga |
| `apps/web` | **done and deployed** — four screens |
| **The chain, end to end** | **verified — `node demo/chain.mjs`, 13/13** |
| One Walrus blob written + certified | **done**, both Sui digests captured — §7 |
| One Arkiv entity written + read filtered by `.createdBy` | **done**, including the adversarial case — §7 |
| `packages/worker` + seeding | **done** — 50 real servers seeded from the official MCP registry into one certified Walrus quilt, resume tested twice |
| World **AgentKit / AgentBook** | **built and live** — `SUREX_WORLD=1` on the deployed API. The agent path recovers the address from the signature locally, then reads AgentBook on World Chain 480. Exercised against a real third-party registration. **Nobody is registered as our agent yet** — that is the Orb step. |
| World **ID** (human disputes) | **built, not provable yet** — needs a Developer Portal app (`WORLD_RP_ID`, `RP_SIGNING_KEY`, `NEXT_PUBLIC_WORLD_APP_ID`). Unset gives an explicit configuration error that says it is *our* misconfiguration and not a judgement about the contestant. Never a pass. |
| Any **real** review of a real third-party server | **none** — the only thing reviewed is our own fixture |
| Deployed | **yes** — web `arkiv-surex.vercel.app`, API `arkiv-surex-api.vercel.app`, both on `santiago-prod`, both reading live Braga. Git-connected to this repo, so every push to `main` redeploys. |
| Reviewer, reachable from production | **yes** — `surex-reviewer.santiagodevrel.dev`, a bearer-gated proxy on the DGX in front of ollama. `POST /admin/load-model` warms the model from the deployed API in ~7.5 s, verified. Only `/v1/chat/completions`, `/v1/completions`, `/v1/models` and `/api/tags` are forwarded — `/api/pull` is 404, so nobody can make the box download anything. |
| **Reviewer calibration** | **built and measured** — `scripts/calibrate.mjs` scores every fixture against the ground truth its own specification recorded *before* any review ran, and exits non-zero on a regression. It is the precondition for reviewing anyone else's code: §7 carries the numbers. |
| The registry, live | **85 entries** · 10 clean · 7 flagged · 10 unreviewable(licence) · 58 unknown. Every clean and every flag is one of our own fixtures; the 58 unknowns are real servers nobody has reviewed yet — `scripts/review-known.mjs` is the pass that changes that. |
| **ENS** offchain resolver + CCIP-Read gateway | **live on Ethereum mainnet, end to end.** [`surex.eth`](https://app.ens.domains/surex.eth) (ours, expires 2027-07-25) → `SureXOffchainResolver` at `0x2BEaeC431bB22Fd1160319d0ebDAE886Ef593a8B`, signer `0x9D80524581a242a8F67c5333418B6b8b3a8a6D01`, gateway at `/api/ens/`. A stock viem client reads a verdict off a subname nobody registered: `getEnsText({name:'sxf1-<40 hex>.surex.eth', key:'surex:state'})` → `flagged`. Wildcard resolution, signed CCIP-Read response, `resolveWithProof` verifying against the pinned key, data live from Arkiv. Verify with `node probes/ens-resolve.mjs live --name <name>`. ⚠️ `0xCb140fF30c449c3782D96Bfa356cDDE8E33b2559` was the FIRST deployment and is superseded — it dropped the name from the callData (E8). This does **not** close PRD risk #10 — see §5 and `docs/surex-ens.md` §2. |

**Total: 520 tests green** (`pnpm test`), plus 66 in the web app including the copy-law
walk and the ENS record walk.

**What is real and what is not, right now.** The gate, the fingerprint, the block message, the Walrus fetch,
the blob-ID recomputation and the review of our own fixture on a real model are all real and tested. The
*verdict content* in the demo is a hand-written head pointing at a real certified blob — the mechanism is
genuine, the finding is about our own fixture, and **no third-party server has been reviewed by anything**.
Say it that way. Anything the API serves in mock mode carries `illustrative: true` and the web app renders a
banner derived from that flag, not from a setting someone could forget.

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
6. `docs/FEEDBACK.md` — the sponsor-facing consolidation of that log, grouped by whose codebase can act on
   each finding (Sui/Walrus · World · ENS, then the non-sponsor stacks). Submission material: some tracks
   grade developer feedback directly. New findings go in `FRICTION-LOG.md` **first**, then get carried here —
   never the other way round, and never upgraded from inferred to `[VERIFIED]` in the crossing.
   `docs/WORLD-FEEDBACK.md` is the standalone World note; `docs/world-message.md` is its short form.

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
| **World ID** | proves a person is behind a maintainer submission or a human dispute. **How strongly is a deployment setting**, `WORLD_CREDENTIAL`: `face` (default, Selfie Check → *liveness*, sybil resistance World itself rates "some") · `orb` (Proof of Human → *uniqueness*) · `device` (an account, no biometric). Only `orb` establishes one-human-one-action | anti-sybil on submissions and appeals — at the strength the configured credential actually provides, never as claimed |
| **World AgentKit / AgentBook** | proves a human stands behind an autonomous agent that contests a verdict | gives an agent *standing to dispute*, which is the novel use |
| **ENS** (Ethereum mainnet) | wildcard offchain resolver — every registry entry readable as `sxf1-<40 hex>.surex.eth` | a read interface nobody has to integrate, and the only form of a verdict a contract can check |

Sponsor SDK budget is **3** and we use **3** (Sui/Walrus, World, ENS). Arkiv is not an event sponsor so it
does not count. ENS was a deliberate later phase; the decision to add it was taken and written up in
[`docs/surex-ens.md`](./docs/surex-ens.md), which is also where the reasons NOT to overclaim it live.

**ENS does not close PRD risk #10.** The Gate acts on unsigned HTTP responses and still does — it is
`packages/plugin/lib/registry.mjs`, and the ENS work does not touch it. Never let "signed read" become
"the gate is now signed" in a README, a demo script or an answer to a judge. `docs/surex-ens.md` §2 gives
the three reasons in full.

**Do not add Move contracts, x402 payment flows, or Seal** unless someone decides to. They have been
discussed and deliberately deferred. Adding scope silently is the failure mode here — and the budget is
now full, so anything further replaces something rather than joining it.

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
- ✅ `session_id` **survives `/compact`** — verified directly, headlessly: `--session-id` for turn one, then `printf '/compact' | claude -p --resume <id>`, then another tool call. The transcript shows a real `compact_boundary`, one distinct `sessionId` throughout, and the hook after the boundary saw the same id. "Approve once per conversation" is safe to build.
- ⚠️ `session_id` **appears to reset on `/clear`**, but that half is inference from transcript layout (10 `/clear` records, all at the start of a file), not observation — `/clear` cannot be driven headlessly. Do not quote it at the same confidence. FRICTION-LOG C5.

**Distribution — ship as a Claude Code plugin**
- A plugin registers hooks via `hooks/hooks.json` at plugin root, same shape as settings. Bundled scripts are referenced with `${CLAUDE_PLUGIN_ROOT}`.
- **Persistent state goes in `${CLAUDE_PLUGIN_DATA}`, never `${CLAUDE_PLUGIN_ROOT}`** — the root changes on every plugin update and the docs say to treat it as ephemeral. Put the user's overrides there or an update wipes their approvals.
- ❌ **"Executables in `bin/` join the PATH while the plugin is enabled" is FALSE**, at least on 2.1.220 / Windows. Installed from a marketplace the binary lands at `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/bin/surex`, and `surex` is `command not found` in the shell the agent runs commands in. This matters more than a convenience: the override command is printed in **every** block message and is the reason blocking is defensible at all. The gate therefore resolves its own location and prints an invocation that exists (`lib/selfpath.mjs`), and the plugin also ships a `/surex` slash command. (FRICTION-LOG C7)
- Installable from a plain git repo: `/plugin marketplace add <owner>/<repo>` then `/plugin install <name>@<owner>`. Minimum manifest is `.claude-plugin/marketplace.json` with a name and a repository.
- On install, Claude Code shows the user a "Will install" list naming the hooks and MCP servers, behind a trust gate. Plugin hooks run **unsandboxed** — say so in the README.

**The reviewer, calibrated** — `scripts/calibrate.mjs`, measured 2026-07-25 against
`qwen3-coder-next:surex32k`, prompt `rv-1`/`rv-2` (the two are byte-identical for any server whose tools
enumerate, which every fixture does — see the version log at the top of `prompt.mjs`). Re-run it before
trusting the reviewer with anything new; it exits non-zero on a regression and writes a report to `Downloads/`.

The ground truth is not invented by the harness. It is what the fixtures' own specifications
(`packages/fixtures/{README,MALICIOUS,AMBIGUOUS}.md`) recorded **before any review ran**, which is the only
thing that makes it ground truth. `honest-*` must come back clean; `mal-*` must come back flagged **and
blocking** (`decide()` blocks at severity 3, so a flag at severity 2 is a warning a developer clicks past);
`ambiguous-*` is scored against AMBIGUOUS.md's predicted and also-defensible verdicts and never asserted. The
harness also checks the finding points at the real mechanism, because a flag for the wrong reason is a flag by
luck, and luck does not transfer to code we did not write.

**48 readings — 16 fixtures, 3 runs each:**

| | |
|---|---|
| honest | **15/15 clean · 0 accused** |
| malicious | **18/18 flagged · 18/18 actually BLOCK · 18/18 mechanism identified** |
| ambiguous | **15/15 landed on the predicted verdict** |
| | recall **100%** · precision **100%** |

**What calibration changed, and it is not cosmetic.** Before the tie-break, `honest-sqlite` — a fixture written
to be well behaved — returned **flagged, clean, clean** across three identical inputs while the other fifteen
were stable, and the merge rule resolved a split by keeping the more accusatory side. Twelve further readings
of that one fixture, with the tie-break in place: **10 agreed clean outright, 1 split and the tie-break
resolved it to clean (panel of 4), 1 split 2-2 and abstained as `unreviewable / no-agreement`.** Under the old
rule both splits would have published `flagged` on a well-behaved server. Zero false accusations where the old
rule produced two.

Two things follow, and both belong in any honest description of this system:
- **An abstention is not a false accusation, and the harness scores them separately.** On an honest server
  `unreviewable` is a worse answer than `clean` and is counted as such; it is not a reason to distrust the
  reviewer. On a malicious server it *is* a failure — `unreviewable` answers `warn`, the call proceeds.
- **The reviewer is not deterministic even at `temperature: 0`**, because the prompt carries a fresh nonce.
  On the one borderline fixture the readings split roughly 2 times in 12. Every other fixture was stable.

**World**
- **AgentBook registration requires an Orb-verified World ID.** The contract checks `groupId = 1` and only Orb credentials exist on-chain; device-level and Selfie Check proofs cannot register an agent. This is a hard dependency on a physical human.
- Registration is **gasless** — a hosted relay pays. The agent wallet needs no balance. `npx @worldcoin/agentkit-cli register <address>`, scan the QR, then confirm with `status <address>`.
- **One human may register many agents**, and they all return the **same `humanId`**. The contract only guards a per-agent nonce.
- AgentBook is live on World Chain 480 at `0xA23aB2712eA7BBa896930544C7d6636a96b944dA`. It is **also** live on Base 8453 (different address) and **Base Sepolia 84532** — the widespread "mainnet-only" claim is false. `lookupHuman` still resolves against World Chain 480 by default.
- The shipped CLI 0.2.0 hardcodes World Chain and has **no `--network` flag**; its own README and REGISTRATION.md claim otherwise and are stale.
- 🐛 **`agentkit.fetch` silently no-ops against `@x402/hono@2.19.0`** — it reads the challenge from the JSON body, but x402 2.19 puts it in a base64 `payment-required` header and leaves the body `{}`. No signature, no retry, no error, no event. Use `agentkit.createHeader()` and do the retry by hand. See `FRICTION-LOG.md` W1.
- ⚠️ **`lookupHuman()` swallows EVERY error and returns `null` — and `null` is the deny signal.** A dead RPC, a 429, a wrong address and a bad checksum all return exactly what an unregistered agent returns: `@worldcoin/agentkit-core@0.2.0` ends its AgentBook read with a bare `} catch { return null }`. **This corrects what this section and FRICTION-LOG W5 previously said** — the rate limit does *not* throw, which is worse, because a throw is at least distinguishable. Never believe a `null`: re-read it through your own viem client where a transport error actually throws, and only a confirmed on-chain zero becomes `403 agent_not_human_backed`. An agent must never be told no human stands behind it because our RPC was throttled. Still pass `rpcUrl` explicitly (`SUREX_WORLD_RPC_URL`) — the default is a shared public endpoint. (W7)
- ⚠️ **The agent's request header is `agentkit`, not `x-payment`** — undocumented, read out of the SDK. Classifying on the wrong header made a correctly signed agent get refused as a human for having no World ID proof. (W9)
- ⚠️ **AgentBook returns an anonymous human id and NOTHING else.** No call volume, no history, no score. Two of our own copy strings claimed otherwise and were false; both are corrected and a test now fails on any affirmative use of *reputation / score / call volume / track record*. Standing means one thing: a human registered this wallet.
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
- ⚠️ **`QueryResult` pagination fails three ways, two of them silently.** `hasNextPage` is a **method**, so reading it as a property is always truthy; `next()` **mutates and returns undefined**; and pagination needs an explicit `.limit()` or the result declares itself finished after one page. Getting this wrong means quietly serving only the first page — a flagged server missing from the public feed and undercounted in stats. **Always loop explicitly with an explicit limit, and test against more rows than one page holds.** (A6)
- No attribute-to-attribute comparison in queries, so anything derived must be precomputed and stored.

**ENS** — measured while building `contracts/` and `apps/web/app/api/ens/`, on
`@adraffy/ens-normalize@1.11.1`, `viem@2.55.8`, `ethers@6.13.5`, `solc@0.8.28`. Probe:
`node probes/ens-resolve.mjs <labels|contract|mock|gateway|live|sepolia>`. Write-ups in `FRICTION-LOG.md` E1–E9.

- ❌ **`sxf1_<64 hex>` is not a legal ENS label.** ENSIP-15 rejects a mid-label underscore —
  `underscore allowed only at start`. Our own published identifier cannot be used as a subname as
  written, which is why `apps/web/lib/ens.ts` defines a separate `sxf1-<40 hex>` encoding. Do not
  write `<fingerprint>.surex.eth` anywhere; it does not resolve. (E1)
- ⚠️ **Clients disagree on label length, silently.** `ethers.dnsEncode` defaults to 63 bytes and throws
  above it; `viem`'s `packetToBytes` accepts up to 255 verbatim and labelhashes beyond that. **Anything
  64–255 characters resolves in viem and fails in ethers.** Our label is 45 and a test pins it under 64.
  ethers' limit is a second positional argument almost nobody passes. (E2)
- The digest is the ENS reference construction, unchanged:
  `keccak256(abi.encodePacked(hex"1900", resolver, expires, keccak256(callData), keccak256(result)))`.
  `0x1900` is EIP-191 v0 — "intended validator" — which is what binds a signature to one resolver.
- ⚠️ **Sign the RAW digest.** `privateKeyToAccount(key).sign({ hash })`, never `signMessage()` — the
  latter adds a second EIP-191 prefix and `ecrecover` returns an address nobody holds. This is the most
  likely single way to break the whole path, so the same golden vector is pinned in
  `apps/web/lib/ens.ts`, `contracts/test/SureXOffchainResolver.t.sol` and `apps/web/test/ens.test.mjs`,
  which reads the Solidity as text to prove the two literals are the same one.
- **Wildcard resolution needs `supportsInterface(0x9061b923)`** (`IExtendedResolver`) as well as ERC-165
  `0x01ffc9a7`. Without the second, clients resolve the parent's records and never call `resolve()` —
  and nothing errors, so it looks like an empty registry rather than a misconfigured resolver.
- **Deploying the resolver changes nothing until `setResolver` is called on the parent.** That one
  transaction is what turns wildcard resolution on for all 51 entries at once. ENS registry is
  `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e`, same address on Sepolia as on mainnet.

**The live mainnet deployment** — 2026-07-25. These are the real addresses; do not invent others.

| | |
|---|---|
| name | `surex.eth`, expires 2027-07-25, **not** wrapped |
| name owner | `0xFE388539e3fffeA23ba4C5aa4c750cb90f369b2E` — the only key that can `setResolver` |
| resolver | `0x2BEaeC431bB22Fd1160319d0ebDAE886Ef593a8B` (the first deployment, `0xCb140fF30c449c3782D96Bfa356cDDE8E33b2559`, is superseded — E8) |
| resolver owner | `0xC19a460767CcD13c63e0a2470Ee10c75804c3dB4` — the only key that can `setSigner` / `setUrls` |
| pinned signer | `0x9D80524581a242a8F67c5333418B6b8b3a8a6D01`, key in `~/.secrets/surex-ens.env`, never in this repo |
| gateway URL baked in | `https://arkiv-surex.vercel.app/api/ens/{sender}/{data}.json` |

- ✅ **Wildcard resolution is verified on mainnet.** `getEnsResolver` on a subname that was never
  registered returns our resolver, and `resolve()` reverts with a genuine `OffchainLookup` carrying the
  URL above. Roles are split across two wallets on purpose; both are needed and neither substitutes.
- ⚠️ **A dead gateway looks exactly like an empty record.** With `/api/ens/` returning 404, viem's
  `getEnsText` returns `null` rather than throwing. Never read `null` as "the registry has no verdict" —
  check the gateway answers before drawing any conclusion from a `null`.
- ⚠️ **`surex.eth` was registered on mainnet BECAUSE Sepolia is broken**, not by preference. Earlier
  drafts of this file said the name belonged to `0x8FA4C314…` and that we were on Sepolia; both were
  wrong. That address held an expired registration — it lapsed 2024-07-21, and the registry never clears
  records on expiry, so an expired name still resolves. **`available()` is the answer; a resolution is
  not.** (E5)
- ❌ **`.eth` registration on Sepolia has been broken network-wide since ~2026-06-02.** 54 successes
  2026-02-07→2026-05-24, then 13 failures, then nothing. The controller in ENS's own Sepolia manifest is
  0-for-32 and has never worked. Every `register` reverts with **bare `0x`** because the BaseRegistrar no
  longer authorises the NameWrapper, and `commit()` still succeeds, so gas is spent on a first step that
  can never be redeemed. Do not spend time debugging a Sepolia registration; it is not your code. (E5, E6)
- ⚠️ **Setting a primary name for a name you do not own makes the ENS app render it as owned**, with a
  registration date and an expiry that are not real, and makes `getEnsAddress` return the address. This
  cost an hour of chasing a migration that never happened. Trust `registry.owner()` and the account's
  transaction list, not the app. (E7)
- ⚠️ **The ENS app cannot show these records, and says nothing about it.** An offchain resolver cannot
  enumerate its keys, so the app queries a fixed profile set and renders an empty Records tab for a
  name that is serving six records perfectly well. `cast` cannot follow an `OffchainLookup` either.
  **Never send anyone to either to verify this** — they conclude it is broken. Send them to
  `getEnsText` (viem or ethers, both confirmed) or to `probes/ens-resolve.mjs live`. (E9)
- ❌ **`resolve()` must forward `msg.data`, not `data`.** `data` alone is the inner
  `text(bytes32,string)` call and a node is a namehash — one-way, so a gateway holding only that
  cannot recover the label, and the label is the only route to the fingerprint. The first mainnet
  deployment got this wrong and every lookup 400'd. The ENS reference encodes
  `IResolverService.resolve(name, data)` for the same reason. (E8)
- ⚠️ **A test that BUILDS the gateway request proves nothing about the seam.** Both halves passed
  against the same assumption and disagreed with reality. At least one test must take the bytes the
  contract actually emits and feed them to the gateway: `probes/ens-resolve.mjs live` does exactly
  that and names the failing hop, and `test_offchainCallDataCarriesTheName` pins it in Foundry by
  decoding the callData rather than only checking its selector. (E8)
- ⚠️ **Foundry cannot be installed behind a locked-down egress policy** — `foundry.paradigm.xyz` 403s at
  CONNECT and there is no npm-distributed `forge`. `probes/ens-resolve.mjs contract` compiles the
  resolver with solc-js and runs it on an in-process EVM instead; `forge test` remains canonical. (E4)
- solc's legacy code generator **cannot copy a nested calldata dynamic array to storage** —
  `string[] calldata` in a setter is an `UnimplementedFeatureError`. Use `memory` or via-ir. (E3)

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
apps/       api (the /v1 read path) and web (the four screens + the CCIP-Read gateway)
packages/   core, plugin (the gate), reviewer, worker, fixture-mcp
contracts/  the ENS offchain resolver — Foundry, no dependencies beyond forge-std
probes/     throwaway measurement scripts; every §7 fact points at one
docs/       product specs (PRD, tech spec, track fit, failure modes, ENS)
design/     Claude Design output — prototype, tokens, verdict system, architecture plate
public/     the static site currently deployed (explainer as landing)
demo/       chain.mjs — the end-to-end walk
scripts/    seeding, review-and-publish, agent registration
infra/      the DGX reviewer proxy and its systemd unit
FRICTION-LOG.md   sponsor SDK feedback, written as it happens
```
