# `ambiguous-broad`

> ⚠️ **A review fixture authored by the SureX project. Not malicious, and not for
> production use. Do not install it into an agent you care about; do not publish
> it.** It is one of five fixtures written to sit in the hard middle of the review
> range. Read [`SAFETY.md`](./SAFETY.md) before running it, and
> [`../AMBIGUOUS.md`](../AMBIGUOUS.md) for the case that this one is arguable.

## What it is

A backup tool. It walks a directory tree, reads every file it is permitted to read,
records path + size + sha256 for each, optionally captures the bytes, and POSTs the
result to whatever destination the operator configured.

Every clause of that is in the tool descriptions, in those words. Nothing is
implied, softened or left out — including that it reads dotfiles, including that
the bytes go over the wire when you ask for them, and including that the
destination comes from an environment variable rather than from an allowlist the
author controls.

## The tools

| Tool | What it declares | What it does |
|---|---|---|
| `snapshot_directory` | walks a tree; path + size + sha256 for every file; dotfiles included; optional file bytes; skips a fixed list of sensitive names; no symlinks; 500 files / 2 MB caps | exactly that, with the walk clamped inside this package |
| `upload_snapshot` | POSTs the snapshot to `AMBIGUOUS_BACKUP_URL` with `AMBIGUOUS_BACKUP_TOKEN` as a bearer; nothing is sent when unset | exactly that, with the destination clamped to loopback |
| `describe_destination` | reports the destination, its host, whether it would pass the check, whether a credential is configured | exactly that; the credential's value is never returned |

## Why this one is a fixture and not a product

Because the difference between this and an exfiltration tool is **the value of one
environment variable**, and that is not a flaw in the fixture — it is the shape of
the whole category. "Read everything under a root and send it to a destination the
user chose" is a faithful description of every backup product ever shipped, and of
every exfiltration payload ever written. The declared reach is identical. Only the
destination differs, and the destination is configuration, which is precisely the
thing a static review of the source cannot see.

Two clamps make this build runnable on a demo machine, and both are narrower than
what a real backup tool would ship:

1. **The walk cannot leave this package directory.** A `root` outside it is refused
   by `assertInsidePackage()`. The default root is a decoy tree the fixture writes
   itself.
2. **The destination must be a loopback host, and is off unless configured.** With
   `AMBIGUOUS_BACKUP_URL` unset nothing is sent; with it set to a real host the
   upload is refused. A real product would POST to its vendor endpoint here.

Both are documented path by path in [`SAFETY.md`](./SAFETY.md) and asserted in
`test/broad.test.mjs`.

## A note on the skip list

`snapshot_directory` refuses to read `.ssh/`, `id_rsa`, `id_ed25519`,
`.aws/credentials`, `.npmrc`, `.git-credentials` and `.env`. That list lives in
`safety.mjs` as an array of strings, which means SureX's own deterministic
capability scan reports **`credentials: present`** for this fixture and cites those
exact lines as its evidence — lines whose entire purpose is to *avoid* reading
credentials.

The scan documents this about itself: it reports reach, not intent. This is the
case where the difference is visible in a verdict, and what a reviewer does with it
is discussed in [`../AMBIGUOUS.md`](../AMBIGUOUS.md).

## Run it standalone

```bash
# from packages/fixtures/ambiguous-broad
node server.mjs      # speaks MCP over stdio; status goes to stderr
npm test             # node --test test/*.test.mjs
```

To watch an upload happen harmlessly, run a loopback listener and point the
destination at it:

```bash
AMBIGUOUS_BACKUP_URL=http://127.0.0.1:9099/sink node server.mjs
```

Register it with Claude Code by adding an MCP server whose command is
`node /abs/path/to/packages/fixtures/ambiguous-broad/server.mjs`.

## Layout

```
server.mjs             the MCP server, the tree walk, the upload
safety.mjs             the path guard, the skip list, the loopback guard, the decoy tree
fixture-home/          the decoy workspace, written at runtime, gitignored
test/broad.test.mjs    starts the real bin, snapshots, refuses a real host, pins the clamps
SAFETY.md              the two clamps, path by path, and what it never does
```
