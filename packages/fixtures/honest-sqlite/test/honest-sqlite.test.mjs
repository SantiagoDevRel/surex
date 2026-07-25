// honest-sqlite: starts the REAL bin over stdio, and pins the claim the whole
// fixture rests on — that "read-only" is enforced by SQLite rather than asserted in
// prose, and that the one file it opens is the one named in every description.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { scanCapabilities, stripComments } from '../../../reviewer/src/capabilities.mjs';
import {
  PACKAGE_ROOT,
  FIXTURE_HOME,
  DB_PATH,
  MAX_ROWS,
  TOOLS,
  assertInsidePackage,
  ensureDatabase,
} from '../server.mjs';

const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url));
const DECLARED_TOOLS = ['describe_table', 'list_tables', 'query_rows'];

let client;
let transport;

before(async () => {
  transport = new StdioClientTransport({ command: process.execPath, args: [SERVER] });
  client = new Client({ name: 'surex-honest-sqlite-test', version: '0.0.0' });
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
    assert.equal(tool.inputSchema?.type, 'object');
  }
});

test('every description names the exact file, the read-only open, and the startup write', async () => {
  const { tools } = await client.listTools();
  for (const tool of tools) {
    assert.match(tool.description, /fixture-home\/library\.db/, `${tool.name} must name the exact file`);
    assert.match(tool.description, /readOnly/, `${tool.name} must name the read-only flag`);
    assert.match(tool.description, /only SELECT|SELECTs/, `${tool.name} must say only SELECTs run`);
    assert.match(tool.description, /at startup/, `${tool.name} must disclose the startup write`);
    assert.match(tool.description, /no network request/i);
    assert.match(tool.description, /no subprocess/i);
  }
});

test('list_tables returns the seeded tables with row counts', async () => {
  const res = await client.callTool({ name: 'list_tables', arguments: {} });
  const text = res.content.map((c) => c.text).join('\n');
  assert.match(text, /^books\t4 rows$/m);
  assert.match(text, /^loans\t2 rows$/m);
  assert.ok(!/sqlite_/.test(text), 'internal SQLite tables are left out');
});

test('describe_table returns the stored CREATE TABLE statement', async () => {
  const res = await client.callTool({ name: 'describe_table', arguments: { table: 'books' } });
  const text = res.content.map((c) => c.text).join('\n');
  assert.match(text, /CREATE TABLE books/);
  assert.match(text, /title TEXT NOT NULL/);
});

test('query_rows returns rows, honours the limit, and clamps an absurd one', async () => {
  const two = await client.callTool({ name: 'query_rows', arguments: { table: 'books', limit: 2 } });
  const text = two.content.map((c) => c.text).join('\n');
  assert.match(text, /^id\ttitle\tauthor\tyear$/m);
  assert.match(text, /Thinking in Systems/);
  assert.match(text, /2 row\(s\), limit 2/);

  const absurd = await client.callTool({ name: 'query_rows', arguments: { table: 'loans', limit: 999999 } });
  assert.match(absurd.content.map((c) => c.text).join('\n'), new RegExp(`limit ${MAX_ROWS}`));
});

test('an unknown table is refused by a membership check, not by string matching', async () => {
  const res = await client.callTool({ name: 'query_rows', arguments: { table: 'sqlite_master' } });
  assert.equal(res.isError, true);
  const text = res.content.map((c) => c.text).join('\n');
  assert.match(text, /no table named "sqlite_master"/);
  assert.match(text, /Tables: books, loans/);
});

test('a table name carrying SQL is refused before it reaches a statement', async () => {
  const res = await client.callTool({ name: 'query_rows', arguments: { table: 'books"; DROP TABLE books; --' } });
  assert.equal(res.isError, true);
  assert.match(res.content.map((c) => c.text).join('\n'), /no table named/);
  // And the table is still there afterwards.
  const after = await client.callTool({ name: 'list_tables', arguments: {} });
  assert.match(after.content.map((c) => c.text).join('\n'), /^books\t4 rows$/m);
});

// ---------------------------------------------------------------------------
// safety invariants
// ---------------------------------------------------------------------------

test('the database file resolves inside the package directory', () => {
  assert.ok(path.resolve(DB_PATH).startsWith(PACKAGE_ROOT + path.sep));
  assert.ok(path.resolve(DB_PATH).startsWith(FIXTURE_HOME + path.sep));
  assert.equal(path.basename(DB_PATH), 'library.db');
});

test('assertInsidePackage refuses paths outside the package', () => {
  assert.throws(() => assertInsidePackage(path.join(PACKAGE_ROOT, '..', 'escape.db')), /outside the package/);
  assert.throws(() => assertInsidePackage(os.homedir()), /outside the package/);
  assert.doesNotThrow(() => assertInsidePackage(DB_PATH));
});

test('read-only is enforced by SQLite, not by convention', () => {
  ensureDatabase();
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    assert.throws(() => db.exec('DELETE FROM books'), /readonly/i);
    assert.throws(() => db.exec('CREATE TABLE sneaky (x INTEGER)'), /readonly/i);
    // Reads through the same handle still work, which is the point.
    assert.equal(db.prepare('SELECT count(*) AS n FROM books').get().n, 4);
  } finally {
    db.close();
  }
});

test('ensureDatabase is idempotent and leaves no partial file behind', () => {
  ensureDatabase();
  const first = fs.statSync(DB_PATH).mtimeMs;
  ensureDatabase();
  assert.equal(fs.statSync(DB_PATH).mtimeMs, first, 'a second call must not rewrite the file');
  assert.ok(!fs.existsSync(path.join(FIXTURE_HOME, 'library.db.partial')));
  for (const entry of fs.readdirSync(FIXTURE_HOME)) {
    assert.ok(path.resolve(FIXTURE_HOME, entry).startsWith(FIXTURE_HOME + path.sep));
  }
});

test('the capability surface is filesystem only', () => {
  const text = fs.readFileSync(SERVER, 'utf8');
  const capabilities = scanCapabilities([{ path: 'server.mjs', text }]);
  assert.equal(capabilities.filesystem.present, true, 'filesystem is present, and declared');
  for (const absent of ['network', 'exec', 'env', 'credentials']) {
    assert.equal(
      capabilities[absent].present,
      false,
      `${absent} must be absent, found: ${capabilities[absent].evidence.join(' | ')}`,
    );
  }
});

test('there is exactly one read-write open in the server, and it is the seed', () => {
  // Comment-stripped, the same view the capability scan takes.
  const code = stripComments(fs.readFileSync(SERVER, 'utf8'), 'js');
  const opens = code.split(/\r?\n/).filter((line) => line.includes('new DatabaseSync('));
  assert.equal(opens.length, 2, `expected two opens in total, found ${opens.length}`);
  const readWrite = opens.filter((line) => !line.includes('readOnly'));
  assert.equal(readWrite.length, 1, `expected one read-write open, found: ${readWrite.join(' | ')}`);
  assert.match(readWrite[0], /partial/, 'the read-write open must be the seed, at the .partial path');
});

test('the tool registry and the wire agree', () => {
  assert.deepEqual(Object.keys(TOOLS).sort(), [...DECLARED_TOOLS].sort());
});
