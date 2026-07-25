# SureX — What Could Break This

> Version 1, 2026-07-24. Companion to [`surex-prd.md`](./surex-prd.md), [`surex-tech-spec.md`](./surex-tech-spec.md), [`surex-track-fit.md`](./surex-track-fit.md).
>
> This is not a rehash of PRD §11. That section covers risks *inherent to the trust model* and their dispositions. This one covers **failures of execution and of the thesis** — things that would make the build fail, the demo fail, or the product be worth less than it looks, none of which are captured as product risks.
>
> Sorted by what actually kills you, not by severity in the abstract.

---

## 1. Verify in the first hour

Two assumptions are load-bearing, cheap to test, and currently untested. Both are in the spec as if settled. They are not.

### 1.1 Tier A probably doesn't work for `npx` — and `npx` is how most MCP servers are installed

The spec has the Gate reading the installed package's integrity from `node_modules/<pkg>/package.json` (`_integrity`) or a lockfile (tech spec §2.5). That is where it lives for a normal project install.

But `npx -y pkg` doesn't create a local `node_modules` at all — it resolves into a cache directory (`~/.npm/_npx/<hash>/`), and pnpm, yarn and bun each lay things out differently again. The single most common MCP install pattern may therefore have **nowhere for the Gate to read an integrity digest from**.

This matters more than it sounds. The npm integrity pin is what moved Tier A from "schema field" to "real," and Tier A is the answer to risk #1 (config identity ≠ code identity) — the product's deepest structural weakness. If it silently degrades to Tier B for every `npx` server, you've answered that risk on paper only.

**Test:** install a real MCP server the way a user would (`npx -y @modelcontextprotocol/server-github`), then try to locate a verifiable integrity digest for it on disk. If there isn't one, the fallback options are hashing the resolved cache directory's contents, reading npm's `_cacache` index, or accepting Tier B for npx and saying so plainly.

*Owner: Client. Cost to test: ~15 minutes. Cost of finding out late: the Tier A demo beat and the strongest answer to judge question #1.*

### 1.2 The whole block UX assumes a long multi-line string renders readably

Everything in the "block, but surface all data and let them proceed at their own risk" design (PRD §6, tech spec §3.3) lives inside a single `permissionDecisionReason` string — finding, capability surface, provenance, dispute link, override command, roughly a dozen lines.

If Claude Code truncates that field, collapses the newlines, or surfaces only the first line to the user, the evidence-display design fails at the display layer — and you find out in front of judges.

**Test:** a ten-line dummy hook that denies one tool call with a long multi-line reason. Look at what the user actually sees versus what the model receives.

If it truncates, the fallback is a short reason line plus a `systemMessage` carrying the detail, or a one-line summary pointing at a `surex why <fp>` command that prints the full evidence in the terminal.

*Owner: Client. Cost to test: ~10 minutes.*

---

## 2. What breaks the demo

### 2.1 The DGX produces mush

"An open-source model reads a repository and finds the bad thing" is considerably harder than it sounds. Realistic failure modes: findings too vague to show, hallucinated file and line references, no clear verdict, or context limits that mean the model never sees the malicious file.

The demo rests on **one** good review.

**Mitigations:** validate real review output by hour 6, not hour 30. Design the fixture so the finding is unmissable. If the model can't handle a tree, shrink the task — review the tool descriptions plus one named file rather than a whole repository. A smaller task done crisply demos better than a broad one done vaguely.

### 2.2 AgentBook registration fails, and the World track has no fallback

Mainnet-only, phone-gated, no testnet, one shot (tech spec §7.2). If it doesn't work, you don't have a weaker World submission — you have no qualifying World submission at all, and the $8,000 track is gone.

**Mitigations:** do it first, with a named owner, on day one. Know the Plan B before you need it: Selfie Check ($1,750) is the only realistic fallback and it requires its own written developer-and-user feedback document, which is work you'd be starting late.

### 2.3 Five components, one chain, five people

The demo path (tech spec §11) requires the Gate, the API, Arkiv, Walrus, the Reviewer and the identity layer all working together — and nothing proves the chain until late, which is the classic way hackathon teams lose Sunday morning.

**Mitigation:** freeze the `/v1` API contract in hour one and have everyone mock the other side. Each person should be able to demo their own piece standalone by hour 12. An integration that first runs at hour 30 is an integration that doesn't run.

### 2.4 Testnet arithmetic

Seeding is ~300 Walrus blobs and ~600 Sui transactions (tech spec §4.5), against a rate-limited faucet, a 1-day testnet epoch, and a testnet that has been wiped before. A seed job that stalls at server 40 is a demo with an empty registry.

**Mitigation:** fund on day one, batch, and cut the seed target to 50 without hesitation if it's slow. Nobody judges the difference between 50 and 100 seeded entries.

---

## 3. What breaks the product

### 3.1 The fingerprint matches nothing, and you can't tell

This is the quietest and most dangerous failure in the design.

Two developers running the same MCP server with a slightly different config — an extra flag, a different arg order, an absolute path, a version pinned in one place and floating in another — produce different `SXF-1` hashes. Every miss reads as `unknown`, and `unknown` merely warns.

So the Gate can look like it's working perfectly while recognising almost nothing. No error, no alarm, just a permanent stream of soft warnings that users learn to ignore.

**The gap:** PRD §12 measures time-to-block, override rate, re-submission and dispute latency. It has **no metric for registry hit rate** — what fraction of encountered fingerprints resolved to a known entry. That should be the first number on the dashboard, and it isn't currently anywhere.

**Mitigation:** measure hit rate from day one. If it's low, the fix is canonicalisation breadth (more aggressive normalisation, alias groups mapping several fingerprints to one entry), not more seeding.

### 3.2 Maintainer-gating throttles your own supply

Requiring repo-ownership proof (FR-15) closed the block-as-DoS vector at the root. It was the right call. The cost is that the registry now only grows through the crawler plus volunteers.

If no maintainer ever submits, SureX is a crawler-populated directory with automated scanning attached — which is roughly Smithery plus mcp-scan, both of which already exist (PRD §4 prior art). The human side of the loop is what makes it new, and nothing guarantees it starts.

**Watch:** maintainer submissions in the first month. If it's zero, the product is not what the docs say it is.

### 3.3 Anthropic ships it

The official MCP Registry is Anthropic-backed and adding attestation or signing to it is an obvious next move. Native MCP permissioning in Claude Code is equally obvious. Either would make SureX a feature rather than a product.

**Honest read:** this is a real strategic risk and not one a hackathon build can design around. The defensible position is the parts a first-party registry is *least* likely to build: the dispute process, the independence from any single vendor, and the cross-client proxy architecture (tech spec §6 portability).

### 3.4 Nobody pays for the GPU

23,000+ servers, re-reviewed on every release, with review cost scaling linearly against an ecosystem growing ~1,000 servers a month. There is no business model anywhere in these documents.

That's acceptable for a hackathon and not acceptable a month later. Worth having a one-line answer ready, because a judge with an investor hat will ask.

---

## 4. What breaks adoption

### 4.1 Latency, now unconstrained

The performance requirements were removed from PRD §9 by choice. That removed the *commitment*, not the risk. Nothing in the requirements now stops the Gate from adding perceptible delay to every MCP tool call.

The tech spec still carries a latency budget and cache design (§3.4) as engineering guidance. Treat it as binding in practice even though it isn't binding on paper, because this failure mode leads directly to the one below.

### 4.2 The only metric that really matters

**Developers turning the Gate off.** Every other failure in this document is survivable. This one isn't, and it's the endpoint of most of them: too many false blocks, too much latency, too many meaningless `unknown` warnings, one bad experience with a wrong flag on a package someone trusts.

The Gate's authority is entirely borrowed from being right and being quiet. It has no way to earn it back.

---

## 5. Hour-one checklist

| # | Check | Owner | Blocks |
|---|---|---|---|
| 1 | AgentBook registration completes on a real phone | Web + identity | Entire World track |
| 2 | Long multi-line `permissionDecisionReason` renders to the user (§1.2) | Client | Block UX |
| 3 | An `npx`-installed MCP server yields a readable integrity digest (§1.1) | Client | Tier A |
| 4 | DGX answers an OpenAI-compatible request and returns usable findings on one real file | Review | Every verdict |
| 5 | Sui + WAL funded; one blob written, certified, and visible on a testnet explorer | Storage | Sui track |
| 6 | One Arkiv entity written and read back on Braga, filtered by `.createdBy` | Data | Registry |
| 7 | `/v1` contract frozen and mocked on both sides | All | Integration |

Anything unchecked by hour three is a scope cut, not a to-do.
