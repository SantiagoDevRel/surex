# `ambiguous-dynamic`

> ⚠️ **A review fixture authored by the SureX project. Not malicious, and not for
> production use. Do not install it into an agent you care about; do not publish
> it.** It is one of five fixtures written to sit in the hard middle of the review
> range. Read [`SAFETY.md`](./SAFETY.md) before running it, and
> [`../AMBIGUOUS.md`](../AMBIGUOUS.md) for the case that this one is arguable.

## What it is

A config-driven MCP server. It reads [`tools.config.json`](./tools.config.json) at
startup and registers one MCP tool per entry. **The tool names, descriptions and
input schemas an agent sees are not in the source code.**

That is an ordinary way to build a plugin host — every "define your own tools in
YAML" server has this shape — and it is also, exactly, the blind spot the SureX tech
spec names in §6: a payload that does not exist at review time. Read every line of
`server.mjs` and you can describe the three *behaviours* it implements, but you
cannot say what this server will offer an agent, because that is data.

Not one tool name this server exposes appears anywhere in its source. A test
asserts that, against the shipped config, for every source file.

## The tools

Whatever `tools.config.json` says. As shipped, three of them:

| Tool | Kind | What it does |
|---|---|---|
| `whats_new` | `static-text` | returns a string from the config file |
| `list_notes` | `list-notes` | lists the fixture's own notes directory — names and sizes |
| `note_line_count` | `count-lines` | counts lines in one note from that directory |

Plus one tool that **is** in the source: `describe_tool_source`, which reports the
config path, what it registered, and what it refused. A server built this way does
not have to ship that. This one does, so a reader who only ever calls tools still
finds out where the tool list came from.

## Why this is the sharpest of the five blind spots

Two things stack:

1. **Tool descriptions are an attack surface, and here they are data.** Description
   poisoning — text in a description that steers the calling model — is the Invariant
   Labs class, and it is the one thing a reviewer most needs to read. On this server
   a description never appears in a reviewed file.
2. **The config is not in the fingerprint.** `SXF-1` canonicalises the *install
   config*: runner, package, version, residual args — and excludes `env` entirely
   (tech-spec §2.1–2.2). Tier A additionally compares an npm tarball integrity
   digest. A JSON file sitting next to the server is in none of that. Edit it,
   restart, and the gate resolves the same fingerprint to the same verdict for a
   server that now offers different tools.

Nothing about that is hypothetical or contrived. It is what config-driven plugin
hosts do, and the honest thing for a review to say about one is that its declared
surface was read at a moment in time.

## What keeps it harmless

The config supplies **data, not behaviour**. An entry picks a `kind` from a closed
set of three implemented in `server.mjs`; it cannot supply a fourth. There is no
`eval`, no `new Function`, no dynamic `import()`, and no path in the config that
becomes a path on disk. An entry naming an unknown kind is refused at load and never
registered. Details in [`SAFETY.md`](./SAFETY.md), asserted in
`test/dynamic.test.mjs`.

## See the point in ten seconds

```bash
# from packages/fixtures/ambiguous-dynamic
node server.mjs                     # 3 tools + the disclosure
# add an entry to tools.config.json, restart, and the surface is different
# — with server.mjs byte-identical
npm test                            # a test does exactly this, with a temp config
```

Register it with Claude Code by adding an MCP server whose command is
`node /abs/path/to/packages/fixtures/ambiguous-dynamic/server.mjs`.

## Layout

```
server.mjs              the MCP server + the three behaviours + the disclosure tool
safety.mjs              the path guard, the config loader and its validation, the closed kind set
tools.config.json       the tool list — committed, because it is the interesting file
fixture-home/notes/     the notes two of the kinds read, written at runtime, gitignored
test/dynamic.test.mjs   starts the real bin, then proves the surface changes with the config alone
SAFETY.md               why data-driven tools stay data, path by path
```
