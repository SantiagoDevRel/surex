# SAFETY — `ambiguous-broad`

> A review fixture authored by the SureX project. **Not malicious, not for
> production use.** This document is the engineering account of why running it on
> the machine you demo on is harmless, path by path.

## The one-sentence version

The declared design reads a whole directory tree and uploads it to a configured
destination; **this build cannot walk outside its own package directory and cannot
upload to any host that is not loopback**, and with no destination configured it
sends nothing at all.

## Clamp 1 — the walk cannot leave the package

- Every `readdirSync`, `statSync` and `readFileSync` argument passes through
  `assertInsidePackage()`, which throws for any path resolving outside
  `packages/fixtures/ambiguous-broad/`.
- `resolveRoot()` applies the same guard to the caller's `root`, so
  `snapshot_directory({ root: "C:\\Users" })` and
  `snapshot_directory({ root: "../../.." })` are both refused before a single
  directory is opened.
- The default root is `fixture-home/workspace/`, a decoy tree the fixture writes
  itself on startup.
- **Symlinks are recorded and stepped over, never followed.** A link planted inside
  the tree cannot walk the reader out of the package — which is the one way a path
  guard applied to the *entry* can still lose.
- Bounds: 8 levels of depth, 500 files, 256 KiB per file, 2 MiB in total. A walk
  cannot run away with the machine, and every refusal is reported in the output
  rather than passed over quietly.

## Clamp 2 — nothing leaves the machine

- **There is no default destination.** `AMBIGUOUS_BACKUP_URL` unset means
  `upload_snapshot` sends nothing and says so in its result.
- When it is set, `assertLoopbackDestination()` refuses any host that is not
  loopback: `127.0.0.0/8`, `localhost`, `::1`, `*.localhost`, `*.invalid`. A real
  domain, a public IP, and cloud-metadata addresses like `169.254.169.254` all
  throw, and nothing is sent.
  Confirmed: `AMBIGUOUS_BACKUP_URL=https://backup.example.net` →
  `Upload failed or was refused: fixture safety: refused a non-loopback destination`.
- `AMBIGUOUS_BACKUP_TOKEN`, if set, is sent as a bearer to that loopback
  destination. `describe_destination` reports only *whether* it is set; the value is
  never returned to a caller and never logged.

## The skip list, and why the capability scan flags it

`snapshot_directory` skips `.ssh/`, `id_rsa`, `id_ed25519`, `.aws/credentials`,
`.npmrc`, `.git-credentials`, `.env`, `node_modules/` and `.git/`. The list is an
array of string literals in `safety.mjs`, so SureX's deterministic capability scan
matches those literals and reports `credentials: present`, citing the skip list as
its evidence.

That is not a bug in either direction. The scan says of itself that it reports
*reach*, not intent, and a reader who opens the cited line finds code written to
avoid exactly those files. It is the clearest available demonstration of why the
capability block is a starting point for a reader rather than a verdict, and it is
argued out in [`../AMBIGUOUS.md`](../AMBIGUOUS.md).

The decoy tree deliberately contains `secrets/id_rsa` and `.env` — obviously fake,
no key header of any kind in either — so a snapshot shows the skip list working at
runtime instead of only in the source.

## What it does NOT do

- It never reads a path outside its own package directory, whatever a caller passes.
- It never follows a symlink.
- It never sends anything anywhere unless an operator sets `AMBIGUOUS_BACKUP_URL`,
  and never to a host that is not loopback.
- It never returns or logs the value of `AMBIGUOUS_BACKUP_TOKEN`.
- It never executes a process: no `child_process`, no `exec`, no `eval`.
- It never reads a real credential path — the credential-shaped names in its source
  are the list of files it refuses to open.

## Environment variables

| Variable | Default | Effect |
|---|---|---|
| `AMBIGUOUS_BACKUP_URL` | unset | The upload destination. Unset means nothing is sent. Non-loopback is refused. |
| `AMBIGUOUS_BACKUP_TOKEN` | unset | Sent as a bearer to a loopback destination when set. Never returned to a caller. |

## Check it yourself

```bash
# from packages/fixtures/ambiguous-broad
node --test test/*.test.mjs
```

The suite starts the real binary over stdio and asserts: a snapshot of the decoy
tree lists the ordinary files and reports `secrets/id_rsa` and `.env` as skipped; a
root outside the package is refused; contents are captured only when asked for; with
no destination configured nothing is sent; a non-loopback destination is refused
while a loopback one is accepted by the guard; the token's value never appears in
any tool output; and the capability scan's real output over this fixture is what the
README says it is.

## If you want to see an upload happen harmlessly

```bash
# a listener on loopback, then in another shell:
AMBIGUOUS_BACKUP_URL=http://127.0.0.1:9099/sink node server.mjs
```

The JSON arrives on your own machine and nowhere else. That is the entire upload,
contained.
