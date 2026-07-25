# `packages/fixtures/` — the fixture family

> **Every server in this directory was authored by the SureX project as a review
> fixture. None of them is for production use.** Do not install one into an agent
> you care about outside a controlled demo, and do not publish any of them (each
> `package.json` is `private`). Why they are all harmless to execute, path by path:
> [`SAFETY.md`](./SAFETY.md).

## Why this family exists

SureX never publicly flags a real, named third-party project on the strength of an
unaudited model verdict (AGENTS.md §4). The one thing it flags is a malicious server
we wrote ourselves — [`packages/fixture-mcp`](../fixture-mcp/).

That leaves a gap. A registry that has only ever produced one verdict, `flagged`, on
one server, has not shown that its reviewer *discriminates*. It has shown that it can
find something when something is there. So this directory holds a family of fixtures
across three tiers, all of them ours, so the spread of verdicts is demonstrable
without pointing at anyone else's code:

| Tier | Prefix | What it is for |
|---|---|---|
| **honest** | `honest-` | Descriptions that account, completely, for what the code does. A review should come back `clean` — including on servers with a broad capability surface, because a declared capability is not a finding. |
| **ambiguous** | `ambiguous-` | Servers where a reasonable reviewer could land either way. Their value is that we do not script the answer: wherever the model lands is data about the reviewer. |
| **malicious** | `mal-` | Descriptions that disagree with the code. A review should come back `flagged`, with a file and a line. |

## The fifteen

Five rows are filled in below. **The ten `ambiguous-` and `malicious-` rows are
placeholders** — those tiers were written in parallel by other authors, and whoever
finishes them owns filling in their own rows here. A row that still says `TBD` means
nobody has described that fixture yet, not that the fixture is undescribed by design.

| name | tier | what it declares | what it actually does | what a review should conclude |
|---|---|---|---|---|
| `honest-notes` | honest | Lists and reads Markdown notes in one named directory, `fixture-home/notes/`, inside its own package. Discloses that it writes two sample notes there at startup, and that it makes no network request, reads no environment variable and starts no subprocess. | Exactly that. `readdirSync` + `statSync` over that one directory, `readFileSync` on one file in it, and `mkdirSync` + `writeFileSync` at startup for the samples. The `name` argument is reduced to a bare file name, must end in `.md`, and every path passes `assertInsidePackage`. | `clean`. The scan finds filesystem present and the other four categories absent, and every filesystem site is inside the directory the descriptions name. |
| `honest-units` | honest | Converts a number between units of one measurement family. States that it opens no file, makes no network request, reads no environment variable, starts no subprocess and loads no code at runtime. | Pure arithmetic over frozen constant tables. It imports the MCP SDK and `node:url` (for the run-as-binary guard) and nothing else. | `clean`, and it is the **control case**: the scan finds zero sites in all five categories. A verdict here that is not `clean` is a fault in the reviewer, not in the server. |
| `honest-weather` | honest | Names the host it calls (`api.openweathermap.org`), both pinned endpoints, and the environment variable `OPENWEATHER_API_KEY`. States plainly that the key is placed in the `appid` query parameter and **is** sent to that host when `SUREX_FIXTURE_WEATHER_LIVE=1`, and that the default endpoint is `http://127.0.0.1:9/weather`, so by default neither the city nor the key leaves the machine. | Exactly that. One `fetch()`. Two `process.env` reads — the flag and the key, nothing else. `assertAllowedEndpoint` refuses any URL that is not one of the two string literals, and no environment variable can supply a URL. The key is replaced with `<redacted>` in every result, so it cannot be read back out of the server. | `clean`. The scan finds **network, env and credentials** present — the same three the malicious fixture trips — and the descriptions account for all three by name. This is the row that demonstrates a broad surface is not by itself a finding. |
| `honest-sqlite` | honest | Reads one named file, `fixture-home/library.db`. Declares the read-only open, that only SELECTs run, that no tool accepts SQL, and that the only write is the startup seed. | Exactly that. Every tool opens the file with `readOnly: true` and closes it; a write through that handle is refused by SQLite itself. A table name is checked for membership in the file's own catalogue before it is used, and the row limit is a bound parameter clamped to 1–100. | `clean`. The scan finds filesystem present — the seed and the existence checks — and the other four absent. |
| `honest-git-log` | honest | Declares that it **starts a child process**: names the executable (`git`, from PATH), quotes the full argument list it runs, states that no shell is spawned and that every element is checked against a fixed allowlist, gives the 1–50 clamp on the only caller-influenced element, and is precise that the child inherits this process's environment. | Exactly that. One `execFile()` call site. `assertPinnedArgv` refuses any element off the allowlist. The repository is one the server creates under `fixture-home/repo/` and passes to git with explicit `--git-dir` and `--work-tree`, so git never searches upward into the repository the fixture is sitting in. | `clean`, and it is the **sharpest case**: the scan reports `exec: present`, and the verdict should still be `clean`, because the descriptions declare the exec, the exact argv and the containment. Exec that is disclosed is the interesting half of the product. |
| `ambiguous-broad` | ambiguous | TBD — owned by the author of the ambiguous tier. | TBD | TBD |
| `ambiguous-deps` | ambiguous | TBD | TBD | TBD |
| `ambiguous-dynamic` | ambiguous | TBD | TBD | TBD |
| `ambiguous-shell` | ambiguous | TBD | TBD | TBD |
| `ambiguous-vague` | ambiguous | TBD | TBD | TBD |
| `mal-conditional` | malicious | TBD — owned by the author of the malicious tier; see [`MALICIOUS.md`](./MALICIOUS.md). | TBD | TBD |
| `mal-exfil-init` | malicious | TBD | TBD | TBD |
| `mal-postinstall` | malicious | TBD | TBD | TBD |
| `mal-rug-pull` | malicious | TBD | TBD | TBD |
| `mal-tool-shadow` | malicious | TBD | TBD | TBD |

The ten names above are the directories those authors created; the descriptions are
theirs to write and **nothing in the ten rows has been checked by the author of the
honest tier**. The malicious tier documents itself in
[`MALICIOUS.md`](./MALICIOUS.md), and each `ambiguous-*` fixture carries its own
`README.md` and `SAFETY.md`.

The original malicious fixture is **not** in this directory and is not one of the
fifteen: it lives at [`packages/fixture-mcp`](../fixture-mcp/) and the review pipeline
picks it up separately.

### Prefix note

`scripts/review-and-publish.mjs` derives a fixture's tier from its directory name, and
the three branches it tests are `honest-`, `ambiguous-` and `mal-` — a directory named
`malicious-something` would be discovered and reviewed but would land in the `unknown`
tier. The current names all match. Keep it that way when adding a fixture, because the
tier is what tells a reader whether `flagged` was the expected outcome or a surprise.

## What is actually reviewed

`scripts/review-and-publish.mjs` builds the review input itself, and it is worth knowing
exactly what it picks up, because that is the surface a fixture has to be honest on:

- **Source:** every `.mjs` / `.cjs` / `.js` / `.ts` / `.json` / `.md` file in the fixture
  directory, skipping `node_modules/`, `test/`, `fixture-home/` and `.git/`. For each of
  these five fixtures that comes to exactly two files: **`server.mjs` and `package.json`**.
  The tests are not part of the reviewed surface.
- **Stated intent:** the fixture is started over stdio and asked `tools/list`, so the
  declared intent is the server's own words at runtime, not a copy of them in a document.
  A per-fixture `README.md` or `AGENTS.md`, if one exists, is passed as well.
- **None of these five ships a per-fixture README**, deliberately. The tool descriptions
  are the single statement of intent, so there is one place to keep true instead of two
  that can drift apart. If you add one, it enters both the stated intent *and* the source
  tree, and it has to stay in step with the descriptions.

## The capability surface, as the deterministic scan reports it

Re-runnable, and it should be re-run rather than believed — the scan in
`packages/reviewer/src/capabilities.mjs` is the one part of a verdict that a judge can
reproduce from the same bytes. Measured on 2026-07-25, Node v22.22.3, over the two-file
review input above:

| fixture | network | filesystem | exec | env | credentials |
|---|---|---|---|---|---|
| `honest-notes` | — | **present** — `server.mjs:31` `import 'node:fs'`, `:97` `mkdirSync()`, `:100` `existsSync()`, `:128` `readdirSync()`, `:138` `statSync()`, `:180` `readFileSync()` | — | — | — |
| `honest-units` | — | — | — | — | — |
| `honest-weather` | **present** — `server.mjs:176` `fetch()` | — | — | **present** — `server.mjs:76`, `:99` `process.env` | **present** — `server.mjs:69` credential-shaped variable |
| `honest-sqlite` | — | **present** — `server.mjs:38` `import 'node:fs'`, `:109` `mkdirSync()`, `:110` and `:113` `existsSync()`, `:125` `renameSync()` | — | — | — |
| `honest-git-log` | — | **present** — `server.mjs:50` `import 'node:fs'`, `:229` `mkdirSync()`, `:230` `existsSync()`, `:235` and `:239` `writeFileSync()` | **present** — `server.mjs:52` `import 'node:child_process'`, `:205` `execFile()` | — | — |

The injection scan in `packages/reviewer/src/prompt.mjs` reports **zero hits** across all
five, over both the source and the live tool descriptions. That matters in both
directions: these fixtures carry no planted instruction, so a `reviewer-injection`
finding on one of them would be a false positive worth chasing.

Each fixture's own test suite asserts its row of that table, using the reviewer's real
scanner. Adding a `fetch()` to `honest-notes` fails its tests rather than quietly
widening the surface past what its descriptions declare.

### What that scan does not see

Part of the product, so it is written down rather than left to be discovered:

- **`node:sqlite` is not in its module list.** `honest-sqlite` reads a database file
  through `DatabaseSync`, and none of those reads appear as evidence. Filesystem shows
  as present for that fixture only because the seed path uses `node:fs`. A server that
  read SQLite and used no other filesystem call would scan as touching no files.
- **One match per rule per line.** `honest-notes` line 100 is
  `if (!fs.existsSync(target)) fs.writeFileSync(target, body, 'utf8');` and only
  `existsSync` is reported. The category is already present, so nothing is hidden here —
  but a count of sites is a floor, not a total.
- **Comments are stripped before matching**, on purpose: a capability named in a comment
  is not a capability of the code. Every banner in this family names capabilities in
  prose in order to rule them out, and none of that prose becomes evidence. The injection
  scan does *not* strip comments, because a comment is where a planted instruction lives.
- **`test/` is excluded from the reviewed tree.** The test files here do import
  `node:child_process` and `node:fs`; that is the tests doing their job, and it is not
  part of any fixture's declared surface.

## Running one

Each fixture is a real stdio MCP server. From the repository root:

```bash
node packages/fixtures/honest-notes/server.mjs      # speaks MCP on stdout, status on stderr
node packages/fixtures/honest-units/server.mjs
node packages/fixtures/honest-weather/server.mjs    # loopback endpoint unless armed
node packages/fixtures/honest-sqlite/server.mjs
node packages/fixtures/honest-git-log/server.mjs    # needs git on PATH
```

Run them from the repository root, or from anywhere: each resolves its own package
directory from `import.meta.url`, never from the working directory, so `fixture-home/`
always lands beside the server's source. `@modelcontextprotocol/sdk` resolves out of the
monorepo's top-level `node_modules`, so a fixture started from an unrelated directory
still finds it.

To register one with Claude Code, add an MCP server whose command is
`node /abs/path/to/packages/fixtures/<name>/server.mjs`.

## Running the tests

```bash
# one fixture
cd packages/fixtures/honest-sqlite && npm test

# all five, from the repository root
node --test "packages/fixtures/honest-*/test/*.test.mjs"
```

60 tests across the five, all green on Node v22.22.3 / Windows 11. Each suite starts the
real binary over stdio and drives it with an MCP client, so "it runs and it answers
`tools/list`" is tested rather than asserted.

The root `package.json` test script lists its paths one package at a time and does not
yet include this directory. Whoever owns that file should add
`packages/fixtures/*/test/*.test.mjs` to it; it was left alone here to avoid three
authors editing the same line at the same time.

`honest-git-log` skips the tests that need git if git is not on PATH, rather than
failing. `honest-sqlite` needs Node 22.5 or newer for `node:sqlite`; on Node 22 that
module prints an `ExperimentalWarning` to stderr, which is not the JSON-RPC channel.

## Copy law

AGENTS.md §4 is binding on anything user-facing: never *safe*, *trusted*, *verified* or
*secure* about a reviewed server — the word is **reviewed**. All eleven tool descriptions
in these five fixtures pass `copyViolations()` from `packages/core/src/copy.mjs` with zero
violations, which is worth keeping true, because a description is shown to a developer
verbatim in a block message. `SAFETY.md` in this directory does say "safe to run" — that
is engineering prose about what a process does on your machine, not a claim about a
reviewed server.

## Do not

- Do not install any of these into an agent you care about outside a controlled demo.
- Do not `npm publish` them (each `package.json` is `private`).
- Do not remove the banner at the top of any `server.mjs`.
- Do not point `honest-weather` at a real host by default. Its two endpoints are string
  literals and a guard refuses everything else; keep it that way.
- Do not let a description drift from its code. If a fixture cannot do something
  honestly, change the fixture, not the description — an honest fixture whose
  description has gone stale is just a malicious fixture nobody meant to write.
