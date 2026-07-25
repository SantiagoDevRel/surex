# `probes/hook` — throwaway proofs of the enforcement surface

Not feature code. These exist to answer, by observation, the questions the specs list as UNVERIFIED
before a line of the real gate gets written. Findings are written up in the repo's
[`FRICTION-LOG.md`](../../FRICTION-LOG.md) under **Claude Code**, entries C1–C5.

```
probe-mcp-server.mjs   minimal zero-dependency stdio MCP server, one tool
gate-probe.mjs         stands in for surex-gate; mode comes from argv
run.sh                 drives headless `claude -p --include-hook-events`
.out/                  captured streams and raw hook payloads (gitignored)
```

## Run

```bash
bash run.sh deny            # deny a real mcp__ call with a 12-line reason
bash run.sh long 12000      # probe the documented 10,000-char output cap
HOOK_TIMEOUT=5 run.sh hang 20   # hook exceeds its timeout — open or closed?
bash run.sh allow-warn      # permissionDecision:"allow" + systemMessage
bash run.sh warn-only       # systemMessage ONLY, no decision
bash run.sh log             # silent allow: exit 0, no stdout

NO_ALLOWLIST=1 bash run.sh <mode>   # drop --allowedTools, so the run shows
                                    # whether the NORMAL permission flow still applies
```

`--strict-mcp-config` and `--setting-sources ""` keep the probe hermetic: the session sees exactly one MCP
server and exactly one hook, and nothing from the user's real configuration leaks in.

## What was established

| Question | Answer | Mode |
|---|---|---|
| Does `deny` stop a real `mcp__` call? | yes | `deny` |
| Does a 12-line reason reach the model intact? | yes, verbatim, newlines preserved | `deny` |
| Is the reason truncated at 10,000 chars? | **no** — 12,054 arrived complete | `long 12000` |
| Is a very long reason still *usable*? | **no** — the model stopped reading it as a block | `long 12000` |
| Timeout on a blocking hook: open or closed? | **open** — `cancelled`, and the tool runs | `hang` |
| Does `permissionDecision:"allow"` bypass the prompt? | **yes** — it grants, it does not merely permit | `allow-warn` + `NO_ALLOWLIST=1` |
| Does `systemMessage` alone preserve the normal flow? | yes | `warn-only` + `NO_ALLOWLIST=1` |
| Does silent exit 0 preserve the normal flow? | yes | `log` + `NO_ALLOWLIST=1` |

The last three are why the gate's **unknown** path emits `systemMessage` only and never a decision. Emitting
`allow` there would auto-approve exactly the servers SureX knows nothing about — strictly worse than not
installing it.

## The one thing still open: `session_id` across `/clear` and `/compact`

Both commands are interactive-only, so `claude -p` cannot exercise them. The current answer —
survives `/compact`, resets on `/clear` — is inferred from transcript layout under
`~/.claude/projects/<slug>/`, not from a hook watching itself. See FRICTION-LOG C5.

To settle it directly, in about thirty seconds:

```bash
cd probes/hook
claude          # interactive, in THIS directory
```

then, in the session: call the probe tool → `/compact` → call it again → `/clear` → call it again. Each
call appends a line to `.out/hook-invocations.jsonl`. Compare the `session_id` values. The
`.claude/settings.json` in this directory registers the logging hook, so nothing else needs setting up.
