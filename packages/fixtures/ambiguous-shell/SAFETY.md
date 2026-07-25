# SAFETY — `ambiguous-shell`

> A review fixture authored by the SureX project. **Not malicious, not for
> production use.** This document is the engineering account of why running it on
> the machine you demo on is harmless, and — the part that matters for this
> particular fixture — of the one place where its description and its code
> deliberately disagree.

## The one-sentence version

`run_command` describes an unrestricted shell; **this build executes three constant
argv rows and refuses everything else.** The description is the fixture. The
allowlist is what makes the fixture runnable.

## Why the description says "arbitrary"

There is a real category of MCP server whose reason to exist is running commands,
and those servers are honest about it. Pricing that honesty is the hardest call a
reviewer makes: flag it and you flag every terminal integration ever shipped; pass
it and you have passed a shell. A fixture that hedged its own description would
not put that question to anyone. So the description does not hedge.

## Why the code does not

Nobody should have to read this file before running a fixture from a hackathon
repo. So the executable surface is a table of constants:

`safety.mjs` → `ALLOWED_COMMANDS`

| Requested command line | argv actually executed |
|---|---|
| `node --version` | `process.execPath` `["--version"]` |
| `node -p process.platform` | `process.execPath` `["-p", "process.platform"]` |
| `git --version` | `git` `["--version"]` |

Anything else is refused with a message naming the whole table.

## Why the allowlist cannot be talked around

1. **The argv is a constant, not a parse of your input.** `resolveAllowed()`
   normalises the caller's string, uses it as a **lookup key**, and returns the
   argv stored in the table. The caller's bytes never reach the argv. So there is
   no argument-injection surface: `node --version && curl …` is not a command with
   an interesting suffix, it is a key that is not in the table.
2. **No shell is involved.** `execFile` is called with `shell: false`, so `&&`,
   `|`, `;`, `$(…)` and `%VAR%` are inert bytes in an argument, not syntax.
3. **The working directory is pinned inside the package.** `CHILD_CWD` is the
   fixture directory, passed through `assertInsidePackage()`. A child never starts
   in your project.
4. **Children are bounded.** 10 s timeout, 64 KiB of captured output,
   `windowsHide: true`. A hung or chatty child cannot wedge a demo.
5. **Nothing is written to disk.** This fixture has no `fixture-home/`, creates no
   files, and imports no filesystem API.

## What it does NOT do

- It never runs a command that came from a caller, an environment variable, a
  config file or the network — only a row from the table above.
- It never reads a credential path. `describe_environment` reads
  `Object.keys(process.env)` and never a single value, so no secret can leave
  through it even by accident.
- It never opens a network connection: there is no `fetch`, no `http`, no socket
  API anywhere in this fixture.
- It never touches a path outside the package directory.

## Environment variables

None. This fixture has no configuration; there is no env var that widens what it
can execute. `describe_environment` *enumerates* the inherited environment because
the inherited environment is part of what a shell tool grants — but it reads names
only.

## Check it yourself

```bash
# from packages/fixtures/ambiguous-shell
node --test test/*.test.mjs
```

The suite starts the real binary over stdio and asserts: the three tools list; an
allowed command line returns real output; three refused shapes — a command not in
the table, an allowed command with an appended `&& …`, and an attempt at
`rm -rf` — are each refused by name; the argv the table hands out is not derived
from the caller's string; and the child cwd resolves inside the package.
