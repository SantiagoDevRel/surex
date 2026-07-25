// honest-units: the control case. Starts the REAL bin over stdio and drives it
// with an MCP client, then pins the property that makes it the control — that the
// deterministic capability scan finds NOTHING in any of its five categories.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { scanCapabilities, stripComments, CATEGORIES } from '../../../reviewer/src/capabilities.mjs';
import { convert, familyOf, FAMILY_NAMES, TOOLS } from '../server.mjs';

const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url));
const DECLARED_TOOLS = ['convert_unit', 'list_units'];

let client;
let transport;

before(async () => {
  transport = new StdioClientTransport({ command: process.execPath, args: [SERVER] });
  client = new Client({ name: 'surex-honest-units-test', version: '0.0.0' });
  // connect() performs the MCP `initialize` handshake; if the server did not
  // start and respond, this rejects.
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

test('every declared description states that the tool touches nothing', async () => {
  const { tools } = await client.listTools();
  for (const tool of tools) {
    assert.match(tool.description, /opens no file/i, `${tool.name} must say it opens no file`);
    assert.match(tool.description, /no network request/i, `${tool.name} must say it makes no network request`);
    assert.match(tool.description, /no environment variable/i, `${tool.name} must say it reads no env var`);
    assert.match(tool.description, /no subprocess/i, `${tool.name} must say it starts no subprocess`);
  }
});

test('convert_unit converts over the wire', async () => {
  const res = await client.callTool({ name: 'convert_unit', arguments: { value: 1, from: 'mi', to: 'km' } });
  const text = res.content.map((c) => c.text).join('\n');
  assert.match(text, /1\.609344 km/);
  assert.match(text, /family: length/);
});

test('convert_unit handles the affine family and refuses a cross-family pair', async () => {
  const boiling = await client.callTool({ name: 'convert_unit', arguments: { value: 100, from: 'C', to: 'F' } });
  assert.match(boiling.content.map((c) => c.text).join('\n'), /212 F/);

  const mismatch = await client.callTool({ name: 'convert_unit', arguments: { value: 1, from: 'kg', to: 'km' } });
  assert.equal(mismatch.isError, true);
  assert.match(mismatch.content.map((c) => c.text).join('\n'), /no conversion between them/i);
});

test('list_units reports every family', async () => {
  const res = await client.callTool({ name: 'list_units', arguments: {} });
  const text = res.content.map((c) => c.text).join('\n');
  for (const family of FAMILY_NAMES) assert.match(text, new RegExp(`^${family} `, 'm'));
});

/** Temperature goes through kelvin, so compare with a tolerance, not for equality. */
function closeTo(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} should be within ${epsilon} of ${expected}`);
}

test('the conversion arithmetic is right, in process', () => {
  assert.equal(convert(1, 'km', 'm').value, 1000);
  assert.equal(convert(1024, 'B', 'KiB').value, 1);
  closeTo(convert(-40, 'C', 'F').value, -40); // the one place the two scales meet
  closeTo(convert(0, 'C', 'K').value, 273.15);
  closeTo(convert(0, 'K', 'R').value, 0);
  assert.equal(familyOf('nope'), null);
  assert.throws(() => convert(Number.NaN, 'm', 'km'), /finite number/);
  assert.throws(() => convert(1, 'm', 'nope'), /unknown unit code/);
});

// ---------------------------------------------------------------------------
// the invariant that makes this fixture the control case
// ---------------------------------------------------------------------------

test('the capability scan finds NOTHING: all five categories absent', () => {
  const text = fs.readFileSync(SERVER, 'utf8');
  const capabilities = scanCapabilities([{ path: 'server.mjs', text }]);
  for (const category of CATEGORIES) {
    assert.equal(
      capabilities[category].present,
      false,
      `${category} must be absent, found: ${capabilities[category].evidence.join(' | ')}`,
    );
  }
});

test('the source imports nothing that could reach outside the process', () => {
  // Checked against the comment-stripped source, the same view the capability scan
  // takes: a capability named in a comment is not a capability of the code, and
  // this file's banner does name several of them in order to rule them out.
  const code = stripComments(fs.readFileSync(SERVER, 'utf8'), 'js');
  for (const forbidden of ['node:fs', 'node:child_process', 'node:http', 'node:https', 'node:net', 'node:sqlite']) {
    assert.ok(!code.includes(forbidden), `must not import ${forbidden}`);
  }
  assert.ok(!/\bprocess\.env\b/.test(code), 'must not read process.env');
  assert.ok(!/(?<![.\w$])fetch\s*\(/.test(code), 'must not call fetch()');
  assert.ok(!/(?<![.\w$])(eval|execFile|exec|spawn)\s*\(/.test(code), 'must not start or evaluate anything');
});

test('the tool registry and the wire agree', () => {
  assert.deepEqual(Object.keys(TOOLS).sort(), [...DECLARED_TOOLS].sort());
});
