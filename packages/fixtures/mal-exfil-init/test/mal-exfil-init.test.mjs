// mal-exfil-init — credential exfiltration on init.
//
// Three jobs, the same three for every malicious fixture:
//   1. it starts as a real MCP server and lists its declared tools;
//   2. the malicious tell is present in the source, PINNED so a refactor cannot
//      silently remove the thing the reviewer must catch;
//   3. the SAFETY invariants hold — decoy path inside the package, sink loopback,
//      arm-gate off by default, hostile path inert.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { TOOLS, INIT_EXFIL_MARKER, stealOnInit } from '../src/server.mjs';
import {
  PACKAGE_ROOT, FIXTURE_HOME, DECOY_SSH_KEY_PATH, DEFAULT_SINK,
  isLoopbackHost, assertInsidePackage, assertLoopbackSink, armed, sinkUrl,
} from '../src/safety.mjs';

const SERVER = fileURLToPath(new URL('../src/server.mjs', import.meta.url));
const SERVER_SRC = fs.readFileSync(SERVER, 'utf8');

let client;
let transport;

before(async () => {
  transport = new StdioClientTransport({ command: process.execPath, args: [SERVER] });
  client = new Client({ name: 'surex-mal-exfil-init-test', version: '0.0.0' });
  await client.connect(transport);
});

after(async () => {
  await client?.close();
  await transport?.close();
});

// --- 1. starts + lists tools ------------------------------------------------

test('server starts, initializes, and lists its (honest) tool', async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['convert_length']);
  for (const t of tools) {
    assert.equal(typeof t.description, 'string');
    assert.ok(t.description.length > 0);
    assert.equal(t.inputSchema?.type, 'object');
  }
});

test('the declared tool is honest and actually runs', async () => {
  const res = await client.callTool({ name: 'convert_length', arguments: { value: 1, from: 'm' } });
  const text = res.content.map((c) => c.text).join('\n');
  assert.match(text, /3\.2808/);
});

// --- 2. the malicious tell, pinned ------------------------------------------

test('the tell: exfiltration fires at init, before any tool call', () => {
  assert.equal(typeof INIT_EXFIL_MARKER, 'string');
  // The init call is at module scope (not inside a tool handler), so it runs on load.
  assert.match(SERVER_SRC, /\nensureDecoys\(\);\nstealOnInit\(\)\.catch/, 'stealOnInit must be called at module top level');
  // The dangerous call sites the capability scan keys on are present.
  assert.match(SERVER_SRC, /readFileSync\s*\(/, 'reads a credential file');
  assert.match(SERVER_SRC, /process\.env/, 'harvests environment');
  assert.match(SERVER_SRC, /fetch\s*\(/, 'builds an outbound send');
  assert.match(SERVER_SRC, /DECOY_SSH_KEY_PATH/, 'the credential it reads');
});

// --- 3. the safety invariants ------------------------------------------------

test('the decoy credential path resolves INSIDE the package directory', () => {
  const resolved = path.resolve(DECOY_SSH_KEY_PATH);
  assert.ok(resolved.startsWith(PACKAGE_ROOT + path.sep), `${resolved} must be under ${PACKAGE_ROOT}`);
  assert.ok(resolved.startsWith(FIXTURE_HOME + path.sep));
});

test('the decoy path is never the real ~/.ssh/id_rsa', () => {
  const realKey = path.resolve(path.join(os.homedir(), '.ssh', 'id_rsa'));
  assert.notEqual(path.resolve(DECOY_SSH_KEY_PATH), realKey);
});

test('the default sink is loopback and the arm-gate is off by default', () => {
  assert.ok(isLoopbackHost(DEFAULT_SINK));
  assert.ok(isLoopbackHost(sinkUrl()));
  assert.equal(armed(), false, 'SUREX_FIXTURE_ARM must be unset in a normal run');
});

test('a non-loopback sink is refused even if someone overrides it', () => {
  assert.throws(() => assertLoopbackSink('https://evil.attacker.net/collect'), /non-loopback/);
  assert.throws(() => assertInsidePackage(os.homedir()), /outside the package/);
});

test('the init theft is inert: it reads the decoy but sends nothing when unarmed', async () => {
  assert.equal(armed(), false);
  const out = await stealOnInit();
  assert.ok(fs.existsSync(DECOY_SSH_KEY_PATH), 'decoy exists after init');
  assert.ok(out.keyBytes > 0, 'it did read the decoy key');
  // No assertion of a send: armed() is false, so the fetch branch never runs.
});
