# SureX — PRD

> Product requirements. Version 1, 2026-07-24. Built at ETHGlobal Lisbon 2026.
> Companion docs: [`surex-tech-spec.md`](./surex-tech-spec.md) (how it's built), [`surex-track-fit.md`](./surex-track-fit.md) (Sui + World qualification), [`surex-failure-modes.md`](./surex-failure-modes.md) (what could break it, and the hour-one checklist).

---

## 1. Summary

SureX is a trust registry for MCP servers, plus a gate that reads it.

Today, adding an MCP server to a coding agent is a leap of faith. The server runs with the agent's permissions, sees your files and secrets, and nothing checks it. SureX puts a check in the path: before your agent calls any MCP tool, a hook looks the server up and tells you what's known about it. If the registry says the code was reviewed and matched its stated purpose, nothing happens — you never notice. If it was flagged, the call is blocked and you see why. If it's unknown, you get a warning and decide.

The other half is how entries get there. Maintainers submit servers (gated by World ID). An open-source model on an on-site DGX reads the submitted source against what the server *claims* to do and produces a verdict.

Every record the registry holds — the entry, each source snapshot, each review, each dispute — is written as a Walrus blob, so its blob ID is derived deterministically from its exact bytes: same content, same ID. The code and the judgement about the code are separate records, each independently verifiable. Arkiv holds the queryable entity that points at that blob and carries the fields you can search and filter on. So the registry is queryable through Arkiv and content-anchored through Walrus, and neither SureX nor anyone else can quietly rewrite what a verdict said. Anyone — a human via World ID, an autonomous agent via World AgentKit — can contest a verdict with evidence.

**The bet:** the scanning isn't the hard part; several tools already do intent-vs-description analysis. What doesn't exist is a registry that is continuously re-reviewed, enforced at the moment of the call, hard for its own operator to edit, and open to dispute. That combination is the product.

---

## 2. Context and background

MCP (Model Context Protocol) is how coding agents get tools. A server is a package you point your agent at — `npx -y @some/mcp-server` in a config file — and from then on the agent can call it. There is no permission model between "listed in config" and "reading your SSH keys."

The ecosystem is now large enough that this matters. The official MCP Registry counted roughly 9,650 servers (~29,000 server+version records) as of a May 2026 API pull; community directories list 21,000–23,000+; PulseMCP has been adding around 1,000 new indexed servers a month through Q1–Q2 2026. ([registry](https://github.com/modelcontextprotocol/registry), [PulseMCP](https://www.pulsemcp.com/servers), [tracker](https://www.digitalapplied.com/blog/mcp-server-ecosystem-tracker-50-servers-cataloged-2026))

---

## 3. Problem, and why now

### What actually goes wrong

**Tool poisoning.** A server can hide instructions inside a tool's *description* — text the model reads and the user never scrutinises — to exfiltrate files while returning a normal-looking result. Disclosed by Invariant Labs in 2025, now a catalogued class with CVEs attached (CVE-2025-54136 "MCPoison", CVE-2025-54135 "CurXecute"). ([Invariant Labs](https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks), [OWASP MCP03:2025](https://owasp.org/www-community/attacks/MCP_Tool_Poisoning))

**Rug-pull updates.** Clients don't pin versions or hash tool schemas, so a clean server can ship a poisoned update and the host reloads it silently. In September 2025, the npm package `postmark-mcp` behaved exactly like the legitimate Postmark server for 15 versions, then v1.0.16 added a line that BCC'd every outgoing email to an attacker. It ran for weeks and 1,643 downloads. ([The Hacker News](https://thehackernews.com/2025/09/first-malicious-mcp-server-found.html), [Snyk](https://snyk.io/blog/malicious-mcp-server-on-npm-postmark-mcp-harvests-emails/))

**Exposure at scale.** January 2026: 42,000+ Clawdbot/Moltbot instances found on the public internet, 1,000+ running unauthenticated MCP endpoints leaking API keys, OAuth tokens and conversation history. ([VentureBeat](https://venturebeat.com/security/mcp-shipped-without-authentication-clawdbot-shows-why-thats-a-problem))

**Models comply.** The MCPTox benchmark measured a 72.8% tool-poisoning success rate against o1-mini across 45 real MCP servers. ([arXiv:2508.14925](https://arxiv.org/pdf/2508.14925))

### Why now

1. **A seed source exists.** The official MCP Registry launched in preview on 8 September 2025, explicitly as "a primary source of truth that sub-registries can build upon." That's what SureX crawls. ([MCP blog](https://blog.modelcontextprotocol.io/posts/2025-09-08-mcp-registry-preview/))
2. **An enforcement point exists.** Claude Code's `PreToolUse` hook fires before every MCP tool call and can block it. Without a native interception point there is no product. ([Claude Code docs](https://code.claude.com/docs/en/hooks))
3. **The attack curve is short and steep** — disclosure (2025) → CVEs → a live incident → mass exposure (Jan 2026), inside about a year.
4. **Agent identity shipped.** World AgentKit launched March 2026, letting an agent carry proof that a unique human stands behind it. That is what makes "an autonomous agent contests a verdict" a real feature rather than a slide. ([World](https://world.org/blog/announcements/now-available-agentkit-proof-of-human-for-the-agentic-web))

---

## 4. Users and jobs

| User | Job to be done | What they do today | What flips them |
|---|---|---|---|
| **Developer running an agent** *(the wedge)* | Add an MCP server without getting owned by it. | Reads the README, hopes. Every install is a coin flip. | A gate that is silent on known-good, costs no perceptible latency, and blocks known-bad with evidence. |
| **MCP maintainer** | Prove my server does what it says so people install it. | Nothing formal. Reputation is GitHub stars and directory placement. | A mark that moves install numbers, plus a real appeals path if flagged wrongly. |
| **Registry operator** (SureX, or an org running it internally) | Keep a trust list current without hiring reviewers linearly. | The role doesn't exist. Directories list; they don't vet. | Automated re-review on every release. |
| **Platform/security team** | Enforce an MCP allowlist across the org's agents. | A wiki page, if anything. | A programmatic feed to pull into their own gateway. |

The developer feels the pain first, on every install, before anyone else has a reason to care. Build for them.

---

## 5. Solution overview

Five components, two loops.

```
CONSUMER LOOP (fast, on every tool call)
  agent → Gate (hook) → fingerprint → Registry lookup → allow | warn | block

SUPPLY LOOP (slow, on submission and on every release)
  maintainer ──World ID──┐
  seed crawler ──────────┼→ Ingest → Walrus (source) → Reviewer (DGX) → verdict → Arkiv
  GitHub listener ───────┘                                                       │
                                                    Dispute ←──World ID/AgentKit──┘
```

| Component | What it does |
|---|---|
| **Gate** | The client-side hook. Fingerprints the MCP server from its install config, reads the Registry, decides allow / warn / block. Ships as a Claude Code hook; designed to be portable. |
| **Registry** | Every record — entry, source snapshot, review, dispute — is a Walrus blob with a certified Sui object. Arkiv holds the queryable entity pointing at it, carrying the searchable fields. Source and review are separate records: one snapshot of code can carry several reviews over time. |
| **Reviewer** | Open-source model on an on-site NVIDIA DGX. Reads source against stated intent, emits a structured verdict with findings. |
| **Ingest** | Seeds from public MCP directories; a GitHub listener re-runs the pipeline on each new release. |
| **Dispute** | Contest a verdict with evidence. World ID for humans, AgentKit for agents. Moves the case to human review and marks it publicly disputed. |

### How the two halves of the Registry divide the work

Arkiv answers *"what is the state of this server?"* Walrus answers *"show me exactly what was said, and prove it hasn't changed."*

That division is a hard rule, not a preference, because the Gate sits in front of every tool call. The decision-critical fields — state, severity, tier, whether it's disputed — are Arkiv annotations, so the Gate resolves allow/warn/block from a single query. The evidence body — findings, file and line, the model and prompt that produced them — lives in the Walrus blob, and is fetched only when SureX is about to block and a human is about to read it. Evidence is never on the hot path.

The cost of storing every record this way is a Walrus write per record: two Sui transactions and WAL each time. That is a deliberate trade — it makes the registry's own contents as content-anchored as the source code it reviews — but it makes bulk seeding a funding and batching exercise (§10).

### Why the identity of code and the identity of config are different things

This is the single most important design point in the product, and the place it is most easily oversold.

The Registry is **keyed** by an install-config fingerprint — the canonicalised runner, package spec and version from the user's MCP config. That is the only identity the Gate can compute cheaply, before the server ever runs.

The verdict, however, is **anchored** to a Walrus blob ID, which is a content-addressed hash of the exact source reviewed. Identical source deduplicates to the same blob ID; a single changed byte produces a different one.

So SureX can always say precisely *what it reviewed*. What it cannot always say is *that the reviewed thing is what you're about to run*. That gap is real, and the product's job is to show it honestly rather than paper over it. Hence verdict tiers.

---

## 6. The verdict model

### Tiers — how strong is the link between the review and your machine

| Tier | Condition | What the user is told |
|---|---|---|
| **A** | Pinned version, and the locally installed package's integrity digest matches the one recorded for the version we reviewed. | "Reviewed code matches what you're about to run." |
| **B** | Pinned version, no local integrity check available. | "This version was reviewed." |
| **C** | Unpinned (`@latest`, no version, a git branch) or a remote HTTP/SSE endpoint. | "Cannot confirm what will run." |

Tier A is reachable for npm-packaged servers, which are most of them: npm publishes a `dist.integrity` (sha512) per version, SureX records it at review time, and the Gate compares it against the installed copy. That closes risk #1 for the common case — a republished tarball under the same version no longer matches, so the Gate drops to a warning instead of showing a stale clean verdict.

Tier C never renders like Tier A. A remote endpoint has no local code at all — a clean verdict there is a statement about an endpoint's history, never about its current backend.

### States — what the review found

| State | Meaning | Gate action |
|---|---|---|
| `clean` | Reviewed; no intent/code mismatch found, at the commit and time stated. | Allow, silent. |
| `flagged` | Reviewed; mismatch or malicious pattern found. | Block, overridable. |
| `disputed` | Flagged, but under contest and awaiting human review. | Block, overridable — with both sides shown. |
| `unreviewable` | Source unavailable or not redistributable — remote-only, closed source, or no licence permitting us to store it. Carries a `reason`. | Warn. |
| `stale` | Entry exists; a newer release landed than the one reviewed, or the installed integrity digest no longer matches. | Warn. |
| `unknown` | Not in the registry. | Warn. |

**Blocking rule (FR-5):** any `flagged` or `disputed` entry at severity ≥ high blocks the call. Protection is never delayed and never softened — what varies is *how the block reads* and how confident it claims to be.

Every block is overridable by the user, in one command, from the message itself. That is deliberate: a block that can't be overridden gets the whole Gate uninstalled the first time it's wrong.

### How a block reads — three tones, one behaviour

| Situation | Tone | What the user is told |
|---|---|---|
| **Unconfirmed** — automated flag, maintainer notified, inside the 72-hour window | Softened | "Flagged by automated review. Not confirmed by a human. The maintainer has been notified and may respond." |
| **Confirmed** — window elapsed with no dispute, or a human reviewer upheld it | Firm | "Flagged. Automated review, uncontested since \<date\>." |
| **Disputed** — the maintainer or an agent has contested with evidence | Balanced | "Flagged, and contested. Here is the finding, and here is the rebuttal. A human review is pending." |

All three block. All three show the complete evidence: the finding with file and line, the capability surface, the commit and blob ID reviewed, the review date, the model and prompt version, and the fact that no human audited it. All three end with the override and an explicit statement that proceeding is the user's own risk.

The maintainer-notice window (FR-21) therefore costs a maintainer nothing in protection and buys them what they actually need — the chance to see an accusation and answer it before it hardens into a confirmed one.

### Wording rules — binding on all UI and API text

- Never "safe", "trusted", "verified", "secure". Say **"reviewed"**.
- Every verdict shows: what was reviewed (commit + blob ID), when, by what (model + prompt version), and that it was automated and not human-audited.
- Corrections are as prominent and as durable as the original claim. Verdicts are superseded, never deleted.

`clean` means exactly: *this submitted version, read statically, showed no model-detectable mismatch between its stated purpose and its code, at that time.* It does not mean safe to run, does not cover dependencies, and does not mean the installed copy is the same copy.

### Capability surface — shown on every verdict, clean or flagged

Intent-matching only checks whether code and description agree. A server that says "runs a command as requested" and then runs commands agrees with itself perfectly. So every verdict also carries a plainly-worded list of what the code can actually reach — network, filesystem, process execution, environment variables, credentials — found by static scan, independent of what the server claims.

This is often more useful than the verdict itself. "Reviewed, no mismatch found — and it can read your filesystem and make outbound network calls" tells a developer something true and actionable that no clean/flagged bit can.

---

## 7. Workflow notes

**Developer, the 99% case.** Nothing. The Gate resolves from a local cache in single-digit milliseconds and the tool call proceeds. If a developer notices SureX during normal work, it has failed.

**Developer, blocked.** The call stops. They see everything at once: the tool and server, the finding with file and line, the capability surface, what commit and blob were reviewed and when, that the review was automated and not human-audited, whether it's contested and by whom, and links to the Walrus blob and the dispute page.

Then the last line: proceeding is their call and their risk, and here is the command. `surex allow <fingerprint>` writes to a local override file and the retry goes through — no editing hook config mid-session, no waiting on anyone. A false positive costs seconds, not days.

We block rather than warn because a warning inside an agent loop is noise the model routes around and the user never registers. A block forces one conscious decision by a person who has been shown the evidence. That is the entire mechanism — SureX's job is to make sure nobody runs a flagged server *without knowing*, not to take the decision away from them.

**Maintainer, submitting.** Two proofs, because they answer different questions. World ID (`action: maintainer-submit`) proves *a unique human*. Repo-ownership proof — a GitHub OAuth check, or a SureX token committed to the repo — proves *this human controls this code*. Then paste a repo URL and pick a release: source lands on Walrus, the Reviewer runs, a verdict appears.

Only maintainers can submit. Nobody can submit somebody else's server, which removes the block-as-DoS vector entirely. The one exception is SureX's own seed crawler (§8), whose entries are marked as such and start at `unknown`, never `clean`.

On a flag, the maintainer is notified with the finding and a dispute link, and the flag does not escalate to blocking for **72 hours**. That window is the difference between a review service and an ambush.

**Anyone, disputing.** Submit counter-evidence against a specific verdict. Humans prove personhood with World ID (`action: contest-verdict`); autonomous agents present an AgentKit header and the backend confirms via AgentBook that a unique human stands behind the wallet. Either way the case is marked `disputed` — publicly, next to the original flag — and queued for human review. Identity here proves *standing to dispute*, not correctness.

---

## 8. Scope

**SureX covers open-source MCP servers only.** That is a product boundary, not a temporary limitation. We store and review source code; a licence that permits us to redistribute it is a precondition. A server with no licence, or a licence that doesn't allow redistribution, is `unreviewable` with `reason: licence` — stated, never silently omitted, and never read as clean-by-absence.

**In scope.** Consumer Gate for MCP tool calls; config-fingerprint registry keyed to content-anchored verdicts; Walrus record storage; DGX intent-vs-code review; capability-surface scan; npm integrity pinning for Tier A; remote endpoint schema monitoring; Arkiv index; licence-gated seed ingest; GitHub release listener; maintainer-gated submission; dispute flow with human and agent identity; local override.

**Out of scope.** Closed-source and proprietary MCP servers. Runtime/dynamic analysis. Dependency-tree (SCA) scanning. Response-side inspection. Blocking non-MCP tool calls. Any paid tier, staking or token. Acting as a package manager or installer. Signed verdict responses — accepted as an unmitigated gap (§11.10).

**Hackathon slice (36 hours), in priority order:**

1. Gate blocking a flagged server in Claude Code, with evidence and capability surface shown to the user.
2. Registry seeded with 50–100 real open-source servers from the official Registry/PulseMCP, queried live from Arkiv.
3. One full submission: World ID + repo-ownership gate → Walrus upload → one real DGX review → verdict in Arkiv.
4. One dispute end to end: agent contests via AgentKit, verdict flips to `disputed`, Gate stops blocking and warns instead.
5. Tier A demonstrated on one npm server: integrity digest matches, then doesn't, and the Gate visibly downgrades.

**The flagged subject is a purpose-built fixture** — a deliberately malicious MCP server we write ourselves, ideally one whose source also carries a prompt-injection attempt at the Reviewer, so the demo can show that being caught. No real named third-party project is publicly accused on the strength of an unaudited model verdict.

Cut for the weekend, stated not built: the GitHub polling listener (manual trigger in the demo), remote schema monitoring beyond a single manual run, agent runtimes beyond Claude Code, storage renewal cron, signed responses.

---

## 9. Requirements

### Functional

| ID | Requirement |
|---|---|
| FR-1 | The Gate intercepts every MCP tool call before execution and resolves a decision. |
| FR-2 | The Gate derives a deterministic fingerprint (`SXF-1`) from install config alone, without executing or contacting the server. |
| FR-3 | Blocked calls surface the finding, the reviewed commit and blob ID, the review date, and the dispute link — to the **user**, not only the model. |
| FR-4 | Unknown, stale and unreviewable servers warn and proceed. |
| FR-5 | `flagged` and `disputed` entries at severity ≥ high block the call. Every block is overridable by the user and states plainly that proceeding is at their own risk. |
| FR-6 | A local override file lets a user unblock a fingerprint in one command, surfaced in the block message itself, without editing hook configuration. |
| FR-7 | Maintainer submission requires a valid World ID proof, one per human per action (nullifier-enforced). |
| FR-8 | Submitted source is written to Walrus as an owned, permanent blob; the blob ID is recorded as the reviewed artifact. |
| FR-9 | The Reviewer emits a structured verdict: state, severity, findings with file/line, model version, prompt version. |
| FR-10 | Source snapshots and reviews are distinct, immutable, append-only records. A review references the source it judged; a mutable head pointer carries current state. History is never overwritten. |
| FR-11 | The GitHub listener detects a new release, re-runs upload + review, and writes a new verdict. |
| FR-12 | Between a new release and its review completing, the entry reads `stale`. |
| FR-13 | Disputes are accepted from World ID-verified humans and AgentBook-registered agents, require evidence, and set the verdict to `disputed`. |
| FR-14 | Every record is publicly queryable by third parties, not only by SureX. |
| FR-15 | Submission requires both a World ID proof and proof the submitter controls the repo. The seed crawler is the only exception, and its entries are marked as crawler-sourced. |
| FR-16 | Source is stored only under a licence permitting redistribution. Otherwise the entry is `unreviewable` with `reason: licence`. |
| FR-17 | Every verdict carries a capability surface — network, filesystem, process execution, environment and credential access — derived by static scan, independent of stated intent. |
| FR-18 | For npm-packaged servers, the reviewed version's `dist.integrity` is recorded, and the Gate compares it against the installed package to award Tier A. |
| FR-19 | A mismatch between the installed integrity digest and the reviewed one downgrades the entry to `stale`. It never blocks on that basis alone. |
| FR-20 | Remote endpoints are polled periodically; the hash of their advertised tool names and descriptions is recorded, and drift raises a finding. |
| FR-21 | A flag is labelled *unconfirmed* until the maintainer has been notified and 72 hours have passed without dispute. This changes the wording and claimed confidence of the block, never whether it blocks. |
| FR-22 | Text inside reviewed source that attempts to instruct the Reviewer is itself recorded as a high-severity finding. |

### Non-functional

| ID | Requirement |
|---|---|
| NFR-1 | Registry unreachable ⇒ **fail open** with a visible degradation notice. A cached `flagged` verdict still blocks. |
| NFR-2 | No secret ever enters a fingerprint. `env` values and absolute paths are excluded before hashing. |
| NFR-3 | Review prompts isolate untrusted source and are re-run with a paraphrased prompt; disagreement between runs downgrades confidence rather than flagging. |
| NFR-4 | Stored maintainer identity is limited to the World ID nullifier. No names, no emails. |
| NFR-5 | The Gate is auditable and installable from source. It runs on every tool call on a developer machine; it must be as inspectable as what it polices. |

---

## 10. Dependencies

| Dependency | Used for | Risk |
|---|---|---|
| Claude Code `PreToolUse` hooks | Enforcement point | Matcher must be `mcp__.*`; plugin servers use a compound tool-name shape. |
| Walrus (Sui) | Source storage, content-addressed blob IDs | Testnet epoch = 1 day; testnet has been redeployed before. Buy max epochs, re-fund day one. |
| Arkiv (Braga) | Queryable index, append-only verdict history | Entities always expire — renewal is a design requirement, not an afterthought. |
| World ID / IDKit | Human gating | Has a real staging environment + simulator. Low risk. |
| World AgentKit / AgentBook | Agent gating | **No testnet.** Registration is mainnet-only and needs a real World App on a phone. Do it on day one. |
| On-site DGX | Review | Single physical dependency. Reviewer must speak an OpenAI-compatible API so the endpoint is swappable if the box dies. |

---

## 11. Risks — decided

Each risk carries a disposition: **Mitigated** (a mechanism handles it), **Reduced** (partially handled, residue stated), or **Accepted** (structural, we say so and don't pretend otherwise).

| # | Risk | Disposition | Mechanism, and what's left |
|---|---|---|---|
| 1 | **Config identity ≠ code identity.** `pkg@latest` fingerprints identically before and after a malicious republish; a pinned version can have its artifact swapped. | **Reduced** | npm `dist.integrity` recorded at review, compared against the installed copy → Tier A (FR-18). A swapped artifact no longer matches and drops to `stale` (FR-19). **Residue:** non-npm runners (uvx, docker, git installs) stay Tier B, and unpinned stays Tier C. |
| 2 | **Remote servers are not reviewable.** No local code; the backend can change silently or behave well only for reviewers. | **Reduced** | Permanent Tier C, plus periodic polling of advertised tool names and descriptions with drift raised as a finding (FR-20) — which catches the tool-description rug-pull specifically. **Residue:** backend behaviour is still unobservable. Not solved, by construction. |
| 3 | **Prompt injection against the Reviewer.** Source is untrusted input read by the model judging it; a forced "clean" launders code *with the appearance of scrutiny*. | **Reduced** | Content isolation, explicit instruction-ignoring, paraphrase double-run with disagreement capping severity (NFR-3). Injection attempts are themselves high-severity findings (FR-22). **Residue:** the same unsolved problem every LLM-as-judge system has. |
| 4 | **Intent-matching checks consistency, not safety.** A vague description makes almost any behaviour consistent. | **Mitigated** | Capability surface on every verdict (FR-17) reports what the code can actually reach, independent of what it claims. The consistency check stops being the only signal. |
| 5 | **False positives have a large blast radius.** An automated malice claim about a named project, replicated everywhere, stored somewhere hard to edit. | **Reduced** | Every block is overridable in one command from the message itself (FR-6), so a wrong block costs a user seconds. Unconfirmed flags say so in the block text (FR-21); disputes are shown alongside the accusation; corrections are superseded, never deleted. At the demo only a fixture is flagged (§8). **Residue:** a wrong flag still interrupts real work and still names a real project publicly. The override limits the damage; it doesn't undo it. |
| 6 | **Block-as-DoS against a competitor.** | **Mitigated** | Removed at the root: only a maintainer who proves repo control can submit (FR-15). You cannot submit somebody else's server, so you cannot get one flagged. |
| 7 | **Seeding inherits other people's backdoors** and lends them registry legitimacy. | **Mitigated** | Crawler entries are marked crawler-sourced and start at `unknown`, never `clean` (FR-15). |
| 8 | **Uploading other people's source without asking.** | **Mitigated** | SureX covers open-source servers only; source is stored only under a licence permitting redistribution, otherwise `unreviewable / reason: licence` (FR-16, §8). **Residue:** Walrus still has no admin delete, so a licence misdetection is not fully reversible — index delisting is the only lever. |
| 9 | **Personhood ≠ good faith.** A verified human can file a fabricated dispute; identities can be rented. | **Accepted** | A dispute only queues a case; it never auto-overturns. Rate-limited per nullifier. The remaining gap is human judgment, and no cryptography fixes it. |
| 10 | **The Gate is new attack surface.** It runs on every tool call and acts on unsigned remote responses. | **Accepted** | Signed verdict responses are explicitly out of scope (§8). A network attacker who can MITM the Gate can influence agent control flow. This is the largest knowingly-unmitigated risk in the build, and it should be stated, not discovered. |

**Previously open, now decided.** Submission is maintainer-gated with the crawler as the sole exception (#6). Source upload is licence-gated and the product is open-source-only (#8). Demo flags use a fixture, so no legal review of a named accusation is needed for this build — that review becomes a precondition the first time SureX flags a real project publicly.

**Still open.** There is no human-review SLA, and we say so plainly rather than invent one a weekend build can't honour. Whoever operates SureX at scale has to answer it before flagging affects real projects.

---

## 12. Success metrics

Leading indicators:

- **Time-to-block** — from a malicious release landing to the Gate blocking it. Target hours. `postmark-mcp` ran for weeks.
- **Override rate** — share of blocks the user overrides after reading the evidence. This is your false-positive proxy, and it's directly measurable because overriding is an explicit command rather than a shrug. A high override rate means the Gate is crying wolf; sustained, it predicts uninstalls.
- **Maintainer re-submission-after-fix rate** — signals the appeal loop is usable rather than punitive.
- **Dispute resolution latency** — how long a project sits publicly flagged before a human looks.

**The metric that says it isn't working: developers turning the Gate off.** If friction outruns trust earned, SureX becomes a thing people disable. Watch that above everything else.
