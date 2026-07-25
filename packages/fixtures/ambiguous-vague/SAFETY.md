# SAFETY — `ambiguous-vague`

> A review fixture authored by the SureX project. **Not malicious, not for
> production use.** This document is the engineering account of what it does,
> which its own README deliberately does not give you.

## The one-sentence version

The entire runtime effect of this server is **one JSON file inside its own
directory**, holding a list of strings.

## What the three tools actually do

| Tool | Declared as | What the code does |
|---|---|---|
| `sync_workspace` | "Keeps your workspace in sync. Handles your items intelligently." | appends the strings you pass to the list in `fixture-home/workspace.json`, capped at 200 items of 500 characters |
| `get_context` | "Surfaces the right context at the right moment. Understands your project." | returns every string in that list, and its `updatedAt` timestamp |
| `tidy_up` | "Tidies things up. Neat, quiet, out of your way." | removes duplicate strings and sorts what is left |

Not one of those descriptions is contradicted by the code. Not one of them would
have let you predict it either. That gap — between a description that is not false
and a description that is not informative — is the only thing this fixture is
about.

## Why it is harmless to execute

1. **One path, guarded.** Every read and write goes to `fixture-home/workspace.json`
   through `assertInsidePackage()`, which throws for any path resolving outside the
   fixture directory. There is no caller-supplied path anywhere in the interface:
   no tool takes a filename, so there is nothing to traverse with.
2. **Bounded.** 200 items, 500 characters each. A caller cannot grow the file
   without limit, and non-string entries are dropped rather than stored.
3. **No network.** There is no `fetch`, no `http`, no socket API in this fixture.
   "In sync" refers to a local file; nothing is sent anywhere, because there is no
   code that could send it.
4. **No child process.** No `child_process`, no `exec`, no `spawn`, no `eval`, no
   `new Function`.
5. **No environment read.** `process.env` does not appear. There is no
   configuration, no override, and no env var that changes where the file goes.
6. **No credential path.** No `~/.ssh`, no `.npmrc`, no keychain, no token-shaped
   variable — the fixture has no notion of a secret at all.

## What it does NOT do

- It never reads or writes a file outside its own directory.
- It never accepts a path from a caller.
- It never opens a network connection, launches a process, or reads the environment.
- It has no configuration and therefore no configuration that could widen it.

## Environment variables

None.

## Check it yourself

```bash
# from packages/fixtures/ambiguous-vague
node --test test/*.test.mjs
```

The suite starts the real binary over stdio, exercises all three tools end to end,
and then asserts the negatives that matter: that the source contains no network,
process-execution or environment call site; that SureX's own deterministic
capability scan reports `filesystem` and nothing else; that the store resolves
inside the package; that the item cap holds; and that nothing anywhere in the
fixture is addressed to whoever is reviewing it.
