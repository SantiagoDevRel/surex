// mal-postinstall — a malicious lifecycle / post-install script.
//
// The distinguishing property: the server is CLEAN; the attack is in the manifest.
// So the tests pin (a) that the manifest declares the hostile postinstall, (b) that
// the server code itself reaches for nothing, and (c) that the payload is inert.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { runPostinstall, MARKER_FILE } from '../scripts/exfil-postinstall.mjs';
import {
  FIXTURE_HOME, PACKAGE_ROOT, DECOY_SSH_KEY_PATH, DEFAULT_SINK,
  isLoopbackHost, assertInsidePackage, assertLoopbackSink, armed, sinkUrl,
} from '../src/safety.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8'));
const SERVER = fileURLToPath(new URL('../src/server.mjs', import.meta.url));
const SERVER_SRC = fs.readFileSync(SERVER, 'utf8');
const PING_SRC = fs.readFileSync(fileURLToPath(new URL('../src/tools/ping.mjs', import.meta.url)), 'utf8');
const POSTINSTALL_SRC = fs.readFileSync(fileURLToPath(new URL('../scripts/exfil-postinstall.mjs', import.meta.url)), 'utf8');

let client;
let transport;

before(async () => {
  transport = new StdioClientTransport({ command: process.execPath, args: [SERVER] });
  client = new Client({ name: 'surex-mal-postinstall-test', version: '0.0.0' });
  await client.connect(transport);
});

after(async () => {
  await client?.close();
  await transport?.close();
});

// --- 1. starts + lists tools ------------------------------------------------

test('server starts and lists its (honest) ping tool', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['ping']);
  const res = await client.callTool({ name: 'ping', arguments: { message: 'hi' } });
  assert.match(res.content.map((c) => c.text).join('\n'), /pong: hi/);
});

// --- 2. the malicious tell, pinned ------------------------------------------

test('the tell: the manifest declares a hostile postinstall hook', () => {
  assert.ok(PKG.scripts, 'package.json has scripts');
  assert.equal(PKG.scripts.postinstall, 'node scripts/exfil-postinstall.mjs', 'postinstall runs the exfil script');
});

test('the tell: the server code is clean — the attack is only in the lifecycle script', () => {
  // The server and its tool reach for nothing dangerous.
  assert.doesNotMatch(SERVER_SRC, /readFileSync|fetch\s*\(|process\.env/);
  assert.doesNotMatch(PING_SRC, /readFileSync|fetch\s*\(|process\.env/);
  // The lifecycle script does all the reaching.
  assert.match(POSTINSTALL_SRC, /readFileSync\s*\(/);
  assert.match(POSTINSTALL_SRC, /fetch\s*\(/);
  assert.match(POSTINSTALL_SRC, /process\.env/);
});

// --- 3. the safety invariants ------------------------------------------------

test('the default sink is loopback and the arm-gate is off by default', () => {
  assert.ok(isLoopbackHost(DEFAULT_SINK) && isLoopbackHost(sinkUrl()));
  assert.equal(armed(), false);
  assert.throws(() => assertLoopbackSink('https://evil.attacker.net'), /non-loopback/);
});

test('the payload, if run by hand, is inert: decoys, no send, touch-file inside the package', async () => {
  assert.equal(armed(), false);
  const out = await runPostinstall();
  assert.equal(out.sent, false, 'nothing was sent (unarmed)');
  assert.ok(out.credBytes > 0, 'it read the decoy credentials');
  // The touch-file it left is inside the package's fixture-home, nowhere else.
  const resolved = path.resolve(MARKER_FILE);
  assert.ok(resolved.startsWith(FIXTURE_HOME + path.sep));
  assert.ok(resolved.startsWith(PACKAGE_ROOT + path.sep));
  assert.ok(fs.existsSync(MARKER_FILE));
  assert.ok(path.resolve(DECOY_SSH_KEY_PATH).startsWith(FIXTURE_HOME + path.sep));
  const realSsh = path.resolve(path.join(os.homedir(), '.ssh', 'id_rsa'));
  assert.notEqual(path.resolve(DECOY_SSH_KEY_PATH), realSsh);
  assert.throws(() => assertInsidePackage(os.homedir()), /outside the package/);
});
