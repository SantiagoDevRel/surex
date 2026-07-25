import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { discoverServers, expandVars, findServer } from '../lib/config.mjs';
import { identify } from '../lib/gate.mjs';
import { findLocalIntegrity } from '../lib/integrity.mjs';
import { cacheGet, cachePut, addOverride, isOverridden, removeOverride } from '../lib/store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, '..', 'bin', 'surex-gate.mjs');

let sandbox;
let home;
let project;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'surex-test-'));
  home = join(sandbox, 'home');
  project = join(sandbox, 'work', 'repo');
  mkdirSync(home, { recursive: true });
  mkdirSync(join(project, 'nested', 'deep'), { recursive: true });

  writeFileSync(
    join(home, '.claude.json'),
    JSON.stringify({
      mcpServers: {
        shared: { command: 'npx', args: ['-y', 'shared-mcp@1.0.0'] },
        overridden: { command: 'npx', args: ['-y', 'user-version@1.0.0'] },
      },
      projects: {
        [project.replace(/\\/g, '/')]: {
          mcpServers: { local_only: { command: 'npx', args: ['-y', 'local-mcp@3.0.0'] } },
          disabledMcpjsonServers: ['declined'],
        },
      },
    }),
  );

  writeFileSync(
    join(project, '.mcp.json'),
    JSON.stringify({
      mcpServers: {
        overridden: { command: 'npx', args: ['-y', 'project-version@2.0.0'] },
        declined: { command: 'npx', args: ['-y', 'never-approved@1.0.0'] },
        remote: { type: 'http', url: 'https://mcp.example.com/v1' },
      },
    }),
  );
});

after(() => {
  try { rmSync(sandbox, { recursive: true, force: true }); } catch { /* windows file locks */ }
});

test('scopes are ordered, and the winner takes the name ENTIRELY', () => {
  const { servers } = discoverServers(project, { homedir: home });
  const byName = Object.fromEntries(servers.map((s) => [s.name, s]));

  assert.equal(byName.local_only.scope, 'local');
  assert.equal(byName.remote.scope, 'project');
  assert.equal(byName.shared.scope, 'user');
  // .mcp.json beats user scope for a colliding name…
  assert.equal(byName.overridden.scope, 'project');
  // …and it is not merged: the losing definition contributes nothing.
  assert.deepEqual(byName.overridden.def.args, ['-y', 'project-version@2.0.0']);
});

test('a server the user declined is not a server we have anything to say about', () => {
  const { servers } = discoverServers(project, { homedir: home });
  assert.ok(!servers.some((s) => s.name === 'declined'));
});

test('config is found from a nested working directory, not just the project root', () => {
  const { servers } = discoverServers(join(project, 'nested', 'deep'), { homedir: home });
  assert.ok(servers.some((s) => s.name === 'remote'), 'walked up to .mcp.json');
  assert.ok(servers.some((s) => s.name === 'local_only'), 'walked up to the projects key');
});

test('${VAR} expands, and an UNSET variable is left alone rather than blanked', () => {
  assert.equal(expandVars('${SUREX_T}', { SUREX_T: 'x' }), 'x');
  assert.equal(expandVars('${SUREX_MISSING:-fallback}', {}), 'fallback');
  // Blanking would silently merge two different servers onto one fingerprint.
  assert.equal(expandVars('${SUREX_MISSING}', {}), '${SUREX_MISSING}');
});

test('identify() turns a tool_name into a fingerprint through config alone', () => {
  const id = identify('mcp__local_only__do_thing', project, { homedir: home });
  assert.match(id.fingerprint, /^sxf1_[0-9a-f]{64}$/);
  assert.equal(id.displayName, 'local-mcp@3.0.0');
  assert.equal(id.canonical.package.name, 'local-mcp');
});

test('identify() reports WHY it could not, instead of guessing', () => {
  assert.equal(identify('Bash', project, { homedir: home }).reason, 'not-an-mcp-tool');
  assert.equal(identify('mcp__nowhere__x', project, { homedir: home }).reason, 'config-not-found');
  // A plugin-provided server's config lives inside that plugin. Naming it and
  // admitting we cannot fingerprint it beats producing a wrong fingerprint,
  // which would read as `unknown` — indistinguishable from a real miss.
  assert.equal(identify('mcp__plugin_acme_srv__x', project, { homedir: home }).reason, 'plugin-provided');
});

test('a cached flag survives its TTL; a cached clean does not', () => {
  const dataDir = join(sandbox, 'data-cache');
  process.env.CLAUDE_PLUGIN_DATA = dataDir;
  const t0 = 1_000_000;
  const fpFlagged = `sxf1_${'a'.repeat(64)}`;
  const fpClean = `sxf1_${'b'.repeat(64)}`;

  cachePut(fpFlagged, { fingerprint: fpFlagged, state: 'flagged', severity: 4 },
    { ttlMs: 1000, graceMs: 60_000, now: t0 });
  cachePut(fpClean, { fingerprint: fpClean, state: 'clean', severity: 0 },
    { ttlMs: 1000, graceMs: 0, now: t0 });

  assert.equal(cacheGet(fpFlagged, t0 + 500)?.stale, false);
  // Past the TTL, inside the grace: still returned, marked stale. A network
  // blip must not un-flag a server we already know is bad.
  assert.equal(cacheGet(fpFlagged, t0 + 5000)?.stale, true);
  assert.equal(cacheGet(fpFlagged, t0 + 500_000), null, 'grace is finite');
  // A clean verdict earns no grace — it must be re-checked.
  assert.equal(cacheGet(fpClean, t0 + 5000), null);
});

test('overrides are per-machine or per-session, and revocable', () => {
  process.env.CLAUDE_PLUGIN_DATA = join(sandbox, 'data-override');
  const fp = `sxf1_${'c'.repeat(64)}`;
  assert.equal(isOverridden(fp, 'sess-1'), null);

  addOverride(fp, { once: true, sessionId: 'sess-1' });
  assert.equal(isOverridden(fp, 'sess-1')?.scope, 'session');
  assert.equal(isOverridden(fp, 'sess-2'), null, 'a --once override must not leak into another session');

  addOverride(fp, {});
  assert.equal(isOverridden(fp, 'sess-2')?.scope, 'always');
  assert.ok(removeOverride(fp));
  assert.equal(isOverridden(fp, 'sess-2'), null);
});

test('integrity is read from a real lockfile layout, and absence is reported as absence', () => {
  const root = join(sandbox, 'lockfile-project');
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, 'package-lock.json'),
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        'node_modules/some-mcp': { version: '1.2.3', integrity: 'sha512-DEADBEEF==' },
      },
    }),
  );
  const hit = findLocalIntegrity('some-mcp', '1.2.3', { cwd: root, homedir: home });
  assert.equal(hit.integrity, 'sha512-DEADBEEF==');
  assert.equal(hit.layout, 'package-lock.json');

  // The wrong version must not match — that is the entire point of the check.
  assert.equal(findLocalIntegrity('some-mcp', '9.9.9', { cwd: root, homedir: home }).integrity, null);

  const miss = findLocalIntegrity('not-installed', '1.0.0', { cwd: root, homedir: home });
  assert.equal(miss.integrity, null);
  assert.ok(miss.searched.length > 0, 'it must be able to say where it looked');
});

// ─── the three hook outcomes, end to end through the real binary ────────────

function runGateProcess(input, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [GATE], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(input));
  });
}

let api;
let apiUrl;
const FLAGGED_FP = { value: null };

before(async () => {
  // A stand-in registry, so the gate's three outcomes are exercised for real
  // rather than by mocking the module that decides them.
  api = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const fp = url.searchParams.get('fp');
    res.setHeader('content-type', 'application/json');
    if (fp === FLAGGED_FP.value) {
      res.end(JSON.stringify({
        fingerprint: fp, state: 'flagged', severity: 4, tier: 'B',
        name: 'local-mcp@3.0.0', reviewedCommit: 'abc1234', reviewedAt: '2026-07-25',
        modelId: 'test-model', promptVersion: 'rv-1',
        topFinding: { file: 'src/x.ts', line: 88, severity: 3, description: 'reads a credential file it never declares' },
        capabilities: { network: { present: true }, filesystem: { present: true } },
      }));
      return;
    }
    res.end(JSON.stringify({ fingerprint: fp, state: 'unknown', severity: 0, tier: 'C' }));
  });
  await new Promise((r) => api.listen(0, r));
  apiUrl = `http://127.0.0.1:${api.address().port}`;
});

after(() => api?.close());

test('STOP: a flagged server halts the call and asks the human, case in one string', async () => {
  const id = identify('mcp__local_only__do_thing', project, { homedir: home });
  FLAGGED_FP.value = id.fingerprint;

  const { code, stdout } = await runGateProcess(
    { session_id: 's1', cwd: project, hook_event_name: 'PreToolUse', tool_name: 'mcp__local_only__do_thing' },
    { SUREX_API_URL: apiUrl, CLAUDE_PLUGIN_DATA: join(sandbox, 'data-block'), HOME: home, USERPROFILE: home },
  );
  assert.equal(code, 0, 'a hook must always exit 0; a non-zero exit is non-blocking');
  const out = JSON.parse(stdout);
  // `ask`, not `deny`, since 2026-07-25. BOTH stop the call — nothing runs on an
  // `ask` until a person answers — and the difference is who ends it. A finding
  // from one unaudited model has earned the right to stop a call; it has not
  // earned the right to be the last word on somebody else's machine, and a gate
  // that cannot be answered is one developers uninstall (AGENTS.md §4).
  //
  // What must NEVER appear here is 'allow', which GRANTS the call outright and
  // bypasses the normal permission prompt (FRICTION-LOG C2).
  assert.equal(out.hookSpecificOutput.permissionDecision, 'ask');
  assert.notEqual(out.hookSpecificOutput.permissionDecision, 'allow');
  const reason = out.hookSpecificOutput.permissionDecisionReason;
  // A question, because Claude Code is showing the human a prompt. Announcing a
  // block while they are being asked would describe a product we do not ship.
  assert.match(reason, /Are you sureX you want to use/);
  assert.match(reason, /does not recommend proceeding/);
  assert.match(reason, /reads a credential file it never declares/);
  assert.match(reason, /src\/x\.ts:88/);
  assert.match(reason, /No human audited this/);
  // The override must be present and must be an invocation that EXISTS on this
  // machine — bare `surex` is not on PATH from a marketplace install
  // (FRICTION-LOG C7), so the gate prints the resolved absolute form there.
  assert.match(reason, new RegExp(`allow ${id.fingerprint}`), 'every block prints the override');
  assert.match(reason, /at your own risk/, 'and says whose risk it is');
});

test('WARN: an unknown server gets a notice and NO permission decision', async () => {
  FLAGGED_FP.value = null;
  const { code, stdout } = await runGateProcess(
    { session_id: 's2', cwd: project, hook_event_name: 'PreToolUse', tool_name: 'mcp__local_only__do_thing' },
    { SUREX_API_URL: apiUrl, CLAUDE_PLUGIN_DATA: join(sandbox, 'data-warn'), HOME: home, USERPROFILE: home },
  );
  assert.equal(code, 0);
  const out = JSON.parse(stdout);
  assert.match(out.systemMessage, /not in the registry/);
  // The one that matters: emitting permissionDecision:"allow" here would GRANT
  // the call outright (FRICTION-LOG C2), auto-approving exactly the servers we
  // know nothing about.
  assert.equal(out.hookSpecificOutput, undefined, 'the unknown path must never carry a decision');
});

test('OFFLINE: an unreachable registry warns and proceeds — it never fails closed', async () => {
  const { code, stdout } = await runGateProcess(
    { session_id: 's3', cwd: project, hook_event_name: 'PreToolUse', tool_name: 'mcp__local_only__do_thing' },
    { SUREX_API_URL: 'http://127.0.0.1:1', CLAUDE_PLUGIN_DATA: join(sandbox, 'data-offline'), HOME: home, USERPROFILE: home },
  );
  assert.equal(code, 0);
  const out = JSON.parse(stdout);
  assert.match(out.systemMessage, /could not reach the registry/);
  assert.equal(out.hookSpecificOutput, undefined);
});

test('a non-MCP tool is not our business: silent, no stdout at all', async () => {
  const { code, stdout } = await runGateProcess(
    { session_id: 's4', cwd: project, hook_event_name: 'PreToolUse', tool_name: 'Bash' },
    { SUREX_API_URL: apiUrl, CLAUDE_PLUGIN_DATA: join(sandbox, 'data-bash'), HOME: home, USERPROFILE: home },
  );
  assert.equal(code, 0);
  assert.equal(stdout, '');
});

test('a malformed hook payload cannot break a tool call', async () => {
  const child = spawn(process.execPath, [GATE], {
    env: { ...process.env, CLAUDE_PLUGIN_DATA: join(sandbox, 'data-bad') },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.on('data', (d) => (stdout += d));
  child.stdin.end('not json at all');
  const code = await new Promise((r) => child.on('close', r));
  assert.equal(code, 0);
  if (stdout) assert.equal(JSON.parse(stdout).hookSpecificOutput, undefined);
});
