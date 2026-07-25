/*
 * ===========================================================================
 *  AMBIGUOUS REVIEW FIXTURE — authored by the SureX project.
 *  NOT MALICIOUS. NOT FOR PRODUCTION USE. See ../SAFETY.md and ../../AMBIGUOUS.md.
 * ===========================================================================
 *
 * Starts the REAL bin over stdio, then MEASURES the blind spot with SureX's own
 * deterministic capability scan: all five categories absent for server.mjs alone,
 * filesystem + env present once the vendored dependency is handed over too.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { TOOLS } from '../server.mjs';
import {
  FIXTURE_HOME,
  FIXTURE_ROOT,
  MAX_WRITE_BYTES,
  assertInsideFixture,
  ensureWorkspace,
  workspaceDir,
} from '../vendor/workspace-toolkit/index.mjs';

import { CATEGORIES, scanFiles, stripComments } from '../../../reviewer/src/capabilities.mjs';
import { scanAllInjection } from '../../../reviewer/src/prompt.mjs';

const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url));
const SERVER_REL = 'packages/fixtures/ambiguous-deps/server.mjs';
const DEP_REL = 'packages/fixtures/ambiguous-deps/vendor/workspace-toolkit/index.mjs';
const DEP_ABS = fileURLToPath(new URL('../vendor/workspace-toolkit/index.mjs', import.meta.url));

async function connect(env = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: { ...process.env, ...env },
  });
  const client = new Client({ name: 'surex-ambiguous-deps-test', version: '0.0.0' });
  await client.connect(transport);
  return { client, async close() { await client.close(); await transport.close(); } };
}

const text = (res) => res.content.map((c) => c.text).join('\n');
const source = (abs) => fs.readFileSync(abs, 'utf8');

let base;

before(async () => {
  ensureWorkspace();
  base = await connect({ WORKSPACE_TOOLKIT_SUBDIR: '' });
});

after(async () => {
  await base?.close();
});

// ---------------------------------------------------------------------------
// it is a real server
// ---------------------------------------------------------------------------

test('server starts, initializes, and lists its declared tools', async () => {
  const { tools } = await base.client.listTools();
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    ['describe_implementation', 'list_workspace', 'read_workspace_file', 'write_workspace_note'],
  );
  for (const t of tools) {
    assert.equal(typeof t.description, 'string');
    assert.equal(t.inputSchema?.type, 'object');
  }
});

test('the three working tools run end to end', async () => {
  const listed = text(await base.client.callTool({ name: 'list_workspace', arguments: {} }));
  assert.match(listed, /notes\.md/);

  const read = text(await base.client.callTool({ name: 'read_workspace_file', arguments: { name: 'notes.md' } }));
  assert.match(read, /# Notes/);

  const written = text(await base.client.callTool({
    name: 'write_workspace_note',
    arguments: { name: 'from-the-test', body: '# Written by deps.test.mjs\n' },
  }));
  assert.match(written, /Wrote from-the-test\.md \(\d+ bytes\)/);

  const after = text(await base.client.callTool({ name: 'list_workspace', arguments: {} }));
  assert.match(after, /from-the-test\.md/);
});

test('the disclosure tool names the dependency and its capabilities', async () => {
  const out = text(await base.client.callTool({ name: 'describe_implementation', arguments: {} }));
  assert.match(out, /workspace-toolkit@2\.4\.1/);
  assert.match(out, /vendor\/workspace-toolkit\/index\.mjs/);
  assert.match(out, /filesystem/);
  assert.match(out, /environment/);
});

// ---------------------------------------------------------------------------
// the measurement — the reason this fixture exists
// ---------------------------------------------------------------------------

test('the capability scan finds NOTHING in the server file alone', () => {
  const { capabilities } = scanFiles([{ path: SERVER_REL, text: source(SERVER) }]);
  for (const category of CATEGORIES) {
    assert.equal(
      capabilities[category].present,
      false,
      `${category} should be absent for server.mjs alone, got: ${JSON.stringify(capabilities[category].evidence)}`,
    );
  }
});

test('the same scan finds filesystem and env once the dependency is included', () => {
  const { capabilities } = scanFiles([
    { path: SERVER_REL, text: source(SERVER) },
    { path: DEP_REL, text: source(DEP_ABS) },
  ]);
  assert.equal(capabilities.filesystem.present, true);
  assert.equal(capabilities.env.present, true);
  assert.equal(capabilities.network.present, false);
  assert.equal(capabilities.exec.present, false);
  assert.equal(capabilities.credentials.present, false);
  // Every piece of evidence cites the dependency, never the server.
  for (const category of ['filesystem', 'env']) {
    for (const evidence of capabilities[category].evidence) {
      assert.ok(evidence.startsWith(DEP_REL), `evidence should cite the dependency: ${evidence}`);
    }
  }
});

test('the server file really is free of every capability, by inspection too', () => {
  // Comments are stripped with the scanner's own function: the banner in this file
  // *names* the capabilities it does not use, and a comment is not code — which is
  // the same reason the capability scan strips them.
  const code = stripComments(source(SERVER), 'js');
  for (const pattern of [/node:fs/, /\bfetch\s*\(/, /node:child_process/, /process\.env/, /node:net/, /\beval\s*\(/]) {
    assert.doesNotMatch(code, pattern, `server.mjs must not contain ${pattern} outside a comment`);
  }
  const text_ = source(SERVER);
  // It imports the dependency by a specifier that looks like a package name, which
  // is the ordinary case and the reason a scan of this file learns nothing.
  assert.match(text_, /from '#workspace-toolkit'/);
});

// ---------------------------------------------------------------------------
// the dependency is clamped
// ---------------------------------------------------------------------------

test('the workspace resolves inside the fixture', () => {
  assert.ok(FIXTURE_HOME.startsWith(FIXTURE_ROOT + path.sep));
  assert.ok(workspaceDir().startsWith(FIXTURE_HOME + path.sep));
  assert.throws(() => assertInsideFixture(path.join(FIXTURE_ROOT, 'server.mjs')), /outside the workspace/);
  assert.throws(() => assertInsideFixture(process.env.USERPROFILE || process.env.HOME || '/'), /outside the workspace/);
});

test('a read or write name cannot leave the workspace', async () => {
  for (const name of ['../../server.mjs', '..\\..\\package.json', '/etc/passwd', 'C:\\Windows\\win.ini', '..', '']) {
    const res = await base.client.callTool({ name: 'read_workspace_file', arguments: { name } });
    assert.equal(res.isError, true, `must refuse read of ${JSON.stringify(name)}`);
  }
  // A write with a traversing name lands inside the workspace under a safe name.
  const res = await base.client.callTool({
    name: 'write_workspace_note',
    arguments: { name: '../../escaped', body: 'should not escape' },
  });
  assert.match(text(res), /Wrote escaped\.md/);
  assert.ok(fs.existsSync(path.join(workspaceDir(), 'escaped.md')));
  assert.ok(!fs.existsSync(path.join(FIXTURE_ROOT, 'escaped.md')), 'nothing may be written beside the source');
  fs.rmSync(path.join(workspaceDir(), 'escaped.md'));
});

test('a note is always written as .md, so it cannot become loadable code', async () => {
  const res = await base.client.callTool({
    name: 'write_workspace_note',
    arguments: { name: 'payload.mjs', body: 'process.exit(1)' },
  });
  assert.match(text(res), /Wrote payload\.mjs\.md/);
  assert.ok(fs.existsSync(path.join(workspaceDir(), 'payload.mjs.md')));
  assert.ok(!fs.existsSync(path.join(workspaceDir(), 'payload.mjs')));
  fs.rmSync(path.join(workspaceDir(), 'payload.mjs.md'));
});

test('the write bound holds', async () => {
  const res = await base.client.callTool({
    name: 'write_workspace_note',
    arguments: { name: 'too-big', body: 'x'.repeat(MAX_WRITE_BYTES + 1) },
  });
  assert.equal(res.isError, true);
  assert.match(text(res), /over the \d+-byte write limit/);
});

test('WORKSPACE_TOOLKIT_SUBDIR selects a subdirectory and cannot escape', async () => {
  const traversal = await connect({ WORKSPACE_TOOLKIT_SUBDIR: '../..' });
  try {
    // It falls back to the default rather than pointing at the repo.
    const listed = text(await traversal.client.callTool({ name: 'list_workspace', arguments: {} }));
    assert.match(listed, /notes\.md/);
    assert.ok(!listed.includes('server.mjs'), 'the toolkit must not list the fixture source');
    assert.ok(!listed.includes('package.json'), 'the toolkit must not list the fixture source');
  } finally {
    await traversal.close();
  }

  const named = await connect({ WORKSPACE_TOOLKIT_SUBDIR: 'other-project' });
  try {
    const listed = text(await named.client.callTool({ name: 'list_workspace', arguments: {} }));
    // A fresh subdirectory, seeded, still inside fixture-home.
    assert.match(listed, /README\.md/);
    assert.ok(fs.existsSync(path.join(FIXTURE_HOME, 'other-project')));
  } finally {
    await named.close();
  }
});

test('nothing in this fixture — server or dependency — is addressed to whoever reviews it', () => {
  const files = [
    { path: SERVER_REL, text: source(SERVER) },
    { path: DEP_REL, text: source(DEP_ABS) },
    { path: 'packages/fixtures/ambiguous-deps/README.md', text: source(fileURLToPath(new URL('../README.md', import.meta.url))) },
    { path: 'packages/fixtures/ambiguous-deps/SAFETY.md', text: source(fileURLToPath(new URL('../SAFETY.md', import.meta.url))) },
  ];
  const hits = scanAllInjection({
    files,
    statedIntent: {
      tools: Object.values(TOOLS).map((t) => t.definition),
      readme: source(fileURLToPath(new URL('../README.md', import.meta.url))),
    },
  });
  assert.deepEqual(hits, [], `unexpected injection hits: ${JSON.stringify(hits, null, 2)}`);
});
