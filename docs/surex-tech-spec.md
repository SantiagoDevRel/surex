# SureX — Technical Specification

> Version 1, 2026-07-24. Companion to [`surex-prd.md`](./surex-prd.md).
> Requirement IDs (FR-n, NFR-n) refer to the PRD. Items marked **UNVERIFIED** were not confirmed against primary docs — check before relying on them.

---

## 1. Architecture

```
                    ┌───────────────────────────────────────────┐
  developer machine │  Claude Code                              │
                    │    │ PreToolUse (matcher mcp__.*)         │
                    │    ▼                                       │
                    │  surex-gate ──► local cache (disk + mem)  │
                    └────┬──────────────────────────────────────┘
                         │ HTTPS GET /v1/verdict?fp=…
                         ▼
                    ┌─────────────────┐
                    │ surex-api       │  read path, thin, cacheable
                    └────┬────────────┘
                         │ arkiv_query
                         ▼
        ┌────────────────────────────┐        ┌──────────────────┐
        │ Arkiv (Braga)              │◄───────│ surex-worker     │
        │  RegistryEntry             │        │  ingest · review │
        │  SourceRecord   (immutable)│        │  listener        │
        │  ReviewRecord   (immutable)│        └───┬──────────┬───┘
        │  VerdictHead   (mutable)   │            │          │
        │  Dispute                   │            ▼          ▼
        └────────────────────────────┘   ┌────────────┐  ┌────────────┐
                    ▲                    │ Walrus/Sui │  │ DGX        │
                    │                    │ all records│  │ Reviewer   │
        ┌───────────┴────────────┐       └────────────┘  └────────────┘
        │ surex-web              │
        │  submit (World ID)     │
        │  dispute (World ID /   │
        │           AgentKit)    │
        └────────────────────────┘
```

Five services. `surex-gate` (client binary), `surex-api` (read path), `surex-worker` (ingest, review, listener), `surex-web` (submit + dispute UI), and the Arkiv/Walrus data layer.

The read path and the write path never share a process. The Gate can only read; only the worker's wallet writes verdicts, and every consumer read filters on that wallet (§4.3).

---

## 2. `SXF-1` — the install-config fingerprint

Normative. Version the algorithm: a change to canonicalisation changes every key in the registry.

### 2.1 Inputs

From the MCP server definition in the client's config, after `${VAR}` expansion:

```jsonc
// stdio
{ "mcpServers": { "gh": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github@1.2.3"],
                          "env": { "TOKEN": "${GH_TOKEN}" } } } }
// remote
{ "mcpServers": { "stripe": { "type": "http", "url": "https://mcp.stripe.com/v1?x=1" } } }
```

Config sources, highest precedence first — **not merged**, first match wins entirely: local scope → project `.mcp.json` → user scope (`~/.claude.json`, `mcpServers`) → plugin-provided (`.mcp.json` in the plugin, or inline in `plugin.json`) → connectors. Enterprise-managed config location **UNVERIFIED**.

### 2.2 Canonical form — stdio

```jsonc
{
  "v": "SXF-1",
  "transport": "stdio",
  "runner": "npx",                                    // basename, lowercased
  "package": { "name": "@modelcontextprotocol/server-github", "version": "1.2.3" },
  "args": ["--read-only"]                             // residual args, order preserved
}
```

Rules:

- **`runner`** is the `command` basename, lowercased. `/usr/local/bin/npx` and `/opt/homebrew/bin/npx` must produce the same fingerprint. Recognised: `npx`, `uvx`, `node`, `python`, `python3`, `bun`, `deno`, `docker`. Anything else: `runner: "other:<basename>"`.
- **`package`** is parsed out of `args` per runner. `npx -y pkg@1.2.3` → `{name:"pkg", version:"1.2.3"}`. No version → `version: "unpinned"`. A git/branch spec → `version: "unpinned"`. Docker → `{name:"<image>", version:"<tag or digest>"}`; a `sha256:` digest counts as pinned.
- **Stripped from `args`**: runner ceremony (`-y`, `--yes`, `--quiet`), the package spec itself, absolute filesystem paths, and a denylist of transient flags (`--port`, `--debug`, `--verbose`, `--log-level`). Residual args keep their order — most CLIs are order-sensitive; do not sort.
- **`env` is excluded entirely** (NFR-2). Values are secrets; keys leak little and cost nothing to drop.

**Pinned vs unpinned are different fingerprints.** `pkg@1.2.3` and `pkg` are separate registry entries, because they are materially different trust claims. Do not collapse them.

### 2.3 Canonical form — remote

```jsonc
{ "v": "SXF-1", "transport": "http", "host": "mcp.stripe.com", "path": "/v1" }
```

Lowercase host, strip default port, strip query string and trailing slash, exclude `headers` (auth lives there). This identifies an **endpoint, not a version of anything**, and always yields Tier C.

### 2.4 Hash

`fingerprint = "sxf1_" + sha256(JSON.stringify(canonical, sortedKeys))`, hex, lowercase.

### 2.5 Tier assignment

| Tier | Condition |
|---|---|
| A | `version` pinned **and** installed integrity digest == the digest recorded at review time |
| B | `version` pinned, no integrity digest obtainable |
| C | `version == "unpinned"`, or `transport != "stdio"` |

**Tier A via npm integrity (FR-18).** npm publishes a per-version `dist.integrity` (sha512 of the published tarball), readable from the registry metadata without downloading it. At review time the worker records it. On the client, the Gate reads the installed package's `node_modules/<pkg>/package.json` `_integrity`, or the matching lockfile entry, and compares.

```ts
// worker, at review time
const meta = await fetch(`https://registry.npmjs.org/${name}/${version}`).then(r => r.json());
record.integrity = meta.dist.integrity;          // "sha512-…"

// gate, at decision time
const local = readInstalledIntegrity(name, version);   // lockfile or _integrity field
tier = local == null ? 'B' : local === record.integrity ? 'A' : 'MISMATCH';
```

A `MISMATCH` means the published artifact for this version changed after we reviewed it. Downgrade the entry to `stale` and warn — **never block on a mismatch alone** (FR-19). A mismatch is far more often a registry quirk or a local rebuild than an attack, and blocking on it would train users to disable the Gate.

This solves risk #1 only for npm. `uvx`, `docker` (unless a `sha256:` digest is pinned), and git installs stay Tier B. Say so rather than implying Tier A is universal.

---

## 3. The Gate

### 3.1 Registration

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "mcp__.*",
        "hooks": [{ "type": "command", "command": "~/.surex/bin/surex-gate" }] }
    ],
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "~/.surex/bin/surex-gate prefetch" }] }
    ]
  }
}
```

`mcp__.*` is mandatory. A bare `mcp__github` is exact-match and fires on nothing. The `.*` form also catches plugin-provided servers, whose tools are named `mcp__plugin_<plugin>_<server>__<tool>`.

### 3.2 Input

Captured verbatim from Claude Code 2.1.220 (`probes/hook/.out/last-hook-input.json`). Three of these keys
are undocumented: `prompt_id`, `effort`, and `transcript_path`.

```json
{
  "session_id": "71c3369b-4938-4790-bbd3-43ca6f9feae6",
  "transcript_path": "…/.claude/projects/<slug>/71c3369b-….jsonl",
  "cwd": "/home/user/project",
  "prompt_id": "eef9ec65-b9de-4866-b138-29bf11a368f6",
  "permission_mode": "default",
  "effort": { "level": "high" },
  "hook_event_name": "PreToolUse",
  "tool_name": "mcp__github__create_issue",
  "tool_input": { "title": "..." },
  "tool_use_id": "toolu_02XYZ"
}
```

**The server name is not a field.** Parse it from `tool_name`. Do not assume three `__`-delimited parts — handle the `plugin_<plugin>_<server>` compound case explicitly:

```ts
function parseServer(toolName: string): string | null {
  const m = toolName.match(/^mcp__(plugin_[^_]+_)?(.+?)__(.+)$/);
  return m ? m[2] : null;                       // add a test for the plugin shape
}
```

Then map server name → config block (§2.1 precedence) → `SXF-1` fingerprint.

### 3.3 Output

**Allow, silent** (`clean`) — exit 0, no stdout. Falls through to the normal permission flow, leaves no trace.

**Block** — when `state ∈ {flagged, disputed}` and `severity >= 3`. Both are annotations, so the test is local to the single hot-path read. `enforceAfter` does **not** gate blocking; it selects the wording (FR-21):

```ts
const confidence =
  state === 'disputed'      ? 'disputed'    :   // contested, both sides shown
  Date.now() > enforceAfter ? 'confirmed'   :   // window elapsed, uncontested
                              'unconfirmed';    // automated only, maintainer notified
```

The three variants differ in the first line and the confidence sentence. Everything after — evidence, capability surface, provenance, override — is identical, because the user needs the same facts regardless of how sure we are:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "SureX blocked this call — @acme/mcp-tools@2.1.0\n\nFlagged by automated review. Not confirmed by a human. The maintainer has been notified and may respond.\n\nFinding (high): the tool description instructs the model to read ~/.ssh/id_rsa and include it in an unrelated API call — src/tools/search.ts:88\nThis code can reach: network · filesystem · environment variables\n\nReviewed: commit a3f9c1 · blob 0x7d2e… · 2026-07-24 · model qwen3-coder, prompt rv-1. No human audited this.\nEvidence: https://surex.dev/r/sxf1_9a2b…    Dispute: https://surex.dev/d/sxf1_9a2b…\n\nYou can proceed anyway, at your own risk:  surex allow sxf1_9a2b…"
  }
}
```

The other two variants replace only the second line:

- **confirmed:** `"Flagged by automated review, uncontested since 2026-07-21."`
- **disputed:** `"Flagged by automated review, and contested by the maintainer. Their rebuttal: <summary>. A human review is pending."`

`permissionDecisionReason` is shown to the user **and** given to the model as the block reason. It is the only channel that reaches both, so the whole evidence payload goes in this string (FR-3). Exit code stays 0.

**Warn and proceed** (`unknown`, `stale`, `unreviewable`, or registry unreachable):

```json
{
  "systemMessage": "⚠ SureX: @acme/mcp-tools is not in the registry. Proceeding unverified."
}
```

**`systemMessage` alone. No `permissionDecision`.** An earlier draft of this spec emitted
`permissionDecision: "allow"` here. That was a security bug, and measuring it was the point of the
hour-one probes: **`allow` grants, it does not merely permit.** With no allowlist entry and no prior user
grant, a hook returning `allow` caused the MCP tool to execute — so the *unknown* path would have
auto-approved exactly the servers SureX knows least about, leaving a user who installed SureX worse off
than one who did not. Verified both ways in `probes/hook` (`NO_ALLOWLIST=1 bash run.sh allow-warn` vs
`… warn-only`); written up as FRICTION-LOG C2.

Returning no decision leaves Claude Code's own permission flow in charge, which is the correct posture:
SureX has an opinion, not authority, on everything except a flag.

`systemMessage` is shown to the **user only** and never enters the model's context — right for a recurring
banner that shouldn't pollute every turn. When the model should also know, say it in a `deny` reason or
not at all; do not reach for `allow` to carry a message.

**Exit codes.** `0` = parse stdout as JSON (no stdout = no effect). `2` = blocking error, stderr becomes the block reason. Any other non-zero = **non-blocking**, the tool proceeds and stderr is truncated to one line in the transcript — never use it for policy.

### 3.4 Cache and latency

| Layer | Scope | Positive TTL | Negative TTL |
|---|---|---|---|
| in-process LRU | session | 15 min | 120 s |
| disk (`~/.surex/cache.json`) | machine | 15 min | 120 s |

`SessionStart` prefetch reads every config source directly, computes all fingerprints (typically 5–20) and warms the cache in one batched request before the first tool call. It must not query the MCP servers themselves — `SessionStart` hooks fire before MCP connections are established. Fingerprinting is config-only, so this is a non-issue by construction.

Cached `flagged` verdicts persist across restarts. A network blip must not un-flag a known-bad server.

### 3.5 Failure and override

Registry unreachable, slow, or malformed ⇒ treat as `unknown`: **fail open with a visible notice** (NFR-1). Fail-closed turns a SureX outage into a total agent outage for every user — disproportionate for a trust layer with no SLA, and the fastest way to get uninstalled.

This is not only our policy, it is the platform's: **a `PreToolUse` hook that exceeds its timeout fails open** — the process is killed (`outcome: "cancelled"`, exit 1), its stdout is discarded, and the tool call proceeds. Verified, `HOOK_TIMEOUT=5 bash run.sh hang 20`; FRICTION-LOG C1. Two consequences:

- There is no fail-closed opt-in, so **the gate must never treat its own timeout as enforcement**. Anything that makes it slow — a stalled registry, a cold DNS lookup, a large cache read — silently skips the check with no signal to the user. Keep the gate's own budget well inside the configured timeout and return a decision every time.
- A cached `flagged` verdict must be readable and returnable without any network at all (§3.4), because the offline path is the only one that cannot be timed out into silence.

**Override (FR-6).** `~/.surex/overrides.json`, a list of fingerprints checked before the registry. `surex allow <fp>` appends to it; `surex allow --once <fp>` scopes it to the current session. The command is printed in every block message, so the escape hatch is never more than a copy-paste away.

Overrides are local and are not reported anywhere. A registry that phones home about which warnings you ignored is a different product, and a worse one. Aggregate override rate (PRD §12) can only come from users who opt in.

The override is the entire reason blocking is acceptable. SureX's job is to make sure nobody runs a flagged server *unknowingly* — not to decide for them. A block a user cannot pass is a block that gets the Gate uninstalled the first time it is wrong.

---

## 4. Data model — Arkiv entities over Walrus blobs

Braga testnet. Every entity carries `PROJECT_ATTRIBUTE` (`{key:'project', value:'surex-lisbon-<suffix>'}`) and `entityType`. Annotations are queryable; payload is not. Each annotation below exists to serve a named query — nothing is annotated speculatively.

### 4.0 The storage rule

**Every record's body is a Walrus blob. The Arkiv entity is the queryable pointer to it.**

| Layer | Holds | Read when |
|---|---|---|
| Arkiv annotations | state, severity, tier, status, timestamps, fingerprint, blob pointer | every lookup |
| Arkiv payload | the blob ID, its Sui object/tx digests, and nothing that requires a second fetch to act on | every lookup |
| Walrus blob | the record body — findings with file/line, evidence text, canonical config, dispute submissions | only to *display*, never to *decide* |

The Gate must reach a decision from the Arkiv read alone. Fetching a blob to know whether to block would double the round trips on every tool call. The blob is fetched at exactly one moment: when SureX is about to block and a human is about to read the evidence, where a few hundred milliseconds is invisible.

Consequence to plan for: one Walrus write per record means two Sui transactions and WAL per record. Seeding 100 servers as entry + version + verdict is ~300 blobs and ~600 transactions (§4.5).

### 4.1 Entities

Each entity's payload carries a `blob` object — `{ id, suiObjectId, registerTx, certifyTx, encodingType }` — identifying the Walrus record body. Written as `blob` below.

**Source and review are deliberately separate entities**, each with its own Walrus blob. The code is one certified artifact; the judgement about it is another. Keeping them apart means a review can be superseded, disputed or re-run without touching the evidence it was made against, and a judge can verify each independently: *this is the code*, and separately, *this is what was concluded about it*.

```jsonc
// RegistryEntry — identity. One per fingerprint. Written once.
attributes: { entityType:'registryEntry', fingerprint, name, tier }
payload:    { fingerprint, blob }
// blob body: { canonicalConfig, seedSource, description, aliases }

// SourceRecord — one per version. The CODE. Immutable. Blob = the source tree.
attributes: { entityType:'source', fingerprint, versionString, fetchedAt /*numeric*/,
              licence /*SPDX id*/ }
payload:    { blob, repo, commit, normalisedTreeSha256,
              integrity /* npm dist.integrity, for Tier A */, schemaHash /* remote only */ }
// blob body: the normalised source tree itself

// ReviewRecord — one per review run. The VERDICT. Immutable. Blob = the findings.
// Separate entity from SourceRecord: one source can be reviewed many times
// (new model, new prompt version, post-dispute re-review). N reviews : 1 source.
attributes: { entityType:'review', fingerprint, sourceKey,
              verdict /*clean|flagged|unreviewable*/, severity /*0-4 numeric*/, analyzedAt /*numeric*/ }
payload:    { blob, reviewedSourceBlobId, supersedes }
// blob body: { findings:[{file,line,description,severity}], statedIntentSummary,
//              modelId, promptVersion, agreementRuns, rawModelOutput }

// VerdictHead — mutable pointer. ONE live per fingerprint. What the Gate reads.
// EVERY field the Gate needs to decide is an annotation. No blob fetch on the hot path.
attributes: { entityType:'verdictHead', fingerprint,
              state /*clean|flagged|disputed|unreviewable|stale|unknown*/,
              reason /*licence|source-unavailable|remote-endpoint|null*/,
              tier /*A|B|C*/, severity /*numeric*/, needsReanalysis /*'true'|'false'*/,
              enforceAfter /*numeric — 72h; selects block WORDING, not whether we block, FR-21*/ }
payload:    { latestReviewKey, evidenceBlobId /* fetched only when blocking */,
              sourceKey, reviewedSourceBlobId, reviewedCommit, updatedAt, disputeKey, blob,
              integrity /* Gate compares locally for Tier A */,
              capabilities /* small enough to inline — shown on every verdict */ }

// Dispute — lifecycle.
attributes: { entityType:'dispute', reviewKey, fingerprint,
              status /*open|under_review|upheld|overturned*/,
              contestantType /*human|agent*/ }
payload:    { blob, submittedAt }
// blob body: { evidence, worldIdNullifier | agentBookHumanId, agentAddress, statement }
```

Putting dispute evidence in a certified blob is deliberate: a contestant's submission must be as hard for SureX to alter after the fact as SureX's own verdict is. Otherwise the appeals process asks the accused to trust the accuser's database.

**Why the head/record split.** Verdicts are append-only (FR-10); a separate mutable pointer carries current state. Mutating verdicts in place would let a compromised backend erase the fact that a flag was ever issued — which destroys the one property the whole product rests on. It also keeps the hot path to a single-entity read instead of a sort over history.

### 4.2 Queries

```ts
// (a) hot path — the only query on the critical path
await publicClient.buildQuery()
  .where([ eq(PROJECT_ATTRIBUTE.key, PROJECT_ATTRIBUTE.value),
           eq('entityType', 'verdictHead'), eq('fingerprint', fp) ])
  .createdBy(SUREX_WORKER_ADDRESS)        // reject planted verdicts — load-bearing
  .withPayload(true).limit(1).fetch();

// (b) version history      → entityType='source'     + fingerprint
// (b2) reviews of a source → entityType='review'     + sourceKey
// (c) all flagged          → entityType='verdictHead' + state='flagged'
// (d) open disputes        → entityType='dispute'    + status='open'
// (e) needs re-analysis    → entityType='verdictHead' + needsReanalysis='true'
```

Two constraints from the query engine, both design-forcing:

- **No attribute-to-attribute comparison.** Operators (`=,!=,<,>,<=,>=,~`) compare an attribute to a literal only. So (e) cannot be "latestRelease > analyzedAt" — the listener must *precompute* `needsReanalysis` on the head when it sees a new release. This is why `stale` is a stored state and not a derived one.
- **No `orderBy` confirmed** in the SDK query builder (**UNVERIFIED**) — sort version history client-side.

`.createdBy(SUREX_WORKER_ADDRESS)` on every consumer read is not optional. A shared public testnet has no uniqueness constraint; without it, anyone can write a colliding fingerprint under our project attribute and the Gate would read their verdict.

### 4.3 Writes

- `updateEntity` is a **full replacement** — read → merge → write, and always re-include `PROJECT_ATTRIBUTE` or the entity silently drops out of every scoped query.
- **Poll after write.** Indexing lags the transaction. Poll `getEntity(entityKey)` at ~250 ms up to 5 s before trusting a read that depends on a write you just made — matters right after seeding, and after writing a head the Gate may immediately query.
- **Seed batching**: `mutateEntities({creates:[…]})` in chunks of 50–100. No documented maximum (**UNVERIFIED**) — measure on Braga before scaling the chunk.

### 4.4 Expiration

Arkiv entities always expire. A registry that silently evaporates is broken, so expiration is part of the design, not a deployment detail.

| Entity | Expiration | Renewed by |
|---|---|---|
| RegistryEntry | 90 days | nightly extend-if-active |
| VerdictHead | 7 days | rewritten on every new review — activity resets it |
| ReviewRecord / SourceRecord | 30+ days | none; outlives the head deliberately |
| Dispute | 30 days | extended while `open` |

History outliving the pointer is intentional: if a head lapses, it can be rebuilt from the latest ReviewRecord instead of re-running a review.

Read logic gives the consumer three distinguishable answers — entry + head → current verdict; entry, no head → `stale`, warn; neither → `unknown`, warn. **Hackathon:** set 30-day expirations on everything, skip the renewal job, demo the three-state read. That is honest to present as production design.

Arkiv expiration and Walrus epochs are independent clocks and will drift apart. An Arkiv entity can outlive its blob's storage, leaving a pointer to bytes no storage node still serves. The UI must distinguish *"evidence expired"* from *"no evidence"* — the first is a funding failure, the second would be a lie.

### 4.5 Write cost and batching

One record = one Walrus write = two Sui transactions + WAL. Budget accordingly:

| Operation | Blobs | Sui txs |
|---|---|---|
| Seed one server (entry + source + review) | 3 | 6 |
| Seed 100 servers | ~300 | ~600 |
| One new release (source + review + head rewrite) | 3 | 6 |
| One re-review of existing source (review + head rewrite) | 2 | 4 |
| One dispute (dispute record + head rewrite) | 2 | 4 |

**Why two transactions:** a Walrus write is a two-phase on-chain protocol — *register* (reserve a `Storage` object, create the `Blob` object) and *certify* (after a 2/3 sliver quorum, emit `BlobCertified`). Both are Sui transactions, and the cost is per blob, not per byte: a 2 KB verdict record costs the same two transactions as a 2 MB source tree.

Three levers:

- **Quilt the bulk.** [Walrus Quilt](https://www.walrus.xyz/blog/introducing-quilt) batches up to 660 small blobs into one storage unit, amortizing one transaction fee and one storage reservation across all of them — roughly 106× cheaper for 100 KB blobs and 420× for 10 KB. Our record bodies are a few KB of JSON, which is the case Quilt was built for. **The trade:** a quilted record is addressed as (quilt blob, patch id), not as its own certified Sui object, so it loses the per-record explorer link. Therefore: **quilt seed-time entry records; keep standalone certified blobs for source trees, reviews, and dispute evidence**, where individual citability is the entire point (§11, track-fit §1).
- **Let the publisher pay.** Uploads through the public HTTP publisher are submitted and paid for by the publisher, so maintainer submissions from the browser cost SureX no gas. Public testnet publishers are rate-limited and cap requests at 10 MiB, so this helps the submission path, not bulk seeding.
- **Fund and batch on day one.** The testnet SUI faucet is rate-limited and WAL comes from `walrus get-wal`. A seeding run that stalls at server 40 is a demo with an empty registry. Seed a deliberate 50–100, Arkiv writes chunked at 50–100 per `mutateEntities` call, Walrus uploads pipelined ahead of them.

**VerdictHead is the exception worth reconsidering.** It is rewritten on every state transition and exists to be a small mutable pointer. A blob per rewrite gives a certified trail of head transitions — nice, but not load-bearing, since the immutable ReviewRecords already are the audit trail. If write volume bottlenecks the build, inline the head payload in Arkiv and keep blobs for the immutable records. Decide by measurement, not in advance.

---

## 5. Walrus storage

Walrus stores two different things: **source trees** (what we reviewed) and **record bodies** (what we concluded). Both are blobs; only the first is code.

**Write path.** Backend (`surex-worker`): `@mysten/walrus` SDK with a service keypair — no 10 MiB publisher cap, batchable, deterministic control over blob mode. Browser (`surex-web`): HTTP `PUT https://publisher-testnet.walrus.space/v1/blobs?epochs=N` so a maintainer needs no wallet and SureX pays no gas; use `writeFilesFlow()` with a connected wallet only if we want the maintainer to own the blob object.

**Blob mode: owned, permanent, sent to the SureX service address.** Not `deletable` — the registry's evidence must not be quietly removable. `--share` is the alternative if we want anyone to be able to extend storage; it trades a centralisation point for a control point.

**What lands on Sui.** Two transactions per blob: register (creates a `Blob` object reserving `Storage`, with `blob_id`, `size`, `encoding_type`) and certify (after a 2/3 storage-node quorum, emitting `BlobCertified`). Both have ordinary Sui digests. Record `suiObjectId`, `registerTxDigest` and `certifyTxDigest` on every record so any verdict links to an explorer.

**Blob ID as content anchor.** Walrus erasure-codes the blob, computes a vector commitment per sliver, builds a Merkle tree over those commitments, and hashes the root with metadata to produce a u256 blob ID. It is content-addressed and deterministic — identical content yields an identical ID, and identical bytes deduplicate (`alreadyCertified`). This is what anchors a verdict to exact source (PRD §5). ([encoding](https://docs.walrus.site/design/encoding.html), [whitepaper](https://arxiv.org/pdf/2505.05370))

Two caveats that constrain how we use it:

- **It is not `sha256(bytes)`.** Deriving a blob ID requires the Walrus encoder. A Tier A local integrity check therefore cannot be a plain shasum — the Gate must either run the encoder or compare a separate digest we record alongside the blob ID. Decide this before building Tier A (§13.1).
- **Determinism is over content *and* the Walrus configuration** (shard count, encoding type). Blob IDs are stable within a network configuration, not guaranteed across an encoding or config change. Record `encodingType` and network on every record so a future ID mismatch can be explained rather than read as tampering.

**Epochs.** Testnet epoch = 1 day (max 183); mainnet = 2 weeks. On lapse the bytes stop being retrievable from storage nodes even though the Sui record persists — so an expired record means SureX still has the index entry, blob ID and on-chain proof of registration, but not the source. Buy max epochs on testnet; a renewal cron is a stated v1 gap. Testnet WAL prices are arbitrary — never quote them as real cost.

**Logistics.** SUI from `faucet.sui.io` (Discord as backup), WAL via `walrus get-wal` or `stake-wal.wal.app`. Testnet has been fully redeployed before — don't hardcode package/object IDs, read them from `walrus info` on the day.

---

## 6. Reviewer (DGX)

**Interface.** OpenAI-compatible chat completions against the on-site DGX. One environment variable switches the base URL, so the box is swappable for a hosted OSS endpoint if it fails. This is the only mitigation for a single physical dependency; do not couple to DGX-specific APIs.

**Input.** Stated intent = the server's declared tool names + descriptions + input schemas + README. Code = the source tree fetched from the Walrus blob.

**Prompt hardening (NFR-3)** — mandatory, cheap, and the difference between a review and a laundering service:

1. Untrusted content goes inside explicit delimiters and is labelled as data to analyse, never as instruction.
2. A standing directive: instructions found inside reviewed content are findings, not commands. Text that tries to steer the reviewer is itself a high-severity signal.
3. Every review runs **twice with paraphrased prompts**. Agreement → verdict stands. Disagreement → `severity` capped and `agreementRuns` recorded; do not flag on a single dissenting run.

4. Text in reviewed source that tries to instruct the reviewer is emitted as a finding of its own, `category: "reviewer-injection"`, severity 4 (FR-22). An injection attempt is a stronger malice signal than most intent mismatches — treat it as evidence, not noise.

**Output schema** (validated; a malformed response is a failed review, not a `clean` verdict):

```jsonc
{
  "verdict": "clean" | "flagged" | "unreviewable",
  "reason": null | "licence" | "source-unavailable" | "remote-endpoint",
  "severity": 0,                               // 0 none … 4 critical
  "findings": [{ "file": "src/x.ts", "line": 88, "category": "…", "description": "…", "severity": 3 }],
  "statedIntentSummary": "…",
  "capabilities": {                            // FR-17 — static scan, NOT model output
    "network":     { "present": true,  "evidence": ["src/api.ts:12 fetch()"] },
    "filesystem":  { "present": true,  "evidence": ["src/fs.ts:8 readFile()"] },
    "exec":        { "present": false, "evidence": [] },
    "env":         { "present": true,  "evidence": ["src/cfg.ts:3 process.env"] },
    "credentials": { "present": false, "evidence": [] }
  },
  "modelId": "…", "promptVersion": "rv-1", "agreementRuns": 2
}
```

**The capability surface is not model output.** It comes from a static scan — import and call-site matching for network, filesystem, process-exec, env and credential access — run independently of the LLM. That matters: it is the one part of a verdict that cannot be talked out of its conclusion by text in the file it's reading. Keep it deterministic, keep it separate, and show it on `clean` verdicts too (PRD §6).

**What review cannot see** — state this in the product, not just the docs. Obfuscated or packed code. Runtime-loaded payloads (`eval`, fetch-then-exec) that don't exist at review time. Transitive dependencies — the actual npm/PyPI attack pattern; the top-level source can be spotless while `node_modules` is not. Conditional payloads keyed on date, hostname or input. Native binaries and post-install scripts. Cross-server interactions — review is per-server, sessions are not.

---

## 7. Identity

### 7.1 World ID — humans

`@worldcoin/idkit`, `verification_level: "device"` (Orb is stronger but not realistic to require). Verify server-side by forwarding the payload to `POST https://developer.world.org/api/v4/verify/{app_id}`.

| Flow | `action` | `signal` | Uniqueness rule |
|---|---|---|---|
| Maintainer submit | `maintainer-submit` | `hash(repoUrl)` | one nullifier per action — reject duplicates |
| Human dispute | `contest-verdict` | `hash(verdictKey + evidenceHash)` | N per nullifier per rolling window, not one-shot |

The nullifier hash is deterministic per (person, app, action) and unlinkable across actions — that is the whole anti-Sybil primitive. Store it as decimal `NUMERIC(78,0)`, never raw hex (documented hex-parsing bug class). Store nothing else about the person (NFR-4). Never generate relying-party signatures client-side.

Dev: `environment: "staging"` + [simulator.worldcoin.org](https://simulator.worldcoin.org/) for all iteration.

### 7.2 AgentKit — agents

AgentKit is an extension of **x402**, not a standalone widget. A human registers an agent's wallet in **AgentBook** once; afterwards the wallet itself carries the human-backing.

```ts
// one-time, by a human, on a phone with World App:
//   npx @worldcoin/agentkit-cli register <agent-wallet-address>

// agent side — signs the dispute request
const agentkit = createAgentkitClient({
  signer: { address, chainId: 'eip155:8453', type: 'eip191', signMessage }
});
await agentkit.fetch('https://api.surex.dev/v1/disputes');

// SureX side — the gate that qualifies the integration
const humanId = await createAgentBookVerifier().lookupHuman(agentAddress); // string | null
if (!humanId) return reject(403, 'agent not human-backed');
```

`lookupHuman` returns an anonymous human identifier or `null`. A non-null result grants **standing to dispute** — it does not grant access, and it does not make the dispute correct.

**No testnet for AgentBook.** Registration resolves against World Chain (`eip155:480`), with the CLI defaulting to a gasless relay on Base mainnet (`eip155:8453`), and requires a real World App verification on a phone. Do the one registration on day one, not at hour 35. Contract address on World Chain reported as `0xA23aB2712eA7BBa896930544C7d6636a96b944dA` — **UNVERIFIED**, confirm on an explorer before hardcoding.

*Naming hazard:* Coinbase also ships an "AgentKit" (`@coinbase/agentkit`). Searching "agentkit testnet" lands on the wrong docs.

---

## 8. Ingest

**Submission gate (FR-15).** Two independent proofs, because they answer different questions:

| Proof | Question | Mechanism |
|---|---|---|
| World ID | Is this a unique human? | IDKit, `action: maintainer-submit`, nullifier-enforced (§7.1) |
| Repo ownership | Does this human control this code? | GitHub OAuth with repo admin scope, **or** a `surex-verify.txt` containing a SureX-issued token committed to the repo's default branch and fetched over raw HTTPS |

Prefer the committed-token path where OAuth scope is a concern — it proves write access without SureX holding a GitHub token, and it's trivial to verify. The seed crawler is the **only** actor exempt from both; its entries carry `seedSource` and start at `unknown`.

**Licence gate (FR-16).** Before any source upload, resolve the licence — SPDX identifier from `package.json`, or a `LICENSE`/`LICENCE` file matched against SPDX templates. Redistribution-permitting licences (MIT, Apache-2.0, BSD-*, ISC, MPL-2.0, and the GPL family) proceed to Walrus. Anything else — no licence found, a proprietary licence, or an unmatched custom text — is written as `unreviewable` with `reason: 'licence'` and no source upload. Treat *unmatched* as ineligible, not as permissive: guessing wrong here writes someone's code to storage with no delete.

**Seeding.** Crawl the official MCP Registry and PulseMCP → resolve each to a repo + release → **licence gate** → fetch source → Walrus → Arkiv. Seeded-but-unreviewed entries are written with `state: 'unknown'`, never `clean`. A seeded entry that inherits an existing backdoor must not gain legitimacy from being listed.

**Remote endpoint monitor (FR-20).** For Tier C remote servers there is no source, so monitor the only surface that is observable: connect, call `tools/list`, and hash the sorted tool names plus their descriptions and input schemas. Store that hash on the entry. On each subsequent poll, a changed hash raises a `schema-drift` finding with a diff of what changed. This catches the tool-description rug-pull — the exact attack class from the Invariant Labs disclosure — on servers whose code we can never read.

**GitHub listener.** Webhook on `release`/`push` where available, polling otherwise. On a new release: set `needsReanalysis='true'` and `state='stale'` on the head *immediately* (before review completes), then write a new SourceRecord (blob = the new source tree) → run review → write a ReviewRecord referencing it → rewrite the head. The window between release and review is exactly when a rug-pull lands, so it must read `stale`, not `clean` (FR-12).

**Maintainer notice.** On a flag, notify the maintainer immediately with the finding and a dispute link, and set `enforceAfter = now + 72h`. The server blocks from the moment it is flagged — the window only controls whether the block calls itself *unconfirmed* or *confirmed* (§3.3). The maintainer gets the chance to answer before an accusation hardens; users get protection with no delay. Earlier drafts delayed enforcement instead, which contradicted the time-to-block metric in PRD §12.

---

## 9. Dispute state machine

```
        submit evidence (World ID | AgentKit)
open ──────────────────────────────────► under_review ──► upheld     (head → flagged,
  │                                                    │              confidence 'confirmed')
  └── while open or under_review:                      └─► overturned (head → clean,
      head.state = 'disputed'                                          new ReviewRecord
      → Gate STILL BLOCKS, showing both                                with supersedes)
        the finding and the rebuttal (FR-5)
```

A dispute does not unblock anything. It changes what the user is told — the block now carries the maintainer's rebuttal next to the accusation — and it queues a human review. Only an *overturn*, decided by a person, produces a `clean` head and a silent allow.

This is the important correction to an earlier draft of this spec, which let a dispute suppress blocking. That was wrong: it handed anyone with standing a way to switch off enforcement on a genuinely malicious server just by contesting it. The block-as-DoS risk it was protecting against is already removed at the root by maintainer-gated submission (FR-15), so nothing is lost.

Overturning writes a **new** ReviewRecord against the same SourceRecord, referencing the old review via `supersedes`. Nothing is deleted, and the code it judged is untouched — which is the point of keeping source and review as separate entities. The correction is as durable and as prominent as the original claim (PRD §6).

---

## 10. API

```
GET  /v1/verdict?fp=<fingerprint>          → head + evidence summary   (hot path, cacheable)
POST /v1/verdicts/batch  { fps: [...] }    → prefetch at session start
GET  /v1/entry/<fp>                        → entry + source history + review history
GET  /v1/source/<key>                      → source record + Sui/Walrus links
GET  /v1/review/<key>                      → review record + the source it judged
POST /v1/submissions     { repo, release, worldIdProof }        → 202
POST /v1/disputes        { verdictKey, evidence }               → 202
       auth: World ID proof (human) | AgentKit x402 header (agent)
GET  /v1/flagged                           → public feed for org-level gateways (FR-14)
```

`/v1/verdict` must be servable from cache and must never block on a write path.

---

## 11. Sequence — the demo path

```
1. Agent calls mcp__acme__search
2. Gate: parse server → read config → SXF-1 → cache miss → GET /v1/verdict
3. api → Arkiv verdictHead(fp) filtered by worker address → state=flagged, severity=4
4. Gate denies: finding + capability surface + provenance + override
                                                          → BLOCKED, "unconfirmed"
5. Agent (AgentBook-registered) POSTs a dispute with counter-evidence
6. api → lookupHuman(agentAddress) → non-null → accept   ← the AgentKit gate
7. worker writes Dispute(open) as a certified blob, rewrites head.state=disputed
8. Same call retried → still BLOCKED, now showing accusation AND rebuttal side by side
9. Human reviewer overturns → new ReviewRecord supersedes → head.state=clean
10. Same call retried → silent allow                       → CALL PROCEEDS
```

**The demo arc is accusation → rebuttal → resolution**, and each step is a visible state change driven by a real mechanism. Step 6 is the AgentKit gate: without a non-null `lookupHuman`, the dispute never enters the queue and steps 7–10 don't happen.

Note step 8 deliberately does *not* unblock. Showing that a dispute changes what the user sees without switching off protection is a better answer to a security-literate judge than a dramatic block→allow flip would be — it demonstrates the system takes its own accusations seriously even while they're contested. The payoff comes at step 9, where a human, not an identity check, is what actually clears the server.

---

## 12. Build split (4–5 people, 36 h)

| Owner | Scope |
|---|---|
| Client | `surex-gate`: hook I/O, `SXF-1`, cache, prefetch, override, three decision paths, **npm integrity comparison (Tier A)** |
| Data | Arkiv schemas, queries, `.createdBy` filtering, licence-gated seed importer, `surex-api` |
| Storage + chain | Walrus SDK path, blob mode, Sui digests recorded, faucets/WAL, explorer links |
| Review | DGX endpoint, prompt hardening, double-run agreement, output validation, **capability-surface static scan**, **the malicious fixture** |
| Web + identity | Submit UI (World ID **+ repo-ownership proof**), dispute UI (World ID + AgentKit), AgentBook registration **on day one** |

**The fixture is a build deliverable, not a prop.** A deliberately malicious MCP server, written by us, whose stated tool descriptions disagree with its code, whose capability surface shows filesystem and network reach, and whose source contains a planted prompt-injection attempt at the Reviewer. It is the only thing publicly flagged at the demo (PRD §8). If the injection defence holds, catching it on stage is the strongest single moment in the run.

**Day-one blockers, in order:** AgentBook mainnet registration (needs a phone, no testnet). Sui + WAL faucet funding (testnet has been wiped before). DGX endpoint reachable and answering an OpenAI-compatible request.

---

## 13. Open technical questions

1. ~~**Blob-ID reproducibility is still unsolved**~~ — **RESOLVED 2026-07-25.** A blob ID genuinely cannot be computed with a standard hash function, which was correct; the wrong conclusion was that this put local verification out of reach. The Walrus encoder is WASM and is **376 KB**, so it is vendored into the plugin (`packages/plugin/lib/vendor/walrus-wasm/`, `@mysten/walrus-wasm@0.3.0`, Apache-2.0) and the gate recomputes the blob ID itself. Verified against a real certified blob: `BlobEncoder(1000).compute_metadata()` reproduces `-SzjTmxUSjs01bmC2AZ48iqz-fTCcllwcLu3nc2rb2Y` exactly, and a single flipped bit does not. Pinned in `packages/core/test/blobid.test.mjs`.

   This matters more than a checkbox. Without it, the gate could only assert that a content-addressed store returned what it asked for — which is trusting the aggregator, and is not a check. **Arkiv decides on the hot path; Walrus proves, and the proof is now actually performed.** The `blob-id` check reports `passed` when the encoder ran and `asserted` when it could not be loaded, and no surface is permitted to render the second as the first.

   Still worth settling for the source archive itself: tarballs aren't deterministic (gzip mtimes, OS byte, file ordering), so normalise the uploaded tree (sorted paths, zeroed mtimes) and record a `normalisedTreeSha256` so re-uploads are comparable. Tier A continues to run off npm `dist.integrity`, which is a separate mechanism for a separate question.
2. **Non-npm Tier A.** `uvx`/PyPI has hashes in lockfiles; `docker` has image digests. Both are plausible Tier A sources and neither is specced. Currently Tier B.
3. **Response signing for `/v1/verdict`** — accepted as out of scope (PRD §11.10), so the Gate trusts an unsigned HTTP response to make a security decision. This is the largest knowingly-open gap; if there is spare time, it is the highest-value thing to close.
4. **Walrus storage renewal:** who pays, and what does the UI say when a blob's bytes have lapsed but the Arkiv record remains? Arkiv expiry and Walrus epochs are independent clocks (§4.4).
5. **Licence misdetection is not reversible.** The licence gate keeps unlicensed source out of Walrus, but a false positive writes someone's code to storage with no delete. Unmatched licences are treated as ineligible for that reason; a review queue for unmatched custom licences is unbuilt.
6. **Remote schema-drift polling cadence and cost.** Every registered remote endpoint needs a periodic `tools/list`. Frequency, backoff, and what happens when an endpoint requires auth are all unspecced.
