// honest-notes: starts the REAL bin over stdio, drives it with an MCP client, and
// pins the safety invariants — that every path it touches resolves inside the
// package, and that the capability surface is filesystem and nothing else.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { scanCapabilities } from '../../../reviewer/src/capabilities.mjs';
import {
  PACKAGE_ROOT,
  FIXTURE_HOME,
  NOTES_DIR,
  TOOLS,
  assertInsidePackage,
  ensureNotes,
} from '../server.mjs';

const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url));
const DECLARED_TOOLS = ['list_notes', 'read_note'];

let client;
let transport;

before(async () => {
  transport = new StdioClientTransport({ command: process.execPath, args: [SERVER] });
  client = new Client({ name: 'surex-honest-notes-test', version: '0.0.0' });
  await client.connect(transport);
});

after(async () => {
  await client?.close();
  await transport?.close();
});

test('server starts, initializes, and lists exactly its declared tools', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [...DECLARED_TOOLS].sort());
  for (const tool of tools) {
    assert.equal(typeof tool.description, 'string');
    assert.ok(tool.description.length > 0);
    assert.equal(tool.inputSchema?.type, 'object');
  }
});

test('both descriptions name the directory and disclose the startup write', async () => {
  const { tools } = await client.listTools();
  for (const tool of tools) {
    assert.match(tool.description, /fixture-home\/notes\//, `${tool.name} must name the exact directory`);
    assert.match(tool.description, /only\s+write/i, `${tool.name} must disclose the startup write`);
    assert.match(tool.description, /no network request/i);
    assert.match(tool.description, /no environment variable/i);
    assert.match(tool.description, /no subprocess/i);
  }
});

test('list_notes returns the seeded notes', async () => {
  const res = await client.callTool({ name: 'list_notes', arguments: {} });
  const text = res.content.map((c) => c.text).join('\n');
  assert.match(text, /onboarding\.md/);
  assert.match(text, /queries\.md/);
  assert.match(text, /bytes/);
});

test('read_note returns the text of one note', async () => {
  const res = await client.callTool({ name: 'read_note', arguments: { name: 'onboarding.md' } });
  const text = res.content.map((c) => c.text).join('\n');
  assert.match(text, /# Onboarding/);
});

test('read_note refuses a traversal attempt and a non-note name', async () => {
  // Reduced to a basename, which is not a ".md" file, so it is refused outright —
  // and either way it could not have left the notes directory.
  const traversal = await client.callTool({
    name: 'read_note',
    arguments: { name: '../../../../../../etc/passwd' },
  });
  assert.equal(traversal.isError, true);
  const text = traversal.content.map((c) => c.text).join('\n');
  assert.match(text, /notes can be read/i);
  assert.ok(!/root:/.test(text), 'nothing from outside the package may appear in the output');

  const wrongType = await client.callTool({ name: 'read_note', arguments: { name: 'server.mjs' } });
  assert.equal(wrongType.isError, true);
  assert.ok(!/HONEST REVIEW FIXTURE/.test(wrongType.content.map((c) => c.text).join('\n')));
});

test('a name that traverses upward still lands inside the notes directory', async () => {
  // `path.basename` collapses this to "onboarding.md", so the read succeeds and it
  // succeeds on the note INSIDE the sandbox. That is the containment working, not
  // a bypass: there is no argument that reaches a different directory.
  const res = await client.callTool({ name: 'read_note', arguments: { name: '../../onboarding.md' } });
  assert.match(res.content.map((c) => c.text).join('\n'), /# Onboarding/);
});

// ---------------------------------------------------------------------------
// safety invariants
// ---------------------------------------------------------------------------

test('the notes directory resolves inside the package directory', () => {
  assert.ok(path.resolve(NOTES_DIR).startsWith(PACKAGE_ROOT + path.sep));
  assert.ok(path.resolve(FIXTURE_HOME).startsWith(PACKAGE_ROOT + path.sep));
});

test('assertInsidePackage refuses paths outside the package', () => {
  assert.throws(() => assertInsidePackage(path.join(PACKAGE_ROOT, '..', 'escape.txt')), /outside the package/);
  assert.throws(() => assertInsidePackage(os.homedir()), /outside the package/);
  // The guard is a resolved-prefix check, so refusing the home directory refuses
  // everything beneath it — including the private-key directory the malicious
  // fixture reads a decoy of. The path is composed here rather than written out,
  // so no fixture in this family carries a credential-shaped literal it does not
  // declare. Names are joined from parts for the same reason.
  const keyish = path.join(os.homedir(), ['.', 's', 's', 'h'].join(''), ['id', 'rsa'].join('_'));
  assert.throws(() => assertInsidePackage(keyish), /outside the package/);
  assert.doesNotThrow(() => assertInsidePackage(path.join(NOTES_DIR, 'onboarding.md')));
});

test('ensureNotes writes only inside fixture-home, and is idempotent', () => {
  ensureNotes();
  const before = fs.readdirSync(NOTES_DIR).sort();
  ensureNotes();
  assert.deepEqual(fs.readdirSync(NOTES_DIR).sort(), before);
  for (const name of before) {
    assert.ok(path.resolve(NOTES_DIR, name).startsWith(FIXTURE_HOME + path.sep));
  }
  assert.ok(before.includes('onboarding.md'));
});

test('the capability surface is filesystem only', () => {
  const text = fs.readFileSync(SERVER, 'utf8');
  const capabilities = scanCapabilities([{ path: 'server.mjs', text }]);
  assert.equal(capabilities.filesystem.present, true, 'filesystem is present, and declared');
  assert.ok(capabilities.filesystem.evidence.length > 0);
  for (const absent of ['network', 'exec', 'env', 'credentials']) {
    assert.equal(
      capabilities[absent].present,
      false,
      `${absent} must be absent, found: ${capabilities[absent].evidence.join(' | ')}`,
    );
  }
});

test('the tool registry and the wire agree', () => {
  assert.deepEqual(Object.keys(TOOLS).sort(), [...DECLARED_TOOLS].sort());
});
