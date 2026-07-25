#!/usr/bin/env bash
# Throwaway probe runner. Drives a headless Claude Code session that has exactly
# one MCP server (ours) and exactly one PreToolUse hook (ours), then prints what
# the hook did and what the model was told.
#
#   ./run.sh deny        deny a real mcp__ tool call, 12-line reason
#   ./run.sh allow-warn  allow + systemMessage (the "unknown" path)
#   ./run.sh long 12000  probe the 10,000-char hook-output cap
#   ./run.sh hang 30     hook exceeds its timeout — fail open or closed?
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:-deny}"
ARG="${2:-}"
TIMEOUT="${HOOK_TIMEOUT:-15}"
OUT="$HERE/.out"
mkdir -p "$OUT"

# Windows-friendly absolute paths for the hook command and the server args.
HERE_WIN="$(cd "$HERE" && pwd -W 2>/dev/null || echo "$HERE")"

cat > "$OUT/mcp.json" <<JSON
{
  "mcpServers": {
    "probe": { "command": "node", "args": ["$HERE_WIN/probe-mcp-server.mjs"] }
  }
}
JSON

cat > "$OUT/settings.json" <<JSON
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "mcp__.*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HERE_WIN/gate-probe.mjs\" $MODE $ARG",
            "timeout": $TIMEOUT
          }
        ]
      }
    ]
  }
}
JSON

STREAM="$OUT/stream-$MODE.jsonl"
: > "$OUT/hook-invocations.jsonl"

# NO_ALLOWLIST=1 drops --allowedTools, so we can see whether the NORMAL
# permission flow still applies when the hook returns no decision.
ALLOW_ARGS=(--allowedTools "mcp__probe__read_notes")
if [ "${NO_ALLOWLIST:-0}" = "1" ]; then
  ALLOW_ARGS=()
  STREAM="$OUT/stream-$MODE-noallowlist.jsonl"
fi

echo "── mode=$MODE arg=${ARG:-none} hook timeout=${TIMEOUT}s allowlist=${NO_ALLOWLIST:-0}"
echo "── settings: $OUT/settings.json"

claude -p "Call the read_notes tool from the probe MCP server, with no arguments. Then tell me in one sentence exactly what happened — if the call was blocked, quote the block message back to me verbatim." \
  --mcp-config "$OUT/mcp.json" \
  --strict-mcp-config \
  --settings "$OUT/settings.json" \
  --setting-sources "" \
  "${ALLOW_ARGS[@]}" \
  --output-format stream-json \
  --include-hook-events \
  --verbose \
  --no-session-persistence \
  > "$STREAM" 2>"$OUT/stderr-$MODE.txt"

echo "── exit=$? stream=$STREAM ($(wc -l < "$STREAM") lines)"
