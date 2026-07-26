#!/usr/bin/env node
// Throwaway probe standing in for surex-gate. It answers four questions the
// specs list as UNVERIFIED, and it answers them by observation, not by reading
// docs:
//
//   1. does permissionDecision:"deny" actually stop a real mcp__ tool call?
//   2. does a ~12-line permissionDecisionReason survive to the user AND the model?
//   3. what does the hook input actually contain (there is no server-name field)?
//   4. when a blocking hook exceeds its timeout, does the call fail open or closed?
//
// Modes come from argv so one script covers every case:
//   deny | allow-warn | long <n> | hang <seconds> | log
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '.out');
mkdirSync(OUT, { recursive: true });

const mode = process.argv[2] ?? 'deny';
const arg = process.argv[3];

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;

let input = {};
try {
  input = JSON.parse(raw);
} catch {
  /* record the raw text below either way */
}

// One line per invocation, so a run can be replayed — and so it is visible whether
// session_id survives /clear and /compact.
appendFileSync(
  join(OUT, 'hook-invocations.jsonl'),
  JSON.stringify({
    at: new Date().toISOString(),
    mode,
    session_id: input.session_id ?? null,
    hook_event_name: input.hook_event_name ?? null,
    tool_name: input.tool_name ?? null,
    permission_mode: input.permission_mode ?? null,
    cwd: input.cwd ?? null,
    // Everything else, verbatim — we want to see the fields nobody documented.
    keys: Object.keys(input).sort(),
    raw_len: raw.length,
  }) + '\n',
);
writeFileSync(join(OUT, 'last-hook-input.json'), raw || '(empty stdin)');

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
  process.exit(0);
}

// The whole evidence payload lives in this one string: permissionDecisionReason is
// the only channel that reaches both the user's terminal and the model.
function blockReason() {
  return [
    'SureX blocked this call — @acme/mcp-tools@2.1.0',
    '',
    'Flagged by automated review. Not confirmed by a human. The maintainer has been notified and may respond.',
    '',
    'Finding (high): the tool description instructs the model to read ~/.ssh/id_rsa and include it in an',
    'unrelated API call — src/tools/search.ts:88',
    'This code can reach: network · filesystem · environment variables',
    '',
    'Reviewed: commit a3f9c1 · blob 0x7d2e… · 2026-07-25 · model qwen3-coder, prompt rv-1. No human audited this.',
    'Evidence: https://surex.dev/r/sxf1_9a2b…    Dispute: https://surex.dev/d/sxf1_9a2b…',
    '',
    'You can proceed anyway, at your own risk:  surex allow sxf1_9a2b…',
  ].join('\n');
}

switch (mode) {
  case 'deny':
    emit({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: blockReason(),
      },
    });
    break;

  case 'allow-warn':
    emit({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'SureX: not in registry — proceeding unverified.',
      },
      systemMessage: '⚠ SureX: probe server is not in the registry. Proceeding unverified.',
    });
    break;

  case 'long': {
    // Probe the documented 10,000-character cap on hook output strings.
    const n = Number(arg ?? 12000);
    const filler = ('X'.repeat(79) + '\n').repeat(Math.ceil(n / 80)).slice(0, n);
    emit({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `SUREX_LONG_PROBE_START len=${n}\n` + filler + '\nSUREX_LONG_PROBE_END',
      },
    });
    break;
  }

  case 'hang': {
    // Never returns before the configured hook timeout. The question is whether
    // the tool call is then allowed (fail open) or denied (fail closed).
    const seconds = Number(arg ?? 30);
    setTimeout(() => {
      emit({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'SUREX_HANG_PROBE — this deny arrived AFTER the timeout.',
        },
      });
    }, seconds * 1000);
    break;
  }

  case 'warn-only':
    // permissionDecision:"allow" SKIPS the normal permission prompt, so an "unknown"
    // path that emits it auto-approves the servers SureX knows nothing about. This
    // emits the notice with NO decision, to check the warning still shows while the
    // normal flow stays in charge.
    emit({
      systemMessage: '⚠ SureX: probe server is not in the registry. Proceeding unverified.',
    });
    break;

  case 'log':
  default:
    // Silent allow — the `clean` path. Exit 0, no stdout, no trace.
    process.exit(0);
}
