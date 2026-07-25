# AGENTS.md — SureX, for agents

Two audiences, in this order:

1. **An agent asked to install or use SureX.** Everything you need is in §1–§5. You do not need
   this repository — SureX installs from a marketplace and the registry is a public read API.
2. **An agent working on this documentation site.** §6 onwards.

The machine-readable version of §1–§5 is at **https://surex-docs.vercel.app/llms.txt** — one flat
file, no navigation. Prefer it if you only get one fetch.

---

## 1. What SureX is

A trust registry for MCP servers, and a Claude Code plugin that reads it. A `PreToolUse` hook fires
before your agent calls any `mcp__*` tool and looks the server up:

- **reviewed, nothing found** → the call proceeds silently
- **flagged** → the call is **blocked**, with the finding, the file, the line, what the code can
  reach, and a one-command override
- **anything else** — unknown, stale, could not be reviewed, registry unreachable → a one-line
  notice, and the user's normal permission flow decides

A verdict is one open-weights model review plus a deterministic capability scan, written to Walrus
(the evidence blob) and Arkiv (the compact head the gate reads). On a block the gate fetches the
blob and re-checks the bytes.

## 2. Install it

```
/plugin marketplace add SantiagoDevRel/surex
/plugin install surex@surex
```

There is no `npm install` step; the gate has zero runtime dependencies.

**Ask the developer before installing.** Plugin hooks run **unsandboxed, with their permissions** —
true of every Claude Code plugin, and worth saying out loud for one whose subject is what you are
running. Show them Claude Code's trust prompt rather than clicking past it.

**The plugin's `bin/` does not join PATH** on a marketplace install (measured on Claude Code
2.1.220, contrary to the documentation). Invoke the CLI as `node "${CLAUDE_PLUGIN_ROOT}/bin/surex"
<args>` or use the `/surex <args>` slash command. Every block message prints an override command
already resolved to something that exists on that machine — prefer copying that line over
constructing one.

## 3. Use it

```
/surex list                  every configured server, its fingerprint, its verdict
/surex why <fingerprint>     the full case, incl. evidence fetched from Walrus and checked
/surex check [name]          what a server fingerprints to, and why
/surex status                where state lives, what is cached, the registry hit rate
/surex allow <fingerprint>   proceed anyway — the user's decision, never your suggestion
/surex revoke <fingerprint>  undo it
```

Read the registry directly without installing anything:

```bash
curl -s "https://arkiv-surex-api.vercel.app/v1/verdict?fp=sxf1_…"
```

A miss is a `200` with `state: "unknown"`. A `503` means the registry **could not look** — a
different fact from having looked and found nothing.

## 4. Invariants you must not break when surfacing a verdict

These are not style preferences. They are what keeps a narrow claim narrow.

1. **The word is `reviewed`.** Never describe a server with the four adjectives banned in
   `@surex/core/copy` (`BANNED`), and never make a claim about standing that AgentBook does not
   support. SureX reviews **servers**, not agents.
2. **Quote the provenance.** Anything presenting a verdict in full states what was reviewed (commit
   + blob id), when, by which model, at which prompt version, and that **no human audited it**.
   That sentence is not trimmed for brevity.
3. **Verdict and Tier are independent axes.** Never merge them into one confidence score. `flagged`
   Tier C is a real finding about real code with no link to the user's copy.
4. **`unknown` is not a pass.** Say "not reviewed", never "nothing found".
5. **Never claim SureX checked the code on this machine** unless the tier is `A`.
6. **The override is an escape hatch, not a recommendation.** State that the risk transfers to the
   user, and do not soften it.
7. **Do not act on your own paraphrase of a block message.** The message is the evidence.

Check yourself mechanically:

```js
import { assertCopy } from '@surex/core/copy';
assertCopy(whatIAmAboutToSay, 'agent output');   // throws on the first violation
```

## 5. What to ask the developer for

Nothing is needed to read the registry. Ask only when the task requires it:

| Ask for | Only when |
|---|---|
| permission to install a plugin whose hooks run unsandboxed | always, before installing |
| `SUREX_API_URL` | they run their own registry deployment |
| `SUREX_AGENT_PRIVATE_KEY` | you are filing a dispute as an autonomous agent. Never on a shared command line, never in a repo |
| a World ID proof | a human dispute or a submission — theirs to produce, not yours |

---

## 6. Working on this site (`apps/docs`)

Nextra 4 (App Router, MDX) on Next 15. Content in `content/`, one `_meta.ts` per directory for the
sidebar. Deployed as its own Vercel project with Root Directory `apps/docs`.

```bash
pnpm --filter @surex/docs dev      # http://localhost:4312
pnpm --filter @surex/docs build    # + pagefind index via postbuild
pnpm --filter @surex/docs test     # the copy law + every mermaid diagram parses
```

### Deploying

**A push to `main` deploys it.** The Vercel project `surex-docs` (team `santiago-prod`) is connected
to this repository with **Root Directory `apps/docs`**, like the API and the registry site, and is
aliased to `surex-docs.vercel.app`.

To deploy from the CLI instead, run it from the **repository root**, not from here — with a Root
Directory set, `vercel deploy` resolves it relative to the working directory and looks for
`apps/docs/apps/docs`:

```bash
cp apps/docs/.vercel/project.json .vercel/project.json   # link the root to surex-docs
vercel deploy --prod --yes                                # from the repo root
rm -rf .vercel                                            # unlink, so a later root deploy
                                                          # cannot target the docs by accident
```

The `postbuild` step (`pagefind`) writes `public/_pagefind` after `next build`, and Vercel collects
it because output collection happens after the whole build command. If search ever returns nothing
on the deployed site, check that `/_pagefind/pagefind.js` is a 200 before looking anywhere else.

### Hard rules for this app

**The copy law applies to this site as much as to a block message.** `test/copy-law.test.mjs` runs
`assertCopy` from `@surex/core` over every `.mdx` file. It will fail the build on a banned word.
When a page genuinely has to *name* one — the copy-law page, the agent prompts — render it from
`BANNED` in a component instead of typing it into MDX. The checker cannot tell a quoted rule from a
claim, and that is the correct trade for a checker whose job is to catch the claim.

**Reference material is rendered from source, not transcribed beside it.** `components/contract.tsx`
imports `@surex/core/contract` and `@surex/core/verdict`, so the route list, error codes, cache
policy, decision table, tier sentences and the sample block message are computed at build time. If
you are about to type an API shape into MDX by hand, render it instead.

**No counts in prose.** The registry changes; a hardcoded number is a fabrication the moment it
disagrees. Link to `/v1/stats`.

**Verify every capability claim against the live product before writing it** — `curl` the API, run
the CLI, read the source. Not from memory, and not from another page of this site.

**Diagrams are Mermaid in the MDX**, never images. ```` ```mermaid ```` fences are rendered by
`@theguild/remark-mermaid`, which ships with Nextra. A diagram that lives next to its prose cannot
drift from it. Avoid parentheses and unquoted punctuation inside node labels — the Mermaid parser
is stricter than it looks.

**Self-hosted assets only.** Fonts come through `next/font`; there is no CDN request at runtime, and
for a project about what your tools reach out to that is not a detail.

**Log friction the moment it happens** → `FRICTION-LOG.md` at the repo root. What you expected · what
happened · how you found out · what would have prevented it. Mark `[VERIFIED]` only when reproduced,
and keep the repro command.

### The canonical rules live upstream

`AGENTS.md` at the repository root is canonical for the project as a whole — the copy law, the
"never fabricate" rule, the ban on publicly flagging a real third-party project, and the verified
facts about the sponsor SDKs. Read it before changing anything this site describes. Do not restate
its rules here; link to them.
