// honest-weather: starts the REAL bin over stdio and pins the two invariants that
// make it safe to run — the default endpoint is loopback, and there is no way to
// point it at a third host — plus the one that makes it honest: the key it sends is
// named in the description and never echoed back in a result.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { scanCapabilities, stripComments } from '../../../reviewer/src/capabilities.mjs';
import {
  LOOPBACK_ENDPOINT,
  LIVE_ENDPOINT,
  LIVE_HOST,
  LIVE_FLAG_VAR,
  KEY_VAR,
  TOOLS,
  assertAllowedEndpoint,
  endpointInEffect,
  liveEnabled,
} from '../server.mjs';

const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url));
const DECLARED_TOOLS = ['describe_endpoint', 'get_weather'];

/** A value that is obviously not a real key, so the redaction test has a subject. */
const DUMMY_KEY = 'dummy-value-for-the-test';

let client;
let transport;

before(async () => {
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    // The live flag is deliberately left unset; the dummy key is set so the test
    // can prove the key is redacted out of the result rather than returned.
    env: { ...process.env, [KEY_VAR]: DUMMY_KEY, [LIVE_FLAG_VAR]: '' },
  });
  client = new Client({ name: 'surex-honest-weather-test', version: '0.0.0' });
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

test('both descriptions name the host, the env var, and say the key is sent there', async () => {
  const { tools } = await client.listTools();
  for (const tool of tools) {
    assert.ok(tool.description.includes(LIVE_HOST), `${tool.name} must name the live host`);
    assert.ok(tool.description.includes(KEY_VAR), `${tool.name} must name the key env var`);
    assert.ok(tool.description.includes(LOOPBACK_ENDPOINT), `${tool.name} must name the default endpoint`);
    assert.ok(tool.description.includes(LIVE_FLAG_VAR), `${tool.name} must name the flag that enables the live host`);
    assert.match(tool.description, /key IS sent over the network/, `${tool.name} must say the key is sent`);
  }
});

test('describe_endpoint reports the loopback default without sending anything', async () => {
  const res = await client.callTool({ name: 'describe_endpoint', arguments: {} });
  const text = res.content.map((c) => c.text).join('\n');
  assert.match(text, /endpoint in effect: http:\/\/127\.0\.0\.1:9\/weather/);
  assert.match(text, /loopback only/);
  assert.match(text, /set \(value withheld\)/);
  assert.ok(!text.includes(DUMMY_KEY), 'the key value must never be returned');
});

test('get_weather runs, targets loopback, and redacts the key', async () => {
  const res = await client.callTool({ name: 'get_weather', arguments: { city: 'Lisbon' } });
  const text = res.content.map((c) => c.text).join('\n');
  // The request really is attempted — at the discard port, where nothing answers.
  assert.match(text, /endpoint: http:\/\/127\.0\.0\.1:9\/weather/);
  assert.match(text, /appid=%3Credacted%3E|appid=<redacted>/);
  assert.ok(!text.includes(DUMMY_KEY), 'the key value must never appear in a result');
  assert.ok(!text.includes(LIVE_HOST), 'the live host must not be contacted or reported as in effect');
  assert.match(text, /did not complete|HTTP \d{3}/, 'either it failed to connect, or something local answered');
});

test('get_weather refuses an empty city', async () => {
  const res = await client.callTool({ name: 'get_weather', arguments: { city: '   ' } });
  assert.equal(res.isError, true);
});

// ---------------------------------------------------------------------------
// safety invariants
// ---------------------------------------------------------------------------

test('the default endpoint is the loopback interface, and it is what is in effect', () => {
  assert.equal(new URL(LOOPBACK_ENDPOINT).hostname, '127.0.0.1');
  assert.equal(liveEnabled(), false, 'the live flag must be off unless deliberately set');
  assert.equal(endpointInEffect(), LOOPBACK_ENDPOINT);
});

test('the live endpoint is the one declared host, over https', () => {
  const url = new URL(LIVE_ENDPOINT);
  assert.equal(url.hostname, LIVE_HOST);
  assert.equal(url.protocol, 'https:');
});

test('assertAllowedEndpoint refuses any URL that is not one of the two literals', () => {
  assert.doesNotThrow(() => assertAllowedEndpoint(LOOPBACK_ENDPOINT));
  assert.doesNotThrow(() => assertAllowedEndpoint(LIVE_ENDPOINT));
  for (const other of [
    'https://example.com/collect',
    'http://169.254.169.254/latest/meta-data',
    'https://api.openweathermap.org.attacker.test/data',
    `${LIVE_ENDPOINT}?x=1`,
    'not a url',
  ]) {
    assert.throws(() => assertAllowedEndpoint(other), /not one of the two pinned URLs/, `must refuse ${other}`);
  }
});

test('no environment variable can supply a URL', () => {
  // Comment-stripped, the same view the capability scan takes.
  const code = stripComments(fs.readFileSync(SERVER, 'utf8'), 'js');
  // Every process.env read in this file must be one of the two variables the
  // descriptions name. If a third appears, this fails and the description is stale.
  const reads = [...code.matchAll(/process\.env\[([A-Za-z_]+)\]/g)].map((m) => m[1]);
  assert.ok(reads.length > 0, 'the env reads should be findable');
  for (const read of reads) {
    assert.ok(['LIVE_FLAG_VAR', 'KEY_VAR'].includes(read), `unexpected env read: ${read}`);
  }
  assert.ok(!/process\.env\.[A-Z]/.test(code), 'no dotted env read should sneak past the check above');
  // And no URL is ever assembled from anything but the two pinned literals.
  assert.ok(!/new URL\(\s*process\.env/.test(code), 'no URL may be built from the environment');
});

test('the capability surface is network, env and credentials — all three declared', () => {
  const text = fs.readFileSync(SERVER, 'utf8');
  const capabilities = scanCapabilities([{ path: 'server.mjs', text }]);
  for (const present of ['network', 'env', 'credentials']) {
    assert.equal(capabilities[present].present, true, `${present} should be present, and it is declared`);
    assert.ok(capabilities[present].evidence.length > 0);
  }
  for (const absent of ['filesystem', 'exec']) {
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
