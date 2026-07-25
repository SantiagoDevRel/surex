# SureX — the gate

A Claude Code plugin. Before your agent calls any MCP tool, it looks the server up.

- **Reviewed, no mismatch found** → nothing happens. No output, no delay you notice, no trace.
- **Flagged** → the call stops. You get the finding, the file, the line, what the code can actually reach,
  and where the evidence lives. One command lets you proceed anyway.
- **Anything else** — unknown, stale, could not be reviewed, registry unreachable → a one-line notice, and
  your normal permission flow decides, exactly as it would without SureX installed.

## Install

```
/plugin marketplace add SantiagoDevRel/surex
/plugin install surex@surex
```

Claude Code will show you a "Will install" list naming the hooks before anything runs, behind a trust gate.

**Plugin hooks run unsandboxed, with your permissions.** That is true of every Claude Code plugin including
this one, and it is worth saying out loud in a tool whose entire subject is what you are running. The whole
gate is [~700 lines of dependency-free JavaScript](./lib) — it is meant to be read.

## The command

```
surex list                  every configured server, its fingerprint, its verdict
surex why <fingerprint>     the full case, including the evidence fetched from Walrus and checked
surex allow <fingerprint>   proceed anyway. --once limits it to this session
surex revoke <fingerprint>  undo an allow
surex check [name]          what a server fingerprints to, and why
surex status                where state lives, what is cached, and the registry hit rate
```

`bin/` joins your PATH while the plugin is enabled, so there is no separate install.

## What it does and does not know

It identifies a server **from its install configuration alone** — it never runs or connects to a server to
identify it. That is what makes the `SessionStart` prefetch possible at all: those hooks fire before MCP
connections exist.

Because a config is an *install instruction* and not the bytes it resolves to, every verdict is graded:

| Tier | What it means |
|---|---|
| **A** | the reviewed bytes are the installed bytes — the recorded digest matches yours |
| **B** | the same version string, but the bytes were never compared |
| **C** | nothing was checked. The verdict may be about code that is not your code |

**A measured note on tiers.** On the first real machine this was run against — a working developer's
laptop, 15 MCP servers across three config scopes — **every single stdio server resolved to `unpinned`**,
because the ecosystem convention is `npx -y pkg@latest`. All 15 were Tier C. Tier A is real and
implemented, but as of this writing it is close to unreachable in practice, and pretending otherwise would
be the exact overstatement this project exists to avoid.

## Where your data lives

`${CLAUDE_PLUGIN_DATA}` — never `${CLAUDE_PLUGIN_ROOT}`, which is replaced on every plugin update. Your
overrides would not survive there.

```
cache.json       verdicts, with TTLs
overrides.json   the servers you told us to stop blocking
gate.log         what the gate decided, locally
```

**Overrides are local and are reported nowhere.** A registry that phones home about which warnings you
ignored is a different product, and a worse one.

## How it fails

Every failure path proceeds and says so. A trust layer with no SLA that can take your agent offline is a
trust layer that gets uninstalled.

- Registry unreachable, slow, or returning nonsense → notice, proceed.
- A response that does not parse → treated as `unknown`, never as `clean`.
- **A cached flag still blocks**, past its TTL, with no network at all. A blip must not un-flag a server
  already known to be bad — and since a hook that exceeds its timeout is killed and the call proceeds with
  no notice, the offline path is the only one that cannot be silenced.
- An unexpected crash → a notice, exit 0.

## Words

Never *safe*, *trusted*, *verified* or *secure*. The word is **reviewed**, and every verdict says what was
reviewed, when, by which model and prompt version, and that **no human audited it**. Reviews are automated.
The appeal process exists because the model can be wrong.

The rule is enforced by a test, not by good intentions — see `packages/core/src/copy.mjs`.

## Zero dependencies, on purpose

There is no `npm install` step when a plugin is installed from a git repo, so the gate cannot have a single
runtime dependency. `packages/core` is vendored into `lib/core/` by `scripts/sync-core.mjs`, and
`pnpm check:sync` fails if the copies have drifted.
