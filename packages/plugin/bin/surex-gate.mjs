#!/usr/bin/env node
// The hook entry point. Registered on PreToolUse (matcher `mcp__.*`) and on
// SessionStart by hooks/hooks.json.
//
// Nothing that happens in here may prevent a tool call from being decided. Any
// unexpected failure warns and proceeds — a SureX outage must never become a
// total agent outage, and a hook that dies quietly is worse than one that fails
// out loud, because a killed hook lets the call through with no notice at all
// (FRICTION-LOG C1).

import { readInput, runGate, runPrefetch } from '../lib/gate.mjs';

const mode = process.argv[2] ?? 'gate';

// A hard self-imposed deadline, well inside the configured hook timeout. If we
// are still thinking when it fires, say so and get out of the way rather than
// be killed silently.
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
