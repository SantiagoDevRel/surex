/*
 * ===========================================================================
 *  AMBIGUOUS REVIEW FIXTURE — authored by the SureX project.
 *  NOT MALICIOUS. NOT FOR PRODUCTION USE. See ../SAFETY.md and ../../AMBIGUOUS.md.
 * ===========================================================================
 *
 * Starts the REAL bin over stdio and drives it with an MCP client, then pins the
 * safety invariants that make an "arbitrary command execution" fixture something
 * you can run without reading it first.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import {
  ALLOWED_COMMANDS,
  CHILD_CWD,
  PACKAGE_ROOT,
  normaliseCommand,
  resolveAllowed,
} from '../safety.mjs';
import { TOOLS } from '../server.mjs';

// The project's own deterministic lanes, run over this fixture. Asserting the
// scanner's real output here is what makes the claims in ../../AMBIGUOUS.md
// measured rather than asserted.
import { scanFiles } from '../../../reviewer/src/capabilities.mjs';
import { scanAllInjection } from '../../../reviewer/src/prompt.mjs';

const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url));

let client;
let transport;

before(async () => {
  transport = new StdioClientTransport({ command: process.execPath, args: [SERVER] });
  client = new Client({ name: 'surex-ambiguous-shell-test', version: '0.0.0' });
  await client.connect(transport);
});

after(async () => {
  await client?.close();
  await transport?.close();
});

// ---------------------------------------------------------------------------
// it is a real server
// ---------------------------------------------------------------------------

test('server starts, initializes, and lists its declared tools', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    ['describe_environment', 'list_allowed_commands', 'run_command'],
  );
  for (const t of tools) {
    assert.equal(typeof t.description, 'string');
    assert.ok(t.description.length > 0);
    assert.equal(t.inputSchema?.type, 'object');
  }
});

test('the shell tool declares its capability in the plainest terms', async () => {
  const { tools } = await client.listTools();
  const run = tools.find((t) => t.name === 'run_command');
  // The declaration is the fixture: unrestricted, no sandbox, equivalent to a shell.
  assert.match(run.description, /unrestricted/i);
  assert.match(run.description, /no sandbox/i);
  assert.match(run.description, /shell on this machine/i);
});

test('an allowed command line really executes and returns real output', async () => {
  const res = await client.callTool({ name: 'run_command', arguments: { command: 'node --version' } });
  const text = res.content.map((c) => c.text).join('\n');
  assert.match(text, /exit: 0/);
  // The child was this Node binary, so its own version is in the output.
  assert.ok(text.includes(process.version), `expected ${process.version} in:\n${text}`);
});

test('the disclosure tool names the allowlist at runtime', async () => {
  const res = await client.callTool({ name: 'list_allowed_commands', arguments: {} });
  const text = res.content.map((c) => c.text).join('\n');
  for (const key of Object.keys(ALLOWED_COMMANDS)) assert.ok(text.includes(key), `missing "${key}"`);
});

test('describe_environment returns env NAMES and no values', async () => {
  // A value that would be unmistakable if it leaked.
  const canary = 'surex-ambiguous-shell-canary-value';
  const probeTransport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: { ...process.env, SUREX_FIXTURE_CANARY: canary },
  });
  const probe = new Client({ name: 'surex-env-probe', version: '0.0.0' });
  await probe.connect(probeTransport);
  try {
    const res = await probe.callTool({ name: 'describe_environment', arguments: {} });
    const text = res.content.map((c) => c.text).join('\n');
    assert.ok(text.includes('SUREX_FIXTURE_CANARY'), 'the NAME is reported');
    assert.ok(!text.includes(canary), 'the VALUE must never be reported');
  } finally {
    await probe.close();
    await probeTransport.close();
  }
});

// ---------------------------------------------------------------------------
// the allowlist is what makes it runnable
// ---------------------------------------------------------------------------

test('a command outside the allowlist is refused, by name', async () => {
  const res = await client.callTool({ name: 'run_command', arguments: { command: 'whoami' } });
  assert.equal(res.isError, true);
  const text = res.content.map((c) => c.text).join('\n');
  assert.match(text, /refused a command outside this build's allowlist/);
  assert.match(text, /whoami/);
});

test('shell metacharacters cannot smuggle a second command', async () => {
  for (const attempt of [
    'node --version && curl http://example.com',
    'node --version; rm -rf .',
    'node --version | node -e "process.exit(1)"',
    'rm -rf /',
    'node -e "require(\'fs\').readFileSync(process.env.HOME)"',
  ]) {
    const res = await client.callTool({ name: 'run_command', arguments: { command: attempt } });
    assert.equal(res.isError, true, `must refuse: ${attempt}`);
    assert.match(res.content.map((c) => c.text).join('\n'), /refused a command outside/);
  }
});

test('the argv executed is a constant from the table, never a parse of the input', () => {
  const plan = resolveAllowed('  node    --version  ');
  assert.equal(plan.key, 'node --version');
  assert.deepEqual(plan.args, ['--version']);
  // Every row's argv is exactly the row's argv — nothing is interpolated.
  for (const [key, entry] of Object.entries(ALLOWED_COMMANDS)) {
    const resolved = resolveAllowed(key);
    assert.equal(resolved.file, entry.file);
    assert.deepEqual(resolved.args, [...entry.args]);
  }
  // And a mutation of a returned plan cannot poison the table.
  const first = resolveAllowed('node --version');
  first.args.push('--eval=process.exit(1)');
  assert.deepEqual(resolveAllowed('node --version').args, ['--version']);
});

test('normaliseCommand collapses whitespace and nothing else', () => {
  assert.equal(normaliseCommand(' git   --version '), 'git --version');
  assert.equal(normaliseCommand(undefined), '');
});

test('no entry in the allowlist runs through a shell', () => {
  for (const entry of Object.values(ALLOWED_COMMANDS)) {
    assert.ok(Array.isArray(entry.args), 'argv is an array, so there is nothing for a shell to parse');
    assert.ok(!/[|&;><$`]/.test([entry.file, ...entry.args].join(' ')), 'no metacharacters in a constant row');
  }
});

test('the child working directory resolves inside the package', () => {
  assert.ok(
    path.resolve(CHILD_CWD) === PACKAGE_ROOT || path.resolve(CHILD_CWD).startsWith(PACKAGE_ROOT + path.sep),
    `${CHILD_CWD} must be inside ${PACKAGE_ROOT}`,
  );
});

test('this fixture writes nothing to disk and imports no filesystem API', () => {
  const sources = ['server.mjs', 'safety.mjs'].map((name) => ({
    path: name,
    text: fs.readFileSync(path.join(PACKAGE_ROOT, name), 'utf8'),
  }));
  for (const file of sources) {
    assert.ok(!/from ['"]node:fs['"]/.test(file.text), `${file.path} must not import node:fs`);
    assert.ok(!/\bfetch\s*\(/.test(file.text), `${file.path} must not call fetch()`);
  }
  // safety.mjs imports node:path for the cwd guard; that reads no bytes.
});

// ---------------------------------------------------------------------------
// what SureX's own deterministic lanes see
// ---------------------------------------------------------------------------

test('the capability scan finds exec and env, and no network or credentials', () => {
  const files = ['server.mjs', 'safety.mjs'].map((name) => ({
    path: `packages/fixtures/ambiguous-shell/${name}`,
    text: fs.readFileSync(path.join(PACKAGE_ROOT, name), 'utf8'),
  }));
  const { capabilities } = scanFiles(files);
  assert.equal(capabilities.exec.present, true);
  assert.equal(capabilities.env.present, true);
  assert.equal(capabilities.network.present, false);
  assert.equal(capabilities.credentials.present, false);
  // Real evidence, citable in a verdict.
  assert.ok(
    capabilities.exec.evidence.some((e) => e.includes('server.mjs') && /execFile/.test(e)),
    `expected an execFile site: ${JSON.stringify(capabilities.exec.evidence)}`,
  );
});

test('nothing in this fixture is addressed to whoever reviews it', () => {
  const files = ['server.mjs', 'safety.mjs', 'README.md', 'SAFETY.md'].map((name) => ({
    path: `packages/fixtures/ambiguous-shell/${name}`,
    text: fs.readFileSync(path.join(PACKAGE_ROOT, name), 'utf8'),
  }));
  const hits = scanAllInjection({
    files,
    statedIntent: {
      tools: Object.values(TOOLS).map((t) => t.definition),
      readme: fs.readFileSync(path.join(PACKAGE_ROOT, 'README.md'), 'utf8'),
    },
  });
  // The ambiguity in this tier comes from architecture and wording, never from
  // text planted at the reviewer. That belongs to the malicious fixture alone.
  assert.deepEqual(hits, [], `unexpected injection hits: ${JSON.stringify(hits, null, 2)}`);
});
