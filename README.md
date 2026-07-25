# SureX

**A trust registry for MCP servers, and a gate that reads it.**

Adding an MCP server to a coding agent is a leap of faith. The server runs with your agent's permissions,
sees your files and your secrets, and nothing checks it. SureX puts a check in the path: before your agent
calls any MCP tool, a hook looks the server up and tells you what is known about it. Reviewed, with no
mismatch found? Nothing happens — you never notice. Flagged? The call stops and you are shown the finding,
the file, the line, and what the code can actually reach. Then you decide, and one command lets you
proceed anyway.

Built at [ETHGlobal Lisbon 2026](https://ethglobal.com/events/lisbon2026).

## Live

| | |
|---|---|
| **The registry** | **https://arkiv-surex.vercel.app** |
| **The API** | **https://arkiv-surex-api.vercel.app** — [`/v1/registry`](https://arkiv-surex-api.vercel.app/v1/registry) · [`/v1/stats`](https://arkiv-surex-api.vercel.app/v1/stats) · [`/v1/flagged`](https://arkiv-surex-api.vercel.app/v1/flagged) |

Both read **live Arkiv (Braga)**. The registry holds **51 entries** — 50 real servers crawled from the
official MCP registry, plus our own fixture, which is the **only** flagged entry and the only thing any model
has reviewed. The browse strip says `1 reviewed` because one is the true number.

> The explainer at `santiagodevrel.github.io/surex` predates this build and still says "design phase".
> It is superseded by the link above.

## Status

**The chain runs end to end.** One command proves it:

```bash
node demo/chain.mjs      # 13/13 — see demo/README.md
```

That drives a real headless Claude Code session with the gate installed as a plugin, has the model call a
tool on a deliberately malicious MCP server we wrote, and checks every link: the hook fires, the call is
denied, the evidence is fetched from Walrus, and **the blob ID is recomputed locally from the bytes that
came back** — not asserted. Then `surex allow` releases it.

**What is not real yet, stated plainly.** No model has reviewed a real third-party MCP server. Nothing in
this repository is a claim about anyone else's code. The verdict content in the demo is hand-written and
describes our own fixture; the *mechanism* is what is real. Arkiv is stood in for locally in that run.
[`demo/README.md`](./demo/README.md) draws the line explicitly, and
[`AGENTS.md` §2](./AGENTS.md) keeps the current state of every component.

| Built | |
|---|---|
| [`packages/core`](./packages/core) | `SXF-1` fingerprint, the frozen `/v1` contract, the verdict decision, the copy law as executable rules, blob verification |
| [`packages/plugin`](./packages/plugin) | the gate + the `surex` command. Zero dependencies, installable straight from this repo |
| [`packages/fixture-mcp`](./packages/fixture-mcp) | the malicious fixture — the only thing SureX ever flags. [Why it is safe to run](./packages/fixture-mcp/SAFETY.md) |
| [`contracts/`](./contracts) | the ENS offchain resolver — one wildcard resolver makes every entry readable as a name. Built and exercised; **not deployed** |
| [`probes/`](./probes) | the throwaway scripts that measured the enforcement surface, Walrus, Arkiv and ENS before any feature code was written |
| [`demo/`](./demo) | the end-to-end run |

| Reference | |
|---|---|
| [Explainer](./public/index.html) | how the whole system works, written for non-developers |
| [Prototype](./public/prototype.html) | the product screens — placeholder data, labelled on the page |
| [Architecture](./public/architecture.html) | the two loops, the state matrix, the tier matrix |
| [Tokens](./public/tokens.html) | the design token and component set |
| [`docs/`](./docs) | PRD, technical specification, track fit, failure modes, [ENS](./docs/surex-ens.md) |
| [`FRICTION-LOG.md`](./FRICTION-LOG.md) | verified problems found in sponsor SDKs while building — with repro commands |

## How it is meant to work

**The gate**, on every tool call, in milliseconds. A `PreToolUse` hook fires before Claude Code executes
any MCP tool. It identifies the server from its install configuration alone — never by running it — and
resolves one of three outcomes: allow silently, warn and proceed, or block with the evidence and an
override.

**The registry**, on submission and on every release, in minutes. Source is written to Walrus as a
content-addressed blob. An open-source model reads that source against what the server claims to do, while
a separate deterministic scan records what the code can actually reach. The verdict is written as its own
separate blob, so the code and the judgement about it can each be verified independently. Arkiv holds the
queryable entity pointing at both, and that entity is the only thing the gate reads on the hot path.

**The appeal.** Anyone can contest a verdict with evidence — a person proving personhood with World ID, or
an autonomous agent that depends on the server, proving a real human stands behind it with World AgentKit.
Contesting changes what the user is told; it does not stop the blocking. Only a human review clears it.

## What it does not claim

The word is **reviewed**, never *safe*, *trusted*, *verified* or *secure*.

`clean` means precisely: this submitted version, read statically, showed no model-detectable mismatch
between its stated purpose and its code, at that time. It does not mean the server is safe to run. It does
not cover dependencies. And it does not mean the copy installed on your machine is the copy that was
reviewed — that link is graded A, B or C on every verdict, and C means we cannot confirm what will run.

Reviews are automated. No human audits them. The appeal process exists because the model can be wrong.

## Stack

Claude Code `PreToolUse` hooks for enforcement · [Arkiv](https://arkiv.network) for the queryable index ·
[Walrus](https://docs.wal.app/) on [Sui](https://sui.io) for content-addressed records ·
[World ID and AgentKit](https://docs.world.org) for human and agent identity ·
[ENS](https://docs.ens.domains) wildcard resolution so a verdict is readable as a name — one line for
anything already holding an Ethereum client, and the only form of a verdict a contract can check
([`docs/surex-ens.md`](./docs/surex-ens.md)) · an open-source model on an NVIDIA DGX for the review.

## What we measured, and what it cost us to believe otherwise

Everything here was found by running something, not by reading a doc. Full write-ups with repro commands in
[`FRICTION-LOG.md`](./FRICTION-LOG.md).

- **A hook returning `permissionDecision: "allow"` GRANTS the call.** Our own spec had the *unknown* path
  emitting `allow`, which would have auto-approved exactly the servers SureX knows nothing about — strictly
  worse than not installing it. The warn path now emits a notice and no decision, leaving Claude Code's
  permission flow in charge.
- **A `PreToolUse` hook that exceeds its timeout fails open**, silently. The tool runs and nothing tells the
  user a check was skipped. That is the posture we want, but it also means a slow gate is a disabled gate.
- **The documented 10,000-character cap on hook output did not apply** — 12,054 characters arrived intact.
  The real limit is comprehension: at that size the model stopped reading it as a block and called it a tool
  error. Block messages are kept short by test.
- **Not one of the 15 MCP servers on a real developer's machine is version-pinned.** The convention is
  `npx -y pkg@latest`. So every one of them is Tier C, and Tier A — which is implemented, and is the answer
  to this project's deepest weakness — is close to unreachable in the ecosystem as it exists today. We grade
  it C and say so on the verdict rather than let it read as a pass.
- **An MCP server config is not portable across platforms.** Windows writes `cmd /c npx <pkg>`; macOS writes
  `npx <pkg>`. Read literally, a Windows user and a macOS user running the same server never match, and the
  Windows form loses the package name entirely.
- **Our own fingerprint is not a legal ENS label.** `sxf1_<64 hex>` fails ENSIP-15 normalisation —
  `underscore allowed only at start` — so the obvious `<fingerprint>.surex.eth` resolves nowhere. And the
  two major clients disagree about how long a label may be: ethers throws above 63 characters, viem accepts
  up to 255, so anything in between works for some callers and not others, with nothing raised either way.
  The name we publish is 45 characters for both reasons.
- **A Walrus blob ID is not `sha256(bytes)`.** Recomputing it needs the Walrus encoder, so we vendor it —
  otherwise the gate could only *assert* that a content-addressed store returned what it asked for, which is
  trusting the aggregator, and is not a check.
- **The testnet SUI faucet took 53 attempts**, with a `retry-after` that is fiction and no per-IP escape.

## What we cut

Named because a hackathon submission that lists only what it built is not telling you anything.

- **Move contracts, Seal, x402 payment flows** — deliberately deferred, not attempted. The sponsor SDK
  budget was 3 and we used all 3. ENS was on this list until we built it; it is not a security feature and
  the bullet below is unchanged by it.
- **Response signing for `/v1/verdict`.** The gate trusts an unsigned HTTP response to make a security
  decision. This is the largest knowingly-open gap in the design.
- **Walrus storage renewal.** Arkiv expiry and Walrus epochs are independent clocks and will drift apart. An
  Arkiv record can outlive the bytes it points at; the UI must distinguish *evidence expired* from *no
  evidence*, and the renewal job is unbuilt.
- **Tier A for `uvx`, `docker` and git installs.** npm `dist.integrity` is implemented; the others stay
  Tier B and are labelled as such rather than implied.
- **Dependency review.** A verdict covers a server's own source, not its dependency tree — which is the
  actual npm attack pattern. Stated in the product, not just in the docs.
- **A review queue for unmatched custom licences.** Unmatched is treated as ineligible, because guessing
  wrong writes someone's code to storage with no delete.

## Provenance

Started during ETHGlobal Lisbon 2026, from nothing — there is no prior codebase. The specifications in
`docs/` and the design in `design/` were both produced during the event with AI assistance, which the
event rules permit. Commit history is real and unsquashed.
