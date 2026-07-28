#!/usr/bin/env node
// The demo, rehearsed: drive the real gate against the live registry, once per
// branch of decide().
//
//   node scripts/demo-gate.mjs
//   SUREX_API_URL=http://127.0.0.1:8787 node scripts/demo-gate.mjs   # against a local API
//
// Not a test — `packages/plugin/test/gate.test.mjs` is, and it stubs the registry so
// it can assert. This runs the shipped hook binary as a child process with a real MCP
// config on disk, against the deployed registry, and prints what Claude Code would
// receive: that the gate identifies each server from configuration alone (it never
// starts one to ask what it is), resolves a verdict, and emits the right decision —
// nothing, a systemMessage, or `permissionDecision: 'ask'`.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { entryOf } from './lib/server-source.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GATE = join(ROOT, 'packages', 'plugin', 'bin', 'surex-gate.mjs');
const API = process.env.SUREX_API_URL || 'https://arkiv-surex-api.vercel.app';

/**
 * The three, in demo order. `key` becomes the MCP server name, so the tool call is
 * `mcp__<key>__<tool>` — underscores only, the gate parses the server out of the name.
 */
const DEMO = [
  { key: 'good_weather',  dir: 'honest-weather',       expect: 'allow' },
  { key: 'mid_telemetry', dir: 'ambiguous-telemetry',  expect: 'warn'  },
  { key: 'bad_shadow',    dir: 'mal-tool-shadow',      expect: 'ask'   },
];

const sandbox = mkdtempSync(join(tmpdir(), 'surex-demo-'));
const home = join(sandbox, 'home');
const project = join(sandbox, 'project');
mkdirSync(home, { recursive: true });
mkdirSync(project, { recursive: true });

// The install configuration, exactly as a developer would have it: `node <entry>`.
// The fingerprint is computed over this, so the entry path must be the real fixture
// rather than a copy.
const mcpServers = {};
for (const d of DEMO) {
  // `entryOf`, not a hardcoded `server.mjs` — mal-tool-shadow keeps its entry at
  // `src/server.mjs`, and a config pointing at a missing file makes the gate answer
  // `local-entry-unreadable` and refuse to look anything up.
  const entry = entryOf(join(ROOT, 'packages', 'fixtures', d.dir));
  if (!entry) throw new Error(`no entry point found for ${d.dir}`);
  mcpServers[d.key] = { command: 'node', args: [entry] };
}
writeFileSync(join(project, '.mcp.json'), JSON.stringify({ mcpServers }, null, 2));
// An empty user config: without it the gate walks the real machine's.
writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: {}, projects: {} }));

function runGate(toolName) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [GATE], {
      env: {
        ...process.env,
        SUREX_API_URL: API,
        CLAUDE_PLUGIN_DATA: join(sandbox, 'data', toolName),
        HOME: home,
        USERPROFILE: home,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => { stdout += b; });
    child.stderr.on('data', (b) => { stderr += b; });
    child.on('close', (code) => res({ code, stdout, stderr }));
    child.stdin.write(JSON.stringify({
      session_id: `demo-${toolName}`,
      cwd: project,
      hook_event_name: 'PreToolUse',
      tool_name: toolName,
    }));
    child.stdin.end();
  });
}

/** What Claude Code would actually do with this payload. */
function decisionOf(out) {
  if (!out.trim()) return 'allow (silent)';
  let parsed;
  try { parsed = JSON.parse(out); } catch { return `UNPARSEABLE: ${out.slice(0, 120)}`; }
  const d = parsed.hookSpecificOutput?.permissionDecision;
  if (d) return d;
  if (parsed.systemMessage) return 'warn (notice, no decision)';
  return 'nothing';
}

console.log(`# the gate, against ${API}\n`);
let failures = 0;

for (const d of DEMO) {
  const tool = `mcp__${d.key}__do_thing`;
  const { code, stdout, stderr } = await runGate(tool);
  const decision = decisionOf(stdout);

  const ok =
    (d.expect === 'allow' && decision === 'allow (silent)') ||
    (d.expect === 'warn' && decision.startsWith('warn')) ||
    (d.expect === 'ask' && decision === 'ask');
  if (!ok) failures += 1;

  console.log(`${ok ? '✓' : '✗'} ${d.dir.padEnd(22)} expected ${d.expect.padEnd(5)} got ${decision}`);
  console.log(`    exit ${code}${code === 0 ? '' : '  ← a hook must always exit 0; non-zero is non-blocking'}`);

  if (stdout.trim()) {
    const parsed = JSON.parse(stdout);
    const text = parsed.hookSpecificOutput?.permissionDecisionReason ?? parsed.systemMessage ?? '';
    for (const line of text.split('\n')) console.log(`    │ ${line}`);
  }
  if (stderr.trim()) console.log(`    stderr: ${stderr.trim().slice(0, 200)}`);
  console.log('');
}

rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });

console.log(failures ? `${failures} of ${DEMO.length} did not behave as the demo needs.` : 'all three behave as the demo needs.');
process.exit(failures ? 1 : 0);
