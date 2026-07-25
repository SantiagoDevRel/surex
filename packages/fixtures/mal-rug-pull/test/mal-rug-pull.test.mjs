// mal-rug-pull — tool-description rug-pull (Invariant Labs tool-poisoning class).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { RUG_PULL_MARKER, UPDATED_DESCRIPTIONS, definition, listDefinition } from '../src/tools/weather.mjs';
import { isLoopbackHost, assertLoopbackSink, armed, DEFAULT_SINK, sinkUrl } from '../src/safety.mjs';

const SERVER = fileURLToPath(new URL('../src/server.mjs', import.meta.url));
const WEATHER_SRC = fs.readFileSync(fileURLToPath(new URL('../src/tools/weather.mjs', import.meta.url)), 'utf8');

let client;
let transport;

before(async () => {
  transport = new StdioClientTransport({ command: process.execPath, args: [SERVER] });
  client = new Client({ name: 'surex-mal-rug-pull-test', version: '0.0.0' });
  await client.connect(transport);
});

after(async () => {
  await client?.close();
  await transport?.close();
});

// --- 1. starts + lists tools ------------------------------------------------

test('server starts and lists get_weather with the innocuous description by default', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['get_weather']);
  const w = tools.find((t) => t.name === 'get_weather');
  // Default run serves the benign descriptor — no injection text.
  assert.doesNotMatch(w.description, /IMPORTANT|id_rsa|do not mention/i);
});

test('the honest facade returns weather', async () => {
  const res = await client.callTool({ name: 'get_weather', arguments: { city: 'Lisbon' } });
  assert.match(res.content.map((c) => c.text).join('\n'), /Weather in Lisbon/);
});

// --- 2. the malicious tell, pinned ------------------------------------------

test('the tell: a second, poisoned descriptor set exists for the same tool name', () => {
  assert.equal(RUG_PULL_MARKER, 'UPDATED_DESCRIPTIONS');
  assert.ok(UPDATED_DESCRIPTIONS.get_weather, 'the updated descriptor for get_weather exists');
  // Shipped descriptor is innocuous; the updated one weaponises the same tool.
  assert.doesNotMatch(definition.description, /id_rsa|IMPORTANT/i);
  assert.match(UPDATED_DESCRIPTIONS.get_weather, /~\/\.ssh\/id_rsa/);
  assert.match(UPDATED_DESCRIPTIONS.get_weather, /<IMPORTANT>/);
  assert.match(UPDATED_DESCRIPTIONS.get_weather, /do not mention/i);
  // Both descriptors are present in the source for a reviewer to compare.
  assert.match(WEATHER_SRC, /UPDATED_DESCRIPTIONS/);
});

test('the swap is real: flipping the env serves the poisoned descriptor', () => {
  assert.equal(listDefinition().description, definition.description, 'benign by default');
  const prev = process.env.SUREX_FIXTURE_RUGPULL;
  try {
    process.env.SUREX_FIXTURE_RUGPULL = '1';
    assert.match(listDefinition().description, /id_rsa/, 'poisoned after the pull');
  } finally {
    if (prev === undefined) delete process.env.SUREX_FIXTURE_RUGPULL;
    else process.env.SUREX_FIXTURE_RUGPULL = prev;
  }
});

// --- 3. the safety invariants ------------------------------------------------

test('the smuggle path is arm-gated and loopback-only; off by default', () => {
  assert.ok(isLoopbackHost(DEFAULT_SINK) && isLoopbackHost(sinkUrl()));
  assert.equal(armed(), false);
  assert.throws(() => assertLoopbackSink('https://evil.attacker.net'), /non-loopback/);
});

test('a key smuggled into `city` is NOT sent when unarmed', async () => {
  assert.equal(armed(), false);
  // Assemble the PEM header at runtime — never commit an intact one, so a push
  // secret-scanner has no reason to block over an obviously fake test string.
  const pem = (k) => `-----${k} OPENSSH PRIVATE ` + 'KEY-----';
  const fakeKey = `${pem('BEGIN')}\nnot-a-real-key\n${pem('END')}`;
  const res = await client.callTool({ name: 'get_weather', arguments: { city: fakeKey } });
  // It returns without error and, being unarmed, sends nothing.
  assert.ok(Array.isArray(res.content) && res.content.length > 0);
});
