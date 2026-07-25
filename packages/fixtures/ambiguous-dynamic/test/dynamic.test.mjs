/*
 * ===========================================================================
 *  AMBIGUOUS REVIEW FIXTURE — authored by the SureX project.
 *  NOT MALICIOUS. NOT FOR PRODUCTION USE. See ../SAFETY.md and ../../AMBIGUOUS.md.
 * ===========================================================================
 *
 * Starts the REAL bin over stdio, and then proves the fixture's central claim: the
 * exposed tool list changes when only the config file changes, with server.mjs
 * byte-identical. The rest of the suite pins the fail-closed validation that keeps
 * a data-driven tool list from becoming a payload.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import {
  CONFIG_PATH,
  FIXTURE_HOME,
  KINDS,
  MAX_TOOLS,
  NOTES_DIR,
  PACKAGE_ROOT,
  assertInsidePackage,
  ensureFiles,
  loadToolConfig,
} from '../safety.mjs';
import { buildTools } from '../server.mjs';

import { scanFiles } from '../../../reviewer/src/capabilities.mjs';
import { scanAllInjection } from '../../../reviewer/src/prompt.mjs';

const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url));
const SOURCES = ['server.mjs', 'safety.mjs'];
/** A scratch config, inside the package because the loader's guard requires it. */
const ALT_CONFIG = path.join(FIXTURE_HOME, 'alt.config.json');

async function connect() {
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER] });
  const client = new Client({ name: 'surex-ambiguous-dynamic-test', version: '0.0.0' });
  await client.connect(transport);
  return { client, async close() { await client.close(); await transport.close(); } };
}

const text = (res) => res.content.map((c) => c.text).join('\n');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

let base;

before(async () => {
  ensureFiles();
  base = await connect();
});

after(async () => {
  await base?.close();
  if (fs.existsSync(ALT_CONFIG)) fs.rmSync(ALT_CONFIG);
});

// ---------------------------------------------------------------------------
// it is a real server
// ---------------------------------------------------------------------------

test('server starts and lists the tools the config declares, plus the disclosure', async () => {
  const { tools } = await base.client.listTools();
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    ['describe_tool_source', 'list_notes', 'note_line_count', 'whats_new'],
  );
  for (const t of tools) {
    assert.equal(typeof t.description, 'string');
    assert.ok(t.description.length > 0);
    assert.equal(t.inputSchema?.type, 'object');
  }
});

test('every config-declared tool actually runs', async () => {
  assert.match(text(await base.client.callTool({ name: 'whats_new', arguments: {} })), /tools\.config\.json/);
  assert.match(text(await base.client.callTool({ name: 'list_notes', arguments: {} })), /onboarding\.md/);
  assert.match(
    text(await base.client.callTool({ name: 'note_line_count', arguments: { name: 'onboarding.md' } })),
    /onboarding\.md: \d+ line\(s\)/,
  );
});

test('the disclosure tool names the config file and the closed kind set', async () => {
  const out = text(await base.client.callTool({ name: 'describe_tool_source', arguments: {} }));
  assert.match(out, /tools\.config\.json/);
  assert.match(out, /registered from config: 3/);
  for (const kind of KINDS) assert.ok(out.includes(kind), `expected kind ${kind}`);
  assert.match(out, /only one declared in the source/);
});

test('the declared tool names appear NOWHERE in the source a reviewer reads', () => {
  // The claim of this fixture, asserted rather than asserted-about: the tools it
  // offers cannot be found in its source at all. Every name in the shipped config
  // is checked against every source file.
  const declared = loadToolConfig(CONFIG_PATH).entries.map((e) => e.name);
  assert.ok(declared.length >= 3, 'the shipped config declares tools');
  for (const name of SOURCES) {
    const source = fs.readFileSync(path.join(PACKAGE_ROOT, name), 'utf8');
    for (const tool of declared) {
      assert.ok(!source.includes(tool), `${name} must not contain the tool name "${tool}"`);
    }
  }
  // The one tool that IS in the source is there to be found.
  assert.ok(fs.readFileSync(path.join(PACKAGE_ROOT, 'server.mjs'), 'utf8').includes('describe_tool_source'));
});

test('a missing config is fail-closed: no configured tools, and the disclosure says so', () => {
  const absent = path.join(FIXTURE_HOME, 'does-not-exist.config.json');
  if (fs.existsSync(absent)) fs.rmSync(absent);
  const { tools, loaded } = buildTools(absent);
  assert.deepEqual(Object.keys(tools), ['describe_tool_source']);
  assert.match(loaded.rejected[0].why, /unreadable/);
});

// ---------------------------------------------------------------------------
// the central claim: the surface follows the config, not the source
// ---------------------------------------------------------------------------

test('the SAME server.mjs exposes a different tool list from a different config', async () => {
  const serverBytesBefore = sha(fs.readFileSync(SERVER));
  const original = fs.readFileSync(CONFIG_PATH);

  const augmented = JSON.parse(original.toString('utf8'));
  augmented.tools.push({
    name: 'quarterly_summary',
    description: 'A tool that exists only because a line was added to a JSON file. No source changed.',
    kind: 'static-text',
    text: 'Added by test/dynamic.test.mjs to show the surface follows the config.',
  });

  try {
    fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(augmented, null, 2)}\n`, 'utf8');
    const restarted = await connect();
    try {
      const { tools } = await restarted.client.listTools();
      assert.deepEqual(
        tools.map((t) => t.name).sort(),
        ['describe_tool_source', 'list_notes', 'note_line_count', 'quarterly_summary', 'whats_new'],
      );
      const res = await restarted.client.callTool({ name: 'quarterly_summary', arguments: {} });
      assert.match(text(res), /a line was added to a JSON file|follows the config/);
    } finally {
      await restarted.close();
    }
  } finally {
    fs.writeFileSync(CONFIG_PATH, original);
  }

  // Nothing a reviewer would have read changed.
  assert.equal(sha(fs.readFileSync(SERVER)), serverBytesBefore);
  assert.equal(sha(fs.readFileSync(CONFIG_PATH)), sha(original));
});

test('buildTools follows whichever config it is given', () => {
  fs.writeFileSync(assertInsidePackage(ALT_CONFIG), JSON.stringify({
    tools: [{ name: 'only_this', description: 'The only tool in the alternate config.', kind: 'static-text', text: 'hi' }],
  }, null, 2), 'utf8');
  const { tools, loaded } = buildTools(ALT_CONFIG);
  assert.deepEqual(Object.keys(tools).sort(), ['describe_tool_source', 'only_this']);
  assert.equal(loaded.entries.length, 1);
});

// ---------------------------------------------------------------------------
// fail-closed: data stays data
// ---------------------------------------------------------------------------

test('an entry naming an unknown kind is refused and never registered', () => {
  fs.writeFileSync(assertInsidePackage(ALT_CONFIG), JSON.stringify({
    tools: [
      { name: 'ok_tool', description: 'A valid entry.', kind: 'static-text', text: 'fine' },
      { name: 'run_shell', description: 'Would run a command, if the kind existed.', kind: 'exec' },
      { name: 'phone_home', description: 'Would open a socket, if the kind existed.', kind: 'fetch' },
    ],
  }, null, 2), 'utf8');
  const { tools, loaded } = buildTools(ALT_CONFIG);
  assert.deepEqual(Object.keys(tools).sort(), ['describe_tool_source', 'ok_tool']);
  assert.equal(loaded.rejected.length, 2);
  for (const r of loaded.rejected) assert.match(r.why, /unknown kind/);
});

test('bad names, duplicates, missing fields and oversize lists are refused', () => {
  fs.writeFileSync(assertInsidePackage(ALT_CONFIG), JSON.stringify({
    tools: [
      { name: 'Good_Name_But_Caps', description: 'x', kind: 'static-text', text: 'x' },
      { name: '../../escape', description: 'x', kind: 'static-text', text: 'x' },
      { name: 'no_desc', kind: 'static-text', text: 'x' },
      { name: 'text_missing', description: 'x', kind: 'static-text' },
      { name: 'twice', description: 'x', kind: 'static-text', text: 'x' },
      { name: 'twice', description: 'x', kind: 'static-text', text: 'x' },
      ...Array.from({ length: MAX_TOOLS + 5 }, (_, i) => ({
        name: `filler_${i}`, description: 'x', kind: 'static-text', text: 'x',
      })),
    ],
  }, null, 2), 'utf8');
  const { entries, rejected } = loadToolConfig(ALT_CONFIG);
  assert.ok(!entries.some((e) => /escape|Caps/.test(e.name)));
  assert.ok(entries.length <= MAX_TOOLS);
  assert.ok(rejected.some((r) => /bad tool name/.test(r.why)));
  assert.ok(rejected.some((r) => /duplicate/.test(r.why)));
  assert.ok(rejected.some((r) => /missing description/.test(r.why)));
  assert.ok(rejected.some((r) => /needs a "text" string/.test(r.why)));
  assert.ok(rejected.some((r) => /over the/.test(r.why)));
});

test('a corrupt or empty config registers nothing', () => {
  fs.writeFileSync(assertInsidePackage(ALT_CONFIG), '{ not json', 'utf8');
  const broken = buildTools(ALT_CONFIG);
  assert.deepEqual(Object.keys(broken.tools), ['describe_tool_source']);
  assert.match(broken.loaded.rejected[0].why, /not valid JSON/);

  fs.writeFileSync(assertInsidePackage(ALT_CONFIG), '{}', 'utf8');
  const empty = buildTools(ALT_CONFIG);
  assert.deepEqual(Object.keys(empty.tools), ['describe_tool_source']);
  assert.match(empty.loaded.rejected[0].why, /no "tools" array/);
});

test('a config path outside the package is refused', () => {
  assert.throws(() => loadToolConfig(path.join(PACKAGE_ROOT, '..', 'tools.config.json')), /outside the package/);
  assert.throws(() => loadToolConfig(process.env.USERPROFILE || process.env.HOME || '/'), /outside the package/);
});

test('a note name cannot traverse out of the notes directory', async () => {
  for (const name of ['../../server.mjs', '..\\..\\safety.mjs', '/etc/passwd', 'C:\\Windows\\win.ini']) {
    const res = await base.client.callTool({ name: 'note_line_count', arguments: { name } });
    // basename() reduces each of these to a name that is not in the notes dir.
    assert.equal(res.isError, true, `must refuse ${name}`);
    assert.match(text(res), /No note named/);
  }
  // And the notes directory itself is inside the package.
  assert.ok(NOTES_DIR.startsWith(FIXTURE_HOME + path.sep));
  assert.ok(FIXTURE_HOME.startsWith(PACKAGE_ROOT + path.sep));
});

test('there is no dynamic code path anywhere in the fixture', () => {
  for (const name of SOURCES) {
    const source = fs.readFileSync(path.join(PACKAGE_ROOT, name), 'utf8');
    assert.doesNotMatch(source, /\beval\s*\(/, `${name}: eval`);
    assert.doesNotMatch(source, /new\s+Function\s*\(/, `${name}: new Function`);
    assert.doesNotMatch(source, /\bimport\s*\(/, `${name}: dynamic import`);
    assert.doesNotMatch(source, /node:vm|child_process/, `${name}: vm or child_process`);
    assert.doesNotMatch(source, /\bfetch\s*\(|node:http/, `${name}: network`);
    assert.doesNotMatch(source, /process\.env/, `${name}: env`);
  }
});

// ---------------------------------------------------------------------------
// what SureX's own deterministic lanes see
// ---------------------------------------------------------------------------

test('the capability scan reports filesystem only — and cannot see the tool list', () => {
  const files = SOURCES.map((name) => ({
    path: `packages/fixtures/ambiguous-dynamic/${name}`,
    text: fs.readFileSync(path.join(PACKAGE_ROOT, name), 'utf8'),
  }));
  const { capabilities } = scanFiles(files);
  assert.equal(capabilities.filesystem.present, true);
  assert.equal(capabilities.network.present, false);
  assert.equal(capabilities.exec.present, false);
  assert.equal(capabilities.env.present, false);
  assert.equal(capabilities.credentials.present, false);
});

test('nothing in this fixture — source or shipped config — is addressed to whoever reviews it', () => {
  const files = [...SOURCES, 'tools.config.json', 'README.md', 'SAFETY.md'].map((name) => ({
    path: `packages/fixtures/ambiguous-dynamic/${name}`,
    text: fs.readFileSync(path.join(PACKAGE_ROOT, name), 'utf8'),
  }));
  const { tools } = buildTools(CONFIG_PATH);
  const hits = scanAllInjection({
    files,
    statedIntent: {
      tools: Object.values(tools).map((t) => t.definition),
      readme: fs.readFileSync(path.join(PACKAGE_ROOT, 'README.md'), 'utf8'),
    },
  });
  assert.deepEqual(hits, [], `unexpected injection hits: ${JSON.stringify(hits, null, 2)}`);
});
