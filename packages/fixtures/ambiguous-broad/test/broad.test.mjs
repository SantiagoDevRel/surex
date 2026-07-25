/*
 * ===========================================================================
 *  AMBIGUOUS REVIEW FIXTURE — authored by the SureX project.
 *  NOT MALICIOUS. NOT FOR PRODUCTION USE. See ../SAFETY.md and ../../AMBIGUOUS.md.
 * ===========================================================================
 *
 * Starts the REAL bin over stdio and drives it with an MCP client. The claims this
 * suite exists to pin are the two clamps: the walk cannot leave the package, and
 * nothing reaches a host that is not loopback.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import {
  DECOY_WORKSPACE,
  EXCLUDED_FRAGMENTS,
  FIXTURE_HOME,
  PACKAGE_ROOT,
  assertInsidePackage,
  assertLoopbackDestination,
  ensureDecoys,
  isExcluded,
  isLoopbackHost,
  resolveRoot,
} from '../safety.mjs';
import { TOOLS } from '../server.mjs';

import { scanFiles } from '../../../reviewer/src/capabilities.mjs';
import { scanAllInjection } from '../../../reviewer/src/prompt.mjs';

const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url));
const SOURCES = ['server.mjs', 'safety.mjs'];

/** Start the fixture over stdio with an environment of our choosing. */
async function connect(env = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: { ...process.env, ...env },
  });
  const client = new Client({ name: 'surex-ambiguous-broad-test', version: '0.0.0' });
  await client.connect(transport);
  return {
    client,
    async close() {
      await client.close();
      await transport.close();
    },
  };
}

const text = (res) => res.content.map((c) => c.text).join('\n');

let base;

before(async () => {
  ensureDecoys();
  // No destination in this session's environment: the default posture is "off".
  base = await connect({ AMBIGUOUS_BACKUP_URL: '', AMBIGUOUS_BACKUP_TOKEN: '' });
});

after(async () => {
  await base?.close();
});

// ---------------------------------------------------------------------------
// it is a real server
// ---------------------------------------------------------------------------

test('server starts, initializes, and lists its declared tools', async () => {
  const { tools } = await base.client.listTools();
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    ['describe_destination', 'snapshot_directory', 'upload_snapshot'],
  );
  for (const t of tools) {
    assert.equal(typeof t.description, 'string');
    assert.equal(t.inputSchema?.type, 'object');
  }
});

test('the declarations name the reach explicitly — dotfiles, bytes, and the env var', async () => {
  const { tools } = await base.client.listTools();
  const snapshot = tools.find((t) => t.name === 'snapshot_directory');
  assert.match(snapshot.description, /every file/i);
  assert.match(snapshot.description, /dotfiles/i);
  assert.match(snapshot.description, /sha256/i);
  const upload = tools.find((t) => t.name === 'upload_snapshot');
  assert.match(upload.description, /AMBIGUOUS_BACKUP_URL/);
  assert.match(upload.description, /bearer/i);
  assert.match(upload.description, /nothing is sent/i);
});

test('a snapshot walks the decoy tree and reports the skipped sensitive names', async () => {
  const res = await base.client.callTool({ name: 'snapshot_directory', arguments: {} });
  const out = text(res);
  for (const expected of ['src/app.mjs', 'src/util.mjs', 'notes/todo.md', 'config/settings.json']) {
    assert.ok(out.includes(expected), `expected ${expected} in the manifest`);
  }
  // The skip list is not decoration: these two exist on disk and were not read.
  assert.match(out, /secrets\/id_rsa — excluded by the skip list/);
  assert.match(out, /\.env — excluded by the skip list/);
  // A manifest, not a backup, until asked otherwise.
  assert.match(out, /contents captured: false/);
});

test('contents are captured only when the caller asks for them', async () => {
  await base.client.callTool({ name: 'snapshot_directory', arguments: { includeContents: true } });
  const off = await base.client.callTool({ name: 'upload_snapshot', arguments: {} });
  assert.match(text(off), /contents captured: true/);

  await base.client.callTool({ name: 'snapshot_directory', arguments: {} });
  const on = await base.client.callTool({ name: 'upload_snapshot', arguments: {} });
  assert.match(text(on), /contents captured: false/);
});

test('upload_snapshot refuses to invent a snapshot it does not have', async () => {
  const fresh = await connect({ AMBIGUOUS_BACKUP_URL: '' });
  try {
    const res = await fresh.client.callTool({ name: 'upload_snapshot', arguments: {} });
    assert.equal(res.isError, true);
    assert.match(text(res), /No snapshot has been taken yet/);
  } finally {
    await fresh.close();
  }
});

// ---------------------------------------------------------------------------
// clamp 1 — the walk cannot leave the package
// ---------------------------------------------------------------------------

test('a root outside the package is refused', async () => {
  const outside = [
    path.resolve(PACKAGE_ROOT, '..'),          // packages/fixtures
    path.resolve(PACKAGE_ROOT, '..', '..'),    // packages
    '../../..',                                // relative escape from the workspace root
    homeDir(),                                 // the developer's home directory
  ];
  for (const root of outside) {
    const res = await base.client.callTool({ name: 'snapshot_directory', arguments: { root } });
    assert.equal(res.isError, true, `must refuse root ${root}`);
    assert.match(text(res), /refused a path outside the package/);
  }
});

test('resolveRoot defaults inside the package and guards what it is given', () => {
  assert.equal(resolveRoot(undefined), DECOY_WORKSPACE);
  assert.equal(resolveRoot(''), DECOY_WORKSPACE);
  assert.ok(resolveRoot('src').startsWith(DECOY_WORKSPACE + path.sep));
  assert.throws(() => resolveRoot(path.join(PACKAGE_ROOT, '..')), /outside the package/);
  assert.throws(() => assertInsidePackage(homeDir()), /outside the package/);
});

test('the decoy tree lives inside fixture-home, which lives inside the package', () => {
  assert.ok(DECOY_WORKSPACE.startsWith(FIXTURE_HOME + path.sep));
  assert.ok(FIXTURE_HOME.startsWith(PACKAGE_ROOT + path.sep));
  assert.ok(fs.existsSync(path.join(DECOY_WORKSPACE, 'src', 'app.mjs')));
  // The decoy "secret" is a decoy: no key header, and it says so in its own bytes.
  const decoy = fs.readFileSync(path.join(DECOY_WORKSPACE, 'secrets', 'id_rsa'), 'utf8');
  assert.match(decoy, /FAKE-DECOY-NOT-A-KEY/);
  assert.doesNotMatch(decoy, /BEGIN [A-Z ]*PRIVATE KEY/);
});

test('isExcluded matches the sensitive names and leaves ordinary files alone', () => {
  for (const excluded of ['secrets/id_rsa', '.env', '.env.local', 'x/.ssh/known_hosts', 'a/.npmrc', 'node_modules/x/y.js', '.git/config', 'deep/id_ed25519']) {
    assert.ok(isExcluded(excluded), `${excluded} should be excluded`);
  }
  for (const kept of ['src/app.mjs', 'notes/todo.md', 'config/settings.json', 'environment.md', 'id_rsa_notes.md']) {
    assert.ok(!isExcluded(kept), `${kept} should be kept`);
  }
  assert.ok(EXCLUDED_FRAGMENTS.length >= 7);
});

// ---------------------------------------------------------------------------
// clamp 2 — nothing leaves the machine
// ---------------------------------------------------------------------------

test('with no destination configured, nothing is sent', async () => {
  await base.client.callTool({ name: 'snapshot_directory', arguments: {} });
  const res = await base.client.callTool({ name: 'upload_snapshot', arguments: {} });
  const out = text(res);
  assert.match(out, /No destination configured/);
  assert.match(out, /nothing was sent/);
  assert.notEqual(res.isError, true);
});

test('a non-loopback destination is refused at the guard', async () => {
  const real = await connect({ AMBIGUOUS_BACKUP_URL: 'https://backup.example.net/collect' });
  try {
    await real.client.callTool({ name: 'snapshot_directory', arguments: {} });
    const res = await real.client.callTool({ name: 'upload_snapshot', arguments: {} });
    assert.equal(res.isError, true);
    assert.match(text(res), /refused a non-loopback destination/);
    const described = await real.client.callTool({ name: 'describe_destination', arguments: {} });
    assert.match(text(described), /would be refused by this build/);
  } finally {
    await real.close();
  }
});

test('isLoopbackHost accepts loopback and rejects real hosts, including cloud metadata', () => {
  for (const ok of ['http://127.0.0.1:9099/sink', 'http://localhost:8080', 'http://[::1]:9', 'http://sink.invalid/x', 'http://foo.localhost/x']) {
    assert.ok(isLoopbackHost(ok), `${ok} should be loopback`);
  }
  for (const bad of ['https://backup.example.net', 'http://8.8.8.8', 'http://169.254.169.254/latest', 'not a url']) {
    assert.ok(!isLoopbackHost(bad), `${bad} should NOT be loopback`);
  }
  assert.throws(() => assertLoopbackDestination('https://backup.example.net'), /non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDestination('http://127.0.0.1:9099/sink'));
});

test('an upload to a loopback listener really arrives, and nowhere else', async () => {
  const received = [];
  const sink = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      received.push({ url: req.url, auth: req.headers.authorization ?? null, body });
      res.writeHead(204).end();
    });
  });
  await new Promise((resolve) => sink.listen(0, '127.0.0.1', resolve));
  const port = sink.address().port;

  const armed = await connect({
    AMBIGUOUS_BACKUP_URL: `http://127.0.0.1:${port}/sink`,
    AMBIGUOUS_BACKUP_TOKEN: 'surex-broad-canary-token',
  });
  try {
    await armed.client.callTool({ name: 'snapshot_directory', arguments: {} });
    const res = await armed.client.callTool({ name: 'upload_snapshot', arguments: {} });
    assert.match(text(res), /HTTP 204/);
    assert.equal(received.length, 1);
    assert.equal(received[0].url, '/sink');
    // The bearer went to the loopback destination, as declared.
    assert.equal(received[0].auth, 'Bearer surex-broad-canary-token');
    const payload = JSON.parse(received[0].body);
    assert.ok(payload.files.some((f) => f.path === 'src/app.mjs'));
    // Even on the wire, the skip list held.
    assert.ok(!payload.files.some((f) => f.path.includes('id_rsa')));
  } finally {
    await armed.close();
    await new Promise((resolve) => sink.close(resolve));
  }
});

test('the credential value never appears in tool output', async () => {
  const canary = 'surex-broad-canary-token';
  const armed = await connect({
    AMBIGUOUS_BACKUP_URL: 'http://127.0.0.1:9/sink',
    AMBIGUOUS_BACKUP_TOKEN: canary,
  });
  try {
    const described = text(await armed.client.callTool({ name: 'describe_destination', arguments: {} }));
    assert.match(described, /bearer credential: configured \(value not shown\)/);
    assert.ok(!described.includes(canary), 'the token value must never be returned');
    await armed.client.callTool({ name: 'snapshot_directory', arguments: {} });
    const uploaded = text(await armed.client.callTool({ name: 'upload_snapshot', arguments: {} }));
    assert.ok(!uploaded.includes(canary), 'the token value must never be returned');
  } finally {
    await armed.close();
  }
});

// ---------------------------------------------------------------------------
// what SureX's own deterministic lanes see
// ---------------------------------------------------------------------------

test('the capability scan finds filesystem, network and env — and credentials, from the skip list', () => {
  const files = SOURCES.map((name) => ({
    path: `packages/fixtures/ambiguous-broad/${name}`,
    text: fs.readFileSync(path.join(PACKAGE_ROOT, name), 'utf8'),
  }));
  const { capabilities } = scanFiles(files);
  assert.equal(capabilities.filesystem.present, true);
  assert.equal(capabilities.network.present, true);
  assert.equal(capabilities.env.present, true);
  assert.equal(capabilities.exec.present, false);
  // The finding this fixture exists to produce: `credentials: present`, cited on
  // the lines of a list of files the code refuses to open.
  assert.equal(capabilities.credentials.present, true);
  assert.ok(
    capabilities.credentials.evidence.some((e) => e.includes('safety.mjs')),
    `expected credential evidence in safety.mjs: ${JSON.stringify(capabilities.credentials.evidence)}`,
  );
});

test('nothing in this fixture is addressed to whoever reviews it', () => {
  const files = [...SOURCES, 'README.md', 'SAFETY.md'].map((name) => ({
    path: `packages/fixtures/ambiguous-broad/${name}`,
    text: fs.readFileSync(path.join(PACKAGE_ROOT, name), 'utf8'),
  }));
  const hits = scanAllInjection({
    files,
    statedIntent: {
      tools: Object.values(TOOLS).map((t) => t.definition),
      readme: fs.readFileSync(path.join(PACKAGE_ROOT, 'README.md'), 'utf8'),
    },
  });
  assert.deepEqual(hits, [], `unexpected injection hits: ${JSON.stringify(hits, null, 2)}`);
});

/** The user's home directory — used only as a path the guard must refuse. */
function homeDir() {
  return process.env.USERPROFILE || process.env.HOME || path.resolve('/');
}
