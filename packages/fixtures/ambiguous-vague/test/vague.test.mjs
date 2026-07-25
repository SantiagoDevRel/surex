/*
 * ===========================================================================
 *  AMBIGUOUS REVIEW FIXTURE — authored by the SureX project.
 *  NOT MALICIOUS. NOT FOR PRODUCTION USE. See ../SAFETY.md and ../../AMBIGUOUS.md.
 * ===========================================================================
 *
 * Starts the REAL bin over stdio, exercises all three tools, and then pins the
 * negatives — because for this fixture the claim IS the negative: the surface is
 * narrow, and the only thing a reviewer can object to is the wording.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import {
  PACKAGE_ROOT,
  FIXTURE_HOME,
  STORE_PATH,
  MAX_ITEMS,
  assertInsidePackage,
  ensureStore,
  readStore,
  writeStore,
} from '../safety.mjs';
import { TOOLS } from '../server.mjs';

import { scanFiles } from '../../../reviewer/src/capabilities.mjs';
import { scanAllInjection } from '../../../reviewer/src/prompt.mjs';

const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url));
const SOURCES = ['server.mjs', 'safety.mjs'];

let client;
let transport;

before(async () => {
  // Start from an empty store so the counts below are the counts this test made.
  ensureStore();
  writeStore([]);
  transport = new StdioClientTransport({ command: process.execPath, args: [SERVER] });
  client = new Client({ name: 'surex-ambiguous-vague-test', version: '0.0.0' });
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
  assert.deepEqual(tools.map((t) => t.name).sort(), ['get_context', 'sync_workspace', 'tidy_up']);
  for (const t of tools) {
    assert.equal(typeof t.description, 'string');
    assert.ok(t.description.length > 0);
    assert.equal(t.inputSchema?.type, 'object');
  }
});

test('the descriptions are uninformative — no tool says what it touches', async () => {
  const { tools } = await client.listTools();
  for (const t of tools) {
    const text = `${t.description} ${JSON.stringify(t.inputSchema)}`;
    // This is the fixture: nothing in the declared surface names a file, a
    // directory, a host, a process or the environment.
    assert.doesNotMatch(text, /\b(file|directory|folder|disk|path|json|network|http|url|host|process|environment|env var)\b/i,
      `"${t.name}" unexpectedly names a concrete resource: ${t.description}`);
  }
});

test('the three tools work end to end', async () => {
  const add = await client.callTool({ name: 'sync_workspace', arguments: { items: ['beta', 'alpha', 'beta'] } });
  assert.match(add.content.map((c) => c.text).join('\n'), /3 item\(s\)/);

  const read = await client.callTool({ name: 'get_context', arguments: {} });
  const readText = read.content.map((c) => c.text).join('\n');
  assert.match(readText, /- beta/);
  assert.match(readText, /- alpha/);

  const tidy = await client.callTool({ name: 'tidy_up', arguments: {} });
  assert.match(tidy.content.map((c) => c.text).join('\n'), /3 item\(s\) → 2/);

  const after = await client.callTool({ name: 'get_context', arguments: {} });
  assert.match(after.content.map((c) => c.text).join('\n'), /^2 item\(s\)/m);
});

// ---------------------------------------------------------------------------
// the surface really is this narrow
// ---------------------------------------------------------------------------

test('the store resolves inside the package and is the only file written', () => {
  const resolved = path.resolve(STORE_PATH);
  assert.ok(resolved.startsWith(FIXTURE_HOME + path.sep), `${resolved} must be under ${FIXTURE_HOME}`);
  assert.ok(resolved.startsWith(PACKAGE_ROOT + path.sep));
  assert.ok(fs.existsSync(STORE_PATH));
  // fixture-home holds exactly the store.
  assert.deepEqual(fs.readdirSync(FIXTURE_HOME), ['workspace.json']);
});

test('assertInsidePackage refuses paths outside the package', () => {
  assert.throws(() => assertInsidePackage(path.join(PACKAGE_ROOT, '..', 'escape.txt')), /outside the package/);
  assert.doesNotThrow(() => assertInsidePackage(STORE_PATH));
});

test('no tool accepts a path, so there is nothing to traverse with', () => {
  for (const tool of Object.values(TOOLS)) {
    const props = Object.keys(tool.definition.inputSchema.properties ?? {});
    for (const prop of props) {
      assert.doesNotMatch(prop, /path|file|dir|name|url/i, `${tool.definition.name}.${prop} looks like a path`);
    }
    assert.equal(tool.definition.inputSchema.additionalProperties, false);
  }
});

test('the item cap holds', () => {
  writeStore(Array.from({ length: MAX_ITEMS + 50 }, (_, i) => `item-${i}`));
  assert.equal(readStore().items.length, MAX_ITEMS);
  writeStore([]);
});

test('a corrupt store is treated as empty rather than thrown at a caller', () => {
  fs.writeFileSync(STORE_PATH, '{ not json', 'utf8');
  assert.deepEqual(readStore(), { items: [], updatedAt: null });
  writeStore([]);
});

test('the source contains no network, process-execution or environment call site', () => {
  for (const name of SOURCES) {
    const text = fs.readFileSync(path.join(PACKAGE_ROOT, name), 'utf8');
    assert.doesNotMatch(text, /\bfetch\s*\(|node:http|node:net|WebSocket/, `${name}: network`);
    assert.doesNotMatch(text, /node:child_process|\bexecFile\b|\bspawn\s*\(|\beval\s*\(|new Function/, `${name}: exec`);
    assert.doesNotMatch(text, /process\.env/, `${name}: env`);
  }
});

// ---------------------------------------------------------------------------
// what SureX's own deterministic lanes see
// ---------------------------------------------------------------------------

test('the capability scan reports filesystem and nothing else', () => {
  const files = SOURCES.map((name) => ({
    path: `packages/fixtures/ambiguous-vague/${name}`,
    text: fs.readFileSync(path.join(PACKAGE_ROOT, name), 'utf8'),
  }));
  const { capabilities } = scanFiles(files);
  assert.equal(capabilities.filesystem.present, true);
  assert.equal(capabilities.network.present, false);
  assert.equal(capabilities.exec.present, false);
  assert.equal(capabilities.env.present, false);
  assert.equal(capabilities.credentials.present, false);
  assert.ok(capabilities.filesystem.evidence.some((e) => e.includes('safety.mjs')));
});

test('nothing in this fixture is addressed to whoever reviews it', () => {
  const files = [...SOURCES, 'README.md', 'SAFETY.md'].map((name) => ({
    path: `packages/fixtures/ambiguous-vague/${name}`,
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
