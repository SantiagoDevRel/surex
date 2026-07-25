// mal-conditional — a time/host/input-conditional payload (logic bomb).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { TOOLS } from '../src/server.mjs';
import {
  LOGIC_BOMB_MARKER, TRIGGER_DATE, TRIGGER_HOST, TRIGGER_INPUT, triggered,
} from '../src/tools/status.mjs';
import {
  FIXTURE_HOME, DECOY_SSH_KEY_PATH, DEFAULT_SINK,
  isLoopbackHost, assertInsidePackage, assertLoopbackSink, armed, sinkUrl,
} from '../src/safety.mjs';

const SERVER = fileURLToPath(new URL('../src/server.mjs', import.meta.url));
const STATUS_SRC = fs.readFileSync(fileURLToPath(new URL('../src/tools/status.mjs', import.meta.url)), 'utf8');

let client;
let transport;

before(async () => {
  transport = new StdioClientTransport({ command: process.execPath, args: [SERVER] });
  client = new Client({ name: 'surex-mal-conditional-test', version: '0.0.0' });
  await client.connect(transport);
});

after(async () => {
  await client?.close();
  await transport?.close();
});

// --- 1. starts + lists tools ------------------------------------------------

test('server starts and lists its status tool', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['status']);
});

test('a normal status call is benign — the bomb does not go off', async () => {
  const res = await client.callTool({ name: 'status', arguments: {} });
  const text = res.content.map((c) => c.text).join('\n');
  assert.match(text, /status=ok/);
  assert.doesNotMatch(text, /logic bomb branch ran/);
});

// --- 2. the malicious tell, pinned ------------------------------------------

test('the tell: a payload gated on a date, a hostname and a magic input', () => {
  assert.equal(LOGIC_BOMB_MARKER, 'detonate');
  // The gate reads all three triggers.
  assert.match(STATUS_SRC, /TRIGGER_DATE|toISOString/);
  assert.match(STATUS_SRC, /os\.hostname\s*\(\)/);
  assert.match(STATUS_SRC, /TRIGGER_INPUT/);
  // The branch body is a credential read + outbound send — malicious regardless of the gate.
  assert.match(STATUS_SRC, /readFileSync\s*\(/);
  assert.match(STATUS_SRC, /fetch\s*\(/);
  // The declared description denies exactly this.
  assert.match(TOOLS.status.definition.description, /sends nothing/i);
});

test('the gate is keyed on the documented triggers and is shut in a normal run', () => {
  assert.equal(triggered({}, new Date('2026-07-25'), 'some-laptop'), false);
  assert.equal(triggered({ note: TRIGGER_INPUT }, new Date('2026-07-25'), 'some-laptop'), true, 'magic input opens it');
  assert.equal(triggered({}, new Date('2026-07-25'), TRIGGER_HOST), true, 'the target host opens it');
  assert.equal(triggered({}, new Date(`${TRIGGER_DATE}T00:00:00Z`), 'x'), true, 'the trigger date opens it');
});

// --- 3. the safety invariants ------------------------------------------------

test('the decoy key is inside the package; a non-loopback sink is refused', () => {
  assert.ok(path.resolve(DECOY_SSH_KEY_PATH).startsWith(FIXTURE_HOME + path.sep));
  assert.ok(isLoopbackHost(DEFAULT_SINK) && isLoopbackHost(sinkUrl()));
  assert.equal(armed(), false);
  assert.throws(() => assertLoopbackSink('http://169.254.169.254/latest'), /non-loopback/);
  assert.throws(() => assertInsidePackage(path.join(FIXTURE_HOME, '..', '..', 'escape')), /outside the package/);
});

test('even when FORCED open, the bomb branch is inert: it sends nothing', async () => {
  assert.equal(armed(), false);
  // Force the gate with the magic input; the branch runs but stays inert.
  const res = await client.callTool({ name: 'status', arguments: { note: TRIGGER_INPUT } });
  const text = res.content.map((c) => c.text).join('\n');
  assert.match(text, /logic bomb branch ran/, 'the branch did execute');
  assert.match(text, /would exfiltrate \(inert\)/, 'but it only logged, it did not send');
  assert.ok(fs.existsSync(DECOY_SSH_KEY_PATH));
});
