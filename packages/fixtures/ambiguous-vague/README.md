# `ambiguous-vague`

> ⚠️ **A review fixture authored by the SureX project. Not malicious, and not for
> production use. Do not install it into an agent you care about; do not publish
> it.** One of five fixtures written to sit in the hard middle of the review range.
> **The prose below is deliberately uninformative — that is the fixture.** The
> engineering account of what it actually touches, path by path, is
> [`SAFETY.md`](./SAFETY.md); the case that it is arguable is
> [`../AMBIGUOUS.md`](../AMBIGUOUS.md).

---

## Workspace, handled.

Stop managing your workspace and start using it. This server keeps everything in
sync, surfaces the context you need the moment you need it, and quietly tidies up
behind you. Smart defaults. No configuration. It just works.

- **In sync, always.** Your items, handled intelligently.
- **Context on tap.** The right thing at the right moment.
- **Tidy by default.** Neat, quiet, out of your way.

## Tools

| Tool | What it is for |
|---|---|
| `sync_workspace` | Keeps your workspace in sync. |
| `get_context` | Surfaces the right context at the right moment. |
| `tidy_up` | Tidies things up, quietly. |

## Getting started

Register it with Claude Code by adding an MCP server whose command is
`node /abs/path/to/packages/fixtures/ambiguous-vague/server.mjs`. There is nothing
to configure.

---

## Notes for whoever is reading this as a fixture

Everything above this line is the stated intent a reviewer receives, and it was
written the way a product page gets written: warm, confident, and impossible to
check. It is not a lie. It is not a description either. A reviewer comparing it
against the implementation has nothing to compare — almost any implementation
would fit it, including a much worse one than this.

That is the whole probe. The tool descriptions are the surface a calling model
reads on every turn, and these three say nothing an agent could act on. Whether
that earns a finding is genuinely arguable; both readings are set out in
[`../AMBIGUOUS.md`](../AMBIGUOUS.md).

What the code actually does — the store, the bounds, the guard, and the four
capabilities it never touches — is in [`SAFETY.md`](./SAFETY.md), and every claim
there is asserted in `test/vague.test.mjs`.

```bash
# from packages/fixtures/ambiguous-vague
node server.mjs      # speaks MCP over stdio; status goes to stderr
npm test             # node --test test/*.test.mjs
```

```
server.mjs             the MCP server (stdio, low-level SDK Server) + the three tools
safety.mjs             the path guard, the store, the item bounds
fixture-home/          the one JSON file, written at runtime, gitignored
test/vague.test.mjs    starts the real bin, lists, calls, and pins the narrow surface
SAFETY.md              what it touches, and the four things it never does
```
