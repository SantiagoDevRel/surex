# SAFETY — `ambiguous-deps`

> A review fixture authored by the SureX project. **Not malicious, not for
> production use.** This document is the engineering account of why running it on the
> machine you demo on is harmless, path by path — including the dependency, which is
> the only place anything happens.

## The one-sentence version

`server.mjs` has no capability of its own; the vendored `workspace-toolkit` has all
of them, and **every path it touches is clamped inside
`packages/fixtures/ambiguous-deps/fixture-home/`**.

## Where the capabilities are

| File | What it reaches for |
|---|---|
| `server.mjs` | nothing. No `node:fs`, no `fetch`, no `node:child_process`, no `process.env`, no credential path. |
| `vendor/workspace-toolkit/index.mjs` | filesystem: `readdirSync`, `statSync`, `readFileSync`, `writeFileSync`, `mkdirSync`. Environment: `WORKSPACE_TOOLKIT_SUBDIR`. Nothing else. |

That split is the fixture. It is not an evasion of anything — the disclosure tool
`describe_implementation` names the dependency and the capabilities it uses, and this
document does the same.

## Why the dependency is harmless

1. **One root, and it is inside the fixture.** `assertInsideFixture()` throws for any
   path resolving outside `fixture-home/`. It is deliberately *tighter* than the
   other fixtures' guards: this toolkit has no reason to read the fixture's own
   source, so it cannot.
2. **No caller-supplied path survives.** Every name goes through `path.basename()`
   before it is joined, so `../../server.mjs`, `..\\..\\safety.mjs`, `/etc/passwd`
   and `C:\Windows\win.ini` all reduce to a single segment inside the workspace.
   Empty, `.` and `..` are refused outright.
3. **The environment variable selects a subdirectory, not a location.**
   `WORKSPACE_TOOLKIT_SUBDIR` is reduced to one path segment and then guarded, so
   `WORKSPACE_TOOLKIT_SUBDIR=../..` cannot point the toolkit at your project — it
   falls back to `workspace`.
4. **Writes are bounded and typed.** 64 KiB per note, and the name always ends up
   with a `.md` extension, so a note cannot become an `.mjs` file that something else
   might load.
5. **Reads are bounded.** 256 KiB per file, 200 entries per listing, and a
   non-regular file is refused.
6. **Nothing else at all.** No network, no child process, no `eval`, no dynamic
   import, no credential path anywhere in either file.

## What it does NOT do

- Neither file reads or writes anything outside `fixture-home/`.
- Neither file opens a network connection or launches a process.
- The dependency did not come from npm. It was written by the SureX project, it is
  `private`, and it has no dependencies of its own — so there is no third-party code
  in this fixture beyond the MCP SDK.

## Environment variables

| Variable | Default | Effect |
|---|---|---|
| `WORKSPACE_TOOLKIT_SUBDIR` | `workspace` | Selects a subdirectory of `fixture-home/`. Reduced to one path segment; a traversal attempt falls back to the default. |

## Check it yourself

```bash
# from packages/fixtures/ambiguous-deps
node --test test/*.test.mjs
```

The suite starts the real binary over stdio and asserts: all four tools list and run;
a read or write name containing `..` or an absolute path cannot leave the workspace;
`WORKSPACE_TOOLKIT_SUBDIR=../..` does not escape; the write bound holds; and — the
measurement this fixture exists for — **SureX's own capability scan reports all five
categories absent for `server.mjs` alone, and `filesystem` + `env` present once the
vendored dependency is included.**
