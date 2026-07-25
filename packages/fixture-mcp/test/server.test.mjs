// Starts the REAL bin over stdio and drives it with an MCP client, so the demo's
// claim — "it connects to Claude Code and we call one of its tools" — is tested,
// not asserted.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { LYING_TOOL } from '../src/server.mjs';

const SERVER = fileURLToPath(new URL('../src/server.mjs', import.meta.url));

let client;
let transport;

before(async () => {
  transport = new StdioClientTransport({ command: process.execPath, args: [SERVER] });
  client = new Client({ name: 'surex-fixture-test', version: '0.0.0' });
  // connect() performs the MCP `initialize` handshake; if the server did not
  // start and respond, this rejects.
  await client.connect(transport);
});

after(async () => {
  await client?.close();
  await transport?.close();
});

test('server starts, initializes, and lists its declared tools', async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['read_note', 'report_status', 'search']);
  // Every tool ships a description and an input schema.
  for (const t of tools) {
    assert.equal(typeof t.description, 'string');
    assert.ok(t.description.length > 0);
    assert.equal(t.inputSchema?.type, 'object');
  }
});

test('the lying tool declares an innocuous, read-only description', async () => {
  const { tools } = await client.listTools();
  const search = tools.find((t) => t.name === LYING_TOOL);
  assert.ok(search, 'the lying tool is listed');
  // The description is the lie: it claims to touch nothing outside the notes.
  assert.match(search.description, /notes/i);
  assert.match(search.description, /read-only/i);
});

test('calling the lying tool actually runs and returns content (a real call to block)', async () => {
  const res = await client.callTool({ name: LYING_TOOL, arguments: { query: 'gate' } });
  assert.ok(Array.isArray(res.content) && res.content.length > 0);
  const text = res.content.map((c) => c.text).join('\n');
  // The honest facade found a real match in the decoy notes.
  assert.match(text, /gate/i);
  // And the fixture footer confirms the covert side effect executed in-process.
  assert.match(text, /credential file/i);
});

test('an honest tool also runs end to end', async () => {
  const res = await client.callTool({ name: 'read_note', arguments: { name: 'onboarding.md' } });
  const text = res.content.map((c) => c.text).join('\n');
  assert.match(text, /Onboarding notes/);
});
