# SAFETY — `ambiguous-dynamic`

> A review fixture authored by the SureX project. **Not malicious, not for
> production use.** This document is the engineering account of why a server that
> builds its tool list from a file is still harmless to run here, path by path.

## The one-sentence version

The config file supplies **data, never behaviour**: an entry picks one of three
behaviours implemented in `server.mjs`, all confined to this package directory, and
an entry that names anything else is refused at load time.

## The line between configuration and payload

`tools.config.json` controls three things per entry: the tool's `name`, its
`description`, and which `kind` it is. That is all.

`KINDS` in `safety.mjs` is a closed set of three:

| kind | What it does | What it touches |
|---|---|---|
| `static-text` | returns a string from the config | nothing on disk |
| `list-notes` | lists `fixture-home/notes/` | that directory, names and sizes |
| `count-lines` | counts the lines in one note | one file in that directory, basename only |

There is no kind that runs a command, opens a socket, reads an arbitrary path, or
evaluates a string. A config entry cannot introduce one — the vocabulary is checked
at load (`loadToolConfig`) **and** at registration (`buildTools`), because a closed
set that is only closed in one place is not closed.

## Why it is harmless to execute

1. **No dynamic code, anywhere.** No `eval`, no `new Function`, no `vm`, no dynamic
   `import()`, no `require` of a computed path. The config is parsed with
   `JSON.parse` and read as data.
2. **No path comes from the config.** No entry field is ever used to build a
   filesystem path. The only caller-supplied path-ish value in the whole fixture is
   `count-lines`'s `name`, and it is reduced to `path.basename()` and then guarded
   by `assertInsidePackage()`.
3. **Every read is inside the package.** The config, the notes directory and each
   note pass through `assertInsidePackage()`, which throws for anything resolving
   outside `packages/fixtures/ambiguous-dynamic/`.
4. **Fail-closed validation.** A malformed file registers nothing rather than
   half-configuring a server. Bad name, duplicate name, missing description, unknown
   kind, `static-text` with no text, more than 16 tools — each entry is dropped, and
   every refusal is printed to stderr at startup and reported by
   `describe_tool_source`.
5. **No network, no child process, no environment read.** There is no `fetch`, no
   `node:http`, no `child_process` and no `process.env` in this fixture.
6. **The shipped config is harmless.** Three entries: one returns a fixed string,
   two read the fixture's own notes.
7. **A missing config is fail-closed.** The fixture does not write a default one —
   no tool name appears anywhere in its source, which is the claim it makes. With no
   config on disk it starts with the disclosure tool alone and reports why on stderr.

## What it does NOT do

- It never executes anything the config asks for beyond the three named kinds.
- It never reads or writes a path outside its own directory.
- It never fetches its config, or anything else, over the network.
- It does not reload the config while running: the list is built once at startup, so
  a tool that was listed cannot silently become a different tool mid-session. A
  restart is what changes the surface.

## Environment variables

None.

## What this fixture is genuinely trying to show

That a `clean` verdict on this server is a statement about the config that was on
disk at review time. `SXF-1` canonicalises the install config — runner, package,
version, residual args — and excludes `env` entirely (tech-spec §2.1–2.2). A sibling
JSON file is in none of it. So:

- edit `tools.config.json`,
- restart,
- the gate computes the same fingerprint and resolves the same verdict,
- the server now offers different tools with different descriptions.

That is not a defect in this fixture. It is the property SureX documents as
*"runtime-loaded payloads … the reach is reported, the payload cannot be"*, made
concrete enough to demo. The honest response is disclosure, which is why
`describe_tool_source` exists and why the README leads with it.

## Check it yourself

```bash
# from packages/fixtures/ambiguous-dynamic
node --test test/*.test.mjs
```

The suite starts the real binary over stdio and asserts: the three shipped tools plus
the disclosure are listed and callable; **the same `server.mjs` exposes a different
tool list when pointed at a different config** — the fixture's central claim; an
entry with an unknown kind is refused and never registered; a `count-lines` name
containing `../` cannot escape the notes directory; a corrupt config registers
nothing; and the capability scan over this fixture reports filesystem only.
