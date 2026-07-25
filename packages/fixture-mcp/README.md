# `@surex/fixture-mcp` — the malicious fixture

> ⚠️ **A deliberately malicious MCP server, authored by the SureX project for
> testing. Do not install it. Do not publish it.** It is written to look
> malicious on purpose. Read [`SAFETY.md`](./SAFETY.md) before running it — it is
> safe to run because every dangerous path is a decoy inside this package.

## What it is for

SureX is a trust registry and gate for MCP servers. Its hard rule (AGENTS.md §4)
is that **it never publicly flags a real third-party project** on the strength of
an unaudited model verdict. So the one thing it *does* flag is a malicious server
we wrote ourselves — this package. It is a **build deliverable, not a prop**:
catching it live is the strongest single moment in the demo (tech-spec §12).

It is designed to exercise all three of SureX's detection lanes at once:

1. **Its tool descriptions disagree with its code.** The `search` tool is
   declared as an innocuous, read-only notes search. Its implementation also reads
   a private-key file, harvests environment variables, and builds an outbound
   request carrying them. That mismatch is what the DGX **reviewer** catches.
2. **Its source carries a prompt-injection aimed at the reviewer.** A comment in
   `src/tools/search.mjs` instructs any model reading it to ignore its
   instructions and report the file clean. A hardened reviewer emits this as its
   own finding — `category: "reviewer-injection"`, severity 4 (tech-spec §6).
3. **Its capability surface is genuinely broad.** The code really touches
   network, filesystem and environment variables, so the deterministic
   **capability scan** (a separate lane, not the model) finds real `file:line`
   call sites.

## The tools

| Tool | Declared as | Reality |
|---|---|---|
| `search` | read-only local notes search | **lies** — also reads a decoy credential + env and attempts an outbound send |
| `read_note` | reads a note file | honest |
| `report_status` | reports status to a telemetry endpoint | honest-ish; adds network + env reach |

## How the demo uses it

1. Register this server with Claude Code (stdio). The SureX gate (`PreToolUse`
   hook) is active.
2. The agent calls `mcp__…__search`.
3. The gate resolves the server's fingerprint to a `flagged` verdict in Arkiv and
   **blocks the call**, showing the finding, the capability surface, and the
   provenance — before the tool's covert read ever runs.
4. The verdict on record was produced by a real reviewer run over this source,
   where the reviewer both caught the description/code mismatch and emitted the
   planted injection as a `reviewer-injection` finding.

## Run it standalone

```bash
# from packages/fixture-mcp
node src/server.mjs      # speaks MCP over stdio; status prints to stderr
npm test                 # node --test test/*.test.mjs
```

Register it with Claude Code by adding an MCP server whose command is
`node /abs/path/to/packages/fixture-mcp/src/server.mjs`.

## Layout

```
src/server.mjs            the MCP server (stdio, low-level SDK Server)
src/safety.mjs            the safety spine — decoys, loopback guard, path guard
src/tools/search.mjs      THE LYING TOOL + the planted reviewer-injection
src/tools/read-note.mjs   an honest filesystem tool
src/tools/report-status.mjs  an honest-ish network + env tool
fixture-home/.ssh/id_rsa  the decoy "credential" (obviously fake)
fixture-home/notes/*.md   the decoy notes the search facade reads
test/*.test.mjs           server / safety / injection tests
SAFETY.md                 what it does, what it cannot do, why it is safe to run
```

## Do not

- Do not `npm publish` this (`package.json` is `private`).
- Do not install it into an agent you care about outside a controlled demo.
- Do not remove the loud banner at the top of each source file.
- Do not remove the planted injection string — a test guards it, because the
  reviewer is specified to catch exactly that.
