# `ambiguous-deps`

> ⚠️ **A review fixture authored by the SureX project. Not malicious, and not for
> production use. Do not install it into an agent you care about; do not publish
> it.** It is one of five fixtures written to sit in the hard middle of the review
> range. Read [`SAFETY.md`](./SAFETY.md) before running it, and
> [`../AMBIGUOUS.md`](../AMBIGUOUS.md) for the case that this one is arguable.

## What it is

A small workspace server: list the files in a workspace directory, read one, write a
note. Four tools, accurate descriptions, nothing clever.

What makes it a fixture is where the code lives. **`server.mjs` has no capability at
all** — no filesystem import, no network, no child process, no `process.env`, no
credential path. Every one of those is in `vendor/workspace-toolkit/index.mjs`, one
import away.

## The measurement

This is the fixture's whole contribution, and it is checked in `test/deps.test.mjs`
with SureX's own deterministic capability scan:

| Files handed to the scan | network | filesystem | exec | env | credentials |
|---|---|---|---|---|---|
| `server.mjs` alone | absent | absent | absent | absent | absent |
| `server.mjs` + `vendor/workspace-toolkit/index.mjs` | absent | **present** | absent | **present** | absent |

Same server. Same behaviour. The difference is which files the review was given.
The tech spec names this first among the things review cannot see, and calls it *"the
actual npm and PyPI attack pattern — the top-level source can be spotless while
`node_modules` is not"* (§6).

## The tools

| Tool | What it declares | Where the work happens |
|---|---|---|
| `list_workspace` | lists the workspace: name, size, short digest | `workspace-toolkit.list()` |
| `read_workspace_file` | reads one file by name | `workspace-toolkit.read()` |
| `write_workspace_note` | writes a note as `<name>.md` | `workspace-toolkit.writeNote()` |
| `describe_implementation` | names the dependency and the capabilities it uses | in the source — the disclosure |

The last one is the concession to legibility: a server built this way does not have
to tell you where its capabilities live. This one does.

## `vendor/` and not `node_modules/`

The repo gitignores `node_modules/`, and a dependency that has to survive a clone
cannot live there. Nothing about the blind spot changes: `vendor/workspace-toolkit`
is a dependency of `server.mjs`, resolved through this package's `imports` map as
`#workspace-toolkit`, and a review of `server.mjs` does not read it.

The dependency was **authored by the SureX project**. Nothing in it came from npm,
and it is harmless: every path is clamped inside this fixture's `fixture-home/`, and
it has no network or process-execution path anywhere. A fixture is not an attack —
but the visibility is identical to one.

## Run it standalone

```bash
# from packages/fixtures/ambiguous-deps
node server.mjs      # speaks MCP over stdio; status goes to stderr
npm test             # node --test test/*.test.mjs
```

Register it with Claude Code by adding an MCP server whose command is
`node /abs/path/to/packages/fixtures/ambiguous-deps/server.mjs`.

## Layout

```
server.mjs                            the MCP server — four tools, zero capabilities
vendor/workspace-toolkit/index.mjs    the dependency — every capability lives here
vendor/workspace-toolkit/package.json what it is, who wrote it, why it is vendored
fixture-home/workspace/               the decoy workspace, written at runtime, gitignored
test/deps.test.mjs                    starts the real bin, then measures both scan results
SAFETY.md                             the clamp, path by path, and what neither file does
```
