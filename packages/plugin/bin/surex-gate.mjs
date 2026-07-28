#!/usr/bin/env node
// The hook entry point. Registered on PreToolUse (matcher `mcp__.*`) and on
// SessionStart by hooks/hooks.json.
//
// Every failure path must warn and exit 0 — a killed hook lets the call through
// with no notice at all (FRICTION-LOG C1).

import { readInput, runGate, runPrefetch } from '../lib/gate.mjs';

const mode = process.argv[2] ?? 'gate';

// A self-imposed deadline, well inside the hook timeout: being killed is silent, this is not.
const SELF_DEADLINE_MS = Number(process.env.SUREX_GATE_DEADLINE_MS || 8000);
const deadline = setTimeout(() => {
  process.stdout.write(
    JSON.stringify({
      systemMessage: '⚠ SureX: the lookup took too long and was abandoned. Proceeding unreviewed.',
    }),
  );
  process.exit(0);
}, SELF_DEADLINE_MS);
deadline.unref?.();

try {
  const input = await readInput();
  if (mode === 'prefetch') {
    await runPrefetch(input);
  } else {
    await runGate(input);
  }
} catch (err) {
  process.stdout.write(
    JSON.stringify({
      systemMessage: `⚠ SureX: the gate failed (${err?.message ?? 'unknown error'}). Proceeding unreviewed.`,
    }),
  );
  process.exit(0);
}
