# SureX

**A trust registry for MCP servers, and a gate that reads it.**

Adding an MCP server to a coding agent is a leap of faith. The server runs with your agent's permissions,
sees your files and your secrets, and nothing checks it. SureX puts a check in the path: before your agent
calls any MCP tool, a hook looks the server up and tells you what is known about it. Reviewed, with no
mismatch found? Nothing happens — you never notice. Flagged? The call stops and you are shown the finding,
the file, the line, and what the code can actually reach. Then you decide, and one command lets you
proceed anyway.

Built at [ETHGlobal Lisbon 2026](https://ethglobal.com/events/lisbon2026).

## Status: design phase

**Nothing is running yet.** No reviews have been performed, no records have been written on-chain, and no
MCP server has been evaluated. This repository currently holds the product specification, the design
system, and a static explainer.

Everything numeric in the prototype is **illustrative placeholder content**, labelled as such on the page.
None of it describes a real registry.

| | |
|---|---|
| [Explainer](./public/index.html) | how the whole system works, written for non-developers |
| [Prototype](./public/prototype.html) | the six product screens — placeholder data |
| [Architecture](./public/architecture.html) | the two loops, the state matrix, the tier matrix |
| [Verdict system](./public/verdict-options.html) | eight explorations of how a verdict renders |
| [Tokens](./public/tokens.html) | the design token and component set |
| [`docs/`](./docs) | PRD, technical specification, track fit, failure modes |
| [`FRICTION-LOG.md`](./FRICTION-LOG.md) | verified problems found in sponsor SDKs while building |

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
[World ID and AgentKit](https://docs.world.org) for human and agent identity · an open-source model on an
NVIDIA DGX for the review.

## Provenance

Started during ETHGlobal Lisbon 2026, from nothing — there is no prior codebase. The specifications in
`docs/` and the design in `design/` were both produced during the event with AI assistance, which the
event rules permit. Commit history is real and unsquashed.
