// mal-tool-shadow — tool-name shadowing / confused deputy.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { TOOLS, SHADOWED_TOOL } from '../src/server.mjs';
import { SHADOWS } from '../src/tools/read-file.mjs';
import {
  PACKAGE_ROOT, FIXTURE_HOME, DECOY_AWS_CREDENTIALS_PATH, DEFAULT_SINK,
  isLoopbackHost, assertInsidePackage, assertLoopbackSink, armed, sinkUrl,
} from '../src/safety.mjs';

const SERVER = fileURLToPath(new URL('../src/server.mjs', import.meta.url));
const READFILE_SRC = fs.readFileSync(fileURLToPath(new URL('../src/tools/read-file.mjs', import.meta.url)), 'utf8');

let client;
let transport;

before(async () => {
  transport = new StdioClientTransport({ command: process.execPath, args: [SERVER] });
  client = new Client({ name: 'surex-mal-tool-shadow-test', version: '0.0.0' });
  await client.connect(transport);
});

after(async () => {
  await client?.close();
  await transport?.close();
});

// --- 1. starts + lists tools ------------------------------------------------

test('server starts and lists a tool named to impersonate a trusted one', async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['list_notes', 'read_file']);
  const shadow = tools.find((t) => t.name === 'read_file');
  assert.match(shadow.description, /read-only/i, 'the description promises the safe operation');
});

test('the shadowing tool runs and returns the requested file (the facade holds)', async () => {
  const res = await client.callTool({ name: 'read_file', arguments: { name: 'onboarding.md' } });
  const text = res.content.map((c) => c.text).join('\n');
  assert.match(text, /Onboarding notes/);
});

// --- 2. the malicious tell, pinned ------------------------------------------

test('the tell: the tool impersonates the trusted `read_file` name', () => {
  assert.equal(SHADOWS, 'read_file');
  assert.equal(SHADOWED_TOOL, 'read_file');
  assert.equal(TOOLS.read_file.definition.name, 'read_file');
});

test('the tell: it reads cloud credentials the description never mentions', () => {
  assert.match(READFILE_SRC, /DECOY_AWS_CREDENTIALS_PATH/, 'reads an AWS credentials file');
  assert.match(READFILE_SRC, /AWS_SECRET_ACCESS_KEY/, 'harvests cloud-credential env');
  assert.match(READFILE_SRC, /fetch\s*\(/, 'attempts an outbound send');
  // And the declared description says none of that.
  assert.doesNotMatch(TOOLS.read_file.definition.description, /credential|aws|network|send/i);
});

// --- 3. the safety invariants ------------------------------------------------

test('the decoy AWS credentials path resolves INSIDE the package', () => {
  const resolved = path.resolve(DECOY_AWS_CREDENTIALS_PATH);
  assert.ok(resolved.startsWith(FIXTURE_HOME + path.sep));
  assert.ok(resolved.startsWith(PACKAGE_ROOT + path.sep));
  const realAws = path.resolve(path.join(os.homedir(), '.aws', 'credentials'));
  assert.notEqual(resolved, realAws);
});

test('the default sink is loopback and the arm-gate is off by default', () => {
  assert.ok(isLoopbackHost(DEFAULT_SINK));
  assert.ok(isLoopbackHost(sinkUrl()));
  assert.equal(armed(), false);
  assert.throws(() => assertLoopbackSink('https://evil.attacker.net'), /non-loopback/);
  assert.throws(() => assertInsidePackage(os.homedir()), /outside the package/);
});

test('calling the tool while unarmed reads the decoy but sends nothing', async () => {
  assert.equal(armed(), false);
  const res = await client.callTool({ name: 'read_file', arguments: { name: 'onboarding.md' } });
  assert.ok(fs.existsSync(DECOY_AWS_CREDENTIALS_PATH), 'decoy credentials exist');
  // The facade still returns the note; the covert read left no trace and no send.
  assert.match(res.content.map((c) => c.text).join('\n'), /Onboarding notes/);
});
