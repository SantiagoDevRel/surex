# SureX — cross-chat handoff

**Read this first, then `AGENTS.md` (canonical) and `FRICTION-LOG.md`.** This file is the "where we are /
what's next" so a fresh chat is productive without replaying the whole build. Written 2026-07-25.

SureX is a **trust registry for MCP servers** + a Claude Code plugin (PreToolUse hook) that **blocks a flagged
tool call**. The word is always **reviewed** — never safe/trusted/verified/secure. A verdict comes from one
DGX model review + a deterministic capability scan, is written to **Walrus** (evidence blob) + **Arkiv**
(verdict head), and the gate genuinely fetches the blob and re-checks the bytes when it blocks.

## Live surfaces (all verified)

| What | URL |
|---|---|
| Web (registry) | https://arkiv-surex.vercel.app |
| API (`/v1/verdict`, `/v1/registry`, `/v1/stats`, `/v1/disputes`, …) | https://arkiv-surex-api.vercel.app |
| DGX reviewer proxy (`/admin/load-model` pwd 123 on an unguessable path, bearer) | https://surex-reviewer.santiagodevrel.dev |
| Repo | https://github.com/SantiagoDevRel/surex |

Reviewer bearer + the `/admin/load-model` path live in `infra/dgx-reviewer/` (not printed here). To publish:
`SUREX_REVIEWER_BASE_URL=…/v1 SUREX_REVIEWER_API_KEY=… SUREX_REVIEWER_MODEL=qwen3-coder-next:surex32k node scripts/review-and-publish.mjs`

## Done + verified

- Full chain live end-to-end, zero mocks: DGX review → Walrus blob → Arkiv head → gate block → blob-ID
  recompute → override. 285+ tests green.
- **15 fixtures** (`packages/fixtures/{honest,ambiguous,mal}-*`): 5 good / 5 ambiguous / 5 bad, each a real
  runnable stdio MCP. On GitHub (secret-scan clean — the mal-* AWS decoy is assembled at runtime so the
  literal never lands in a file). Dry-run review: honest→clean, ambiguous→clean, malicious→flagged (sev 3-4).
- Agent-dispute path proven live to the correct `403` (signature recovered → AgentBook lookup → honest error).
- World feedback consolidated in `docs/WORLD-FEEDBACK.md` (+ copy in owner's Downloads) — submission material.

## In flight

- **Publish of the 15 fixture verdicts on chain** — bg task `b355novy4`. Re-reviews all 15 on the DGX then
  writes each verdict (idempotent: skips a fingerprint whose head is already on chain). When done, each fixture
  has a `/r/<fingerprint>` verdict page. Check `scratchpad/publish.log`.

## Blocked (external — not our code)

- **World on-chain registration** reverts `NonExistentRoot()` (W14). The Orb proof is valid; World Chain's
  identity tree hasn't bridged the proof's root. Non-transient. Nothing to fix on our side until World's
  bridge advances — then owner retries `node scripts/register-agent.mjs --address 0x…`, and the live
  dispute flips `403 → 202`. Full writeup: `docs/WORLD-FEEDBACK.md` §W14 + `FRICTION-LOG.md`.

## ⭐ NEXT — the model refinement the owner asked for (2026-07-25)

The owner is right and this is the top task. Two things the current model gets wrong:

**1. Tier and Verdict are INDEPENDENT axes, and the app conflates them.**
- **Verdict** = what the review found: `clean / flagged / disputed / unreviewable / unknown`. Comes from the
  *source*.
- **Tier (A/B/C)** = byte-linkage between reviewed bytes and the bytes you'll run (see `tierSentence()` in
  `packages/core/src/verdict.mjs`): A = exact bytes match; B = same version, bytes not compared; C = nothing
  checked, the verdict may be about code that isn't yours.
- These are orthogonal. A remote endpoint is Tier C **but can still carry a real reviewed verdict** if its
  source is published. My earlier "remote = unreviewable, you lose the flag" was too absolute — remote loses
  the *byte-linkage* (Tier C), not necessarily the *review*.
- **App fix:** the site must explain both axes and that they're independent — a short "how to read a verdict"
  block (Verdict = what we found · Tier = did we confirm it's the code you run). The A/B/C legend exists but
  doesn't teach the distinction, which is exactly why the URL/DGX-hosting confusion happened.

**2. Open-source MCPs are REVIEWABLE — we're seeding them as `unknown` instead of reviewing them.**
- Live stats today: `entries 70 · clean 0 · flagged 2 · unreviewable 10 · unknown 58`. The 58 unknowns are the
  well-known npm servers from `scripts/seed-known.mjs` — it fetches their repo source (`fetchRepoFiles:true`)
  and licence-gates them, but **never runs the reviewer**, so it writes them as `unknown`. That's why the
  registry looks empty of real reviews.
- **Fix:** point the SAME reviewer (`review-and-publish.mjs` pipeline / `packages/reviewer`) at the fetched
  npm/GitHub source of the well-known open-source servers and publish real `clean/flagged` verdicts, Tier C
  (unpinned `npx -y` floats the version — honest). That turns the registry from "58 unknowns" into recognizable
  names with actual reviews, and makes the whole product legible. This is the change that makes the model
  "make sense" per the owner.
- Guardrails already in place to reuse: licence gate (only review what we're allowed to), NEVER write `clean`
  without a real review, `unreviewable` with a reason when source isn't readable.

## Other open tasks

- **`Downloads/mcp/`** — one file per fixture: declared tools · true behavior · verdict · capability surface ·
  live `/r/<fp>` URL. Waiting on `b355novy4` for the fingerprints/URLs. DB skeleton already at
  `Downloads/surex-mcp-fixtures.json`.
- **Tier/verdict explainer on the site** (task 1 above, the copy part).
- When World bridge advances: retry registration, verify, run full agent dispute live.

## Map / gotchas (brief — detail in AGENTS.md + FRICTION-LOG)

- `packages/core` = shared brain (SXF-1 fingerprint, verdict copy law, /v1 contract, blob-ID WASM). Vendored
  into the plugin via `scripts/sync-core.mjs` — edit in core, then sync.
- Copy law lives ONLY in `verdict.mjs`. One place, one test.
- Arkiv: Braga, `.createdBy` not `ownedBy`, `orderBy` is a no-op (sort client-side), `expiresIn` even seconds,
  `query()` returns one cursor page — must loop.
- Walrus: blob = register+certify (2 tx), blob ID ≠ sha256 (needs the vendored WASM encoder), Quilt batches
  many entries into one blob, publisher does NOT dedupe (idempotency is ours).
- Vercel monorepo: Root Directory per app + `framework:null` on the API (auto-detect hung it); API uses a
  custom Node adapter because the Hono adapter dropped Vercel's pre-parsed `req.body` (V6).
