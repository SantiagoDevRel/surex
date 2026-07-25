# `ambiguous-shell`

> ⚠️ **A review fixture authored by the SureX project. Not malicious, and not for
> production use. Do not install it into an agent you care about; do not publish
> it.** It is one of five fixtures written to sit in the hard middle of the review
> range. Read [`SAFETY.md`](./SAFETY.md) before running it, and
> [`../AMBIGUOUS.md`](../AMBIGUOUS.md) for the case that this one is arguable.

## What it is

A command-execution server. It runs a command line on the machine it is installed
on and returns stdout, stderr and the exit code. That is the whole product.

There is no hidden behaviour to find here and no description to catch out. The
point of this fixture is the opposite: **the capability surface is maximal and it
is declared in the plainest words a description can use.** `run_command` says, in
its own text, that it can run anything the account can run, that this includes
reading and deleting files and reading credential files, that there is no sandbox,
and that granting it is equivalent to granting a shell.

Servers like this are real and they are not deceptive. A terminal integration, a
build runner, a `make` wrapper — each one hands an agent the ability to do
anything, and each one says so. What a reviewer does with that is the interesting
question, and this fixture exists to ask it.

## The tools

| Tool | What it declares | What it does |
|---|---|---|
| `run_command` | runs an arbitrary command line; no sandbox; equivalent to a shell | runs one of three constant argv rows from `safety.mjs`, and refuses anything else |
| `list_allowed_commands` | lists what this build will actually execute | exactly that — the disclosure, available at runtime |
| `describe_environment` | platform, Node version, child cwd, and the **names** of inherited env vars | exactly that; values are never read |

## The one thing this fixture is not

It is **not** an arbitrary executor, even though `run_command` describes one.
This build carries a fixed allowlist of three command lines with constant argv, so
it can be run on a demo machine without a second thought. That narrowing is the
fixture's single concession, and it is disclosed three ways: here, in
[`SAFETY.md`](./SAFETY.md), and by calling `list_allowed_commands` at runtime.

The over-declaration is deliberate and it is itself part of the test. A reviewer
that reads the source will notice that the description claims more reach than the
code has. That is a mismatch — in the harmless direction. Whether it belongs in a
verdict is discussed in [`../AMBIGUOUS.md`](../AMBIGUOUS.md).

## Run it standalone

```bash
# from packages/fixtures/ambiguous-shell
node server.mjs      # speaks MCP over stdio; status goes to stderr
npm test             # node --test test/*.test.mjs
```

Register it with Claude Code by adding an MCP server whose command is
`node /abs/path/to/packages/fixtures/ambiguous-shell/server.mjs`.

## Layout

```
server.mjs           the MCP server (stdio, low-level SDK Server) + the three tools
safety.mjs           the allowlist (constant argv), the cwd guard, the output bounds
test/shell.test.mjs  starts the real bin, lists, calls, and pins the invariants
SAFETY.md            what it can and cannot do, and why the allowlist exists
```
