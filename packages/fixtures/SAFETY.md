# SAFETY — `packages/fixtures/`

> Every server in this directory was **authored by the SureX project as a review
> fixture**, and none of them is for production use. This document is the engineering
> account of why they are **safe to run** on the machine you demo them on, path by
> path. Read it before you run anything here.
>
> "Safe to run" in this document is a statement about what these processes do on your
> disk and your network. It is never a claim about a *reviewed* server — the registry's
> word for that is **reviewed**, and AGENTS.md §4 governs it.

**Scope.** This file covers the five `honest-*` fixtures, which is what its author
wrote and ran. The other two tiers were written in parallel and document themselves
elsewhere: the malicious tier in [`MALICIOUS.md`](./MALICIOUS.md), and each
`ambiguous-*` fixture in its own `SAFETY.md`. **Nothing in this file has been checked
against those ten fixtures, and their absence from it is not a statement about them
either way.** The original malicious fixture has its own account in
[`packages/fixture-mcp/SAFETY.md`](../fixture-mcp/SAFETY.md).

## The one-paragraph version

None of these five reads anything outside its own package directory, none of them sends
anything to a real remote host by default, and only one of them starts a child process.
Two touch no disk at all. The one that executes something executes `git`, with an
argument list checked against a fixed allowlist, against a repository it created for
itself. Everything any of them writes lands in a gitignored `fixture-home/` beside the
server's own source.

## The three properties that hold across all five

**1. Nothing on disk crosses the package boundary.** Four of the five carry a copy of
the same guard, `assertInsidePackage`, mirroring the one in
`packages/fixture-mcp/src/safety.mjs`. It resolves a path and throws unless the result is
inside the directory the server's own source file lives in:

```js
export function assertInsidePackage(p) {
  const resolved = path.resolve(p);
  const root = PACKAGE_ROOT.endsWith(path.sep) ? PACKAGE_ROOT : PACKAGE_ROOT + path.sep;
  if (resolved !== PACKAGE_ROOT && !resolved.startsWith(root)) {
    throw new Error(`fixture safety: refused a path outside the package: ${resolved}`);
  }
  return resolved;
}
```

Every path handed to `node:fs`, to `node:sqlite`, or to a child process as a working
directory goes through it first. `PACKAGE_ROOT` comes from `import.meta.url`, not from
the working directory, so starting a server from anywhere on the machine — which the
review pipeline does, from the repository root — cannot move where it writes. Each
fixture's tests assert the guard throws for `..`, for the home directory, and for a path
beneath the home directory.

**2. Nothing reaches a real remote host by default.** Only `honest-weather` has any
network reach at all, and its default endpoint is `http://127.0.0.1:9/weather` — the
loopback interface, on the TCP discard port. See its section below.

**3. Everything written is gitignored and re-creatable.** Each fixture that needs data
on disk writes it at startup, into `fixture-home/`, which its `.gitignore` excludes.
Deleting that directory costs nothing: the next start rebuilds it, and a test asserts
the rebuild works.

## Per fixture

### `honest-units` — touches nothing

Nothing to contain. The file imports the MCP SDK and `node:url`, and the whole server is
arithmetic over frozen constant tables. There is no `node:fs`, no `node:child_process`,
no `node:http`, no `fetch`, no `process.env`, and no dynamic code loading. The
deterministic capability scan finds zero sites in all five of its categories, and a test
asserts that — so this is the fixture to reach for if you want to run something from this
directory and reason about it in one breath.

### `honest-notes` — one directory, read

- **What it reads:** `fixture-home/notes/*.md`, beside its own source. `readdirSync` and
  `statSync` on that directory; `readFileSync` on one file in it.
- **What it writes:** two sample notes, `onboarding.md` and `queries.md`, at startup, if
  they are missing. `mkdirSync` + `writeFileSync`, both guarded. No tool call writes
  anything.
- **Why a crafted argument cannot escape:** `read_note`'s `name` is passed through
  `path.basename` before use, so `../../../../etc/passwd` becomes `passwd`; it must then
  end in `.md`, which `passwd` does not, so it is refused before any read. Even had it
  passed, `assertInsidePackage` would refuse the resolved path. Both branches are tested,
  and the traversal test also asserts nothing from outside the package appears in the
  output.
- **What it cannot do:** no network, no environment variable, no subprocess. There is no
  `fetch`, no `node:http`, no `process.env` and no `node:child_process` in the file, and
  the capability scan confirms all four categories absent.

### `honest-sqlite` — one file, read-only, enforced by SQLite

- **What it reads:** exactly one file, `fixture-home/library.db`. Every tool opens it as
  `new DatabaseSync(assertInsidePackage(DB_PATH), { readOnly: true })` and closes it in a
  `finally`.
- **Read-only is enforced, not asserted.** With that flag, SQLite itself rejects a write:
  a `DELETE` through the handle throws *"attempt to write a readonly database"*. Measured
  on Node v22.22.3 and pinned by a test that attempts both a `DELETE` and a `CREATE
  TABLE` and requires both to throw, while a `SELECT` through the same handle still works.
- **What it writes:** the sample database, once, at startup, if the file is missing. It is
  built at `library.db.partial` and renamed into place, so a run killed mid-seed cannot
  leave a half-written file that a later run mistakes for a finished one. A test asserts
  no `.partial` file survives and that a second seed call does not rewrite the file.
- **No SQL reaches the engine from a caller.** There is no tool that takes SQL. A table
  name is checked for membership in the database's own catalogue before it is used, so
  `books"; DROP TABLE books; --` is refused by not being a table — tested, including a
  check that `books` is still there afterwards. `describe_table` never splices the name
  into a statement at all; it binds it as a parameter against `sqlite_master`. The row
  limit is a bound parameter, clamped to 1–100.
- **What it cannot do:** no network, no subprocess, no environment variable.
- **One honest caveat:** the capability scan cannot see `node:sqlite`, so the database
  reads produce no evidence of their own. Filesystem still reports present, via the seed
  path, so the surface does not understate — but do not read that row as an inventory of
  every file this fixture opens. It is in the README's blind-spot list for the same reason.

### `honest-weather` — network, off by default, and it cannot be redirected

This is the only fixture here with network reach, so it gets the most detail.

- **There are exactly two endpoints, both string literals in the source:**

  | | URL | when |
  |---|---|---|
  | default | `http://127.0.0.1:9/weather` | always, unless the flag below is set |
  | live | `https://api.openweathermap.org/data/2.5/weather` | only when `SUREX_FIXTURE_WEATHER_LIVE=1` |

  `127.0.0.1` is the loopback interface and port 9 is the TCP discard port, so the default
  request cannot leave the machine, and normally nothing is listening — the tool reports
  that it could not connect, which is the honest default behaviour rather than a silent
  no-op.
- **No environment variable can supply a URL.** This is the difference from the malicious
  fixture, whose sink is overridable. Here `assertAllowedEndpoint` throws for anything
  that is not one of those two exact strings, and a test walks it through
  `https://example.com/collect`, the cloud-metadata address `169.254.169.254`, the
  look-alike host `api.openweathermap.org.attacker.test`, the live URL with a query string
  appended, and a non-URL — all refused.
- **The flag is off unless it is exactly `"1"`.** A test asserts `liveEnabled()` is false
  and that the endpoint in effect is the loopback one.
- **The API key.** `OPENWEATHER_API_KEY` is read from the environment and placed in the
  `appid` query parameter of whichever endpoint is in effect. With the default endpoint,
  that means the key goes to loopback and no further. With the live flag set, the key is
  sent over the network to `api.openweathermap.org` — which is what an API key is for, and
  which both tool descriptions state in those words. Nothing here is implicit.
- **The key is never echoed back.** Results carry a display URL with `appid` replaced by
  `<redacted>`, so the key cannot be read out of the server through its own output. Tested
  with a dummy value set in the child's environment: the result must contain `<redacted>`
  and must not contain the value.
- **Requests are bounded** by `AbortSignal.timeout(8000)`.
- **What it cannot do:** no file access and no subprocess — there is no `node:fs` and no
  `node:child_process` in the file, and the scan confirms both absent. It writes no
  `fixture-home/` at all.
- **If you want to see the live call:** set `SUREX_FIXTURE_WEATHER_LIVE=1` and
  `OPENWEATHER_API_KEY=<your own key>`. That is a deliberate act, it sends your key to
  OpenWeather, and it is the only way this fixture contacts anything off your machine.

### `honest-git-log` — the one that executes something

- **What it executes:** `git`, and only `git`, resolved from PATH, through `execFile` with
  an **argument array**. No shell is spawned, `shell: true` never appears, and no command
  string is ever assembled — so shell metacharacters have nothing to act on. A test
  asserts there is exactly one `execFile()` call site in the file, and that no `spawn`,
  `execSync` or `execFileSync` appears anywhere.
- **The argument list is pinned.** `assertPinnedArgv` compares every element against a
  fixed allowlist of literals before the process starts. The one caller-influenced element
  is the integer inside `--max-count=N`, which is clamped to 1–50 in the handler *and*
  matched against `^--max-count=([1-9]|[1-4][0-9]|50)$` in the guard. A test walks the
  guard through `--max-count=5; rm -rf /`, `--max-count=51`, `--max-count=0`,
  `--exec-path=`, `--upload-pack=`, `core.pager=`, `clone`, `push`, `config --global`,
  `--all`, and a `--git-dir` pointing at the home directory — all refused. Another test
  asserts the allowlist contains no URL, no path outside the package, and none of
  `clone`/`fetch`/`push`/`pull`/`remote`/`submodule`/`config`/`daemon`.
- **It never reads your repository.** The repository is one the server creates at
  `fixture-home/repo/`, and its location is passed with explicit `--git-dir` and
  `--work-tree`, which stops git searching upward — so it cannot end up reading the
  history of the repository this fixture happens to sit inside. The two commits it returns
  are the two it made itself. A test asserts every pinned argument list names that
  `--git-dir` explicitly.
- **It cannot trigger your git hooks.** Every invocation forces
  `core.hooksPath=<fixture-home/repo/.no-hooks>`, a directory inside its own tree that
  does not exist, and commits pass `--no-verify`. So a `pre-commit` hook in a developer's
  global git configuration does not run during the seed. `commit.gpgsign=false` keeps it
  from reaching for a signing key, and `color.ui=false` keeps the output stable.
- **Bounded:** a 10-second timeout and a 1 MiB output buffer per invocation, and
  `windowsHide: true`.
- **What it writes:** `fixture-home/repo/notes.txt` and that repository's `.git`, at
  startup, once. Nothing else, and no tool call writes.
- **On the environment, precisely:** this server contains no `process.env` read, and the
  capability scan reports `env` absent. The git child process does inherit this process's
  environment, because no replacement environment is passed to `execFile` — that is
  standard child-process behaviour, it is stated in both tool descriptions, and it is not
  hidden behind a blanket "reads no environment variable", which would not have been the
  whole truth. Everything that would matter is forced on the git command line, where it
  takes precedence over both configuration and environment.
- **If git is not installed**, the server still starts and the tools report the failure;
  the tests that need git skip rather than fail.

## What none of the five does

- None reads a real credential path. No `.ssh`, no `.aws`, no `.npmrc`, no OS credential
  store, no browser or wallet store. `honest-weather` reads one environment variable that
  may hold an API key, and it names that variable in both of its tool descriptions.
- None sends anything to a real remote host by default.
- None touches a file outside its own package directory.
- None runs a shell, evaluates a string, loads code at runtime, or has an npm lifecycle
  script. Each `package.json` is `private: true`, so none can be published by accident.
- None carries a planted instruction aimed at a reviewing model. The injection scan in
  `packages/reviewer/src/prompt.mjs` reports zero hits across all five, over both the
  source and the live tool descriptions.

## Environment variables

Only `honest-weather` reads any, and both are inert unless set deliberately:

| Variable | Default | Effect |
|---|---|---|
| `SUREX_FIXTURE_WEATHER_LIVE` | unset | `=1` switches from the loopback endpoint to `api.openweathermap.org`. Any other value, including empty, leaves it on loopback. |
| `OPENWEATHER_API_KEY` | unset | Sent as the `appid` parameter to whichever endpoint is in effect. Unset means an empty `appid` is sent to loopback. Never returned in a result. |

The other four fixtures read no environment variable at all.

## How to check all of this yourself

```bash
# from the repository root — 60 tests, including every safety invariant above
node --test "packages/fixtures/honest-*/test/*.test.mjs"
```

The suites are the load-bearing part of this document. Each one starts the real binary
over stdio, and each asserts its fixture's capability surface using the reviewer's own
scanner — so a future edit that widens the surface past what the descriptions declare
fails the tests instead of shipping quietly.
