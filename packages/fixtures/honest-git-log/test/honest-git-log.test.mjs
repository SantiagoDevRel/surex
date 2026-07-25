// honest-git-log: starts the REAL bin over stdio, and pins the invariants that make
// declared exec safe to run — a pinned argument list, no shell, and a repository the
// fixture created for itself rather than the one it happens to sit inside.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { scanCapabilities, stripComments } from '../../../reviewer/src/capabilities.mjs';
import {
  PACKAGE_ROOT,
  FIXTURE_HOME,
  REPO_DIR,
  GIT_DIR,
  GIT_BIN,
  MAX_COUNT,
  PINNED_ARGV,
  ALLOWED_ARGV_ELEMENTS,
  TOOLS,
  assertInsidePackage,
  assertPinnedArgv,
} from '../server.mjs';

const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url));
const DECLARED_TOOLS = ['git_version', 'recent_commits'];

/** Whether git is on this machine at all. Everything that needs it skips if not. */
const GIT_AVAILABLE = (() => {
  try {
    execFileSync(GIT_BIN, ['--version'], { stdio: 'ignore', timeout: 10_000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
})();

let client;
let transport;

before(async () => {
  transport = new StdioClientTransport({ command: process.execPath, args: [SERVER] });
  client = new Client({ name: 'surex-honest-git-log-test', version: '0.0.0' });
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

test('every description declares that it starts a child process, and how', async () => {
  const { tools } = await client.listTools();
  for (const tool of tools) {
    assert.match(tool.description, /starts a child process/i, `${tool.name} must declare exec`);
    assert.match(tool.description, /execFile with an argument array/, `${tool.name} must say how`);
    assert.match(tool.description, /no shell is spawned/i, `${tool.name} must rule out a shell`);
    assert.match(tool.description, /allowlist/i, `${tool.name} must mention the pinned allowlist`);
    assert.match(tool.description, /inherits this process's environment/, `${tool.name} must be precise about env`);
  }
});

test('recent_commits declares the exact argv it runs', async () => {
  const { tools } = await client.listTools();
  const tool = tools.find((t) => t.name === 'recent_commits');
  assert.match(tool.description, /--git-dir/);
  assert.match(tool.description, /--work-tree/);
  assert.match(tool.description, /--format=%h%x09%ad%x09%s/);
  assert.match(tool.description, /--date=short/);
  assert.match(tool.description, new RegExp(`1-${MAX_COUNT}`));
});

test('git_version runs the child process end to end', async (t) => {
  if (!GIT_AVAILABLE) return t.skip('git is not installed on this machine');
  const res = await client.callTool({ name: 'git_version', arguments: {} });
  assert.match(res.content.map((c) => c.text).join('\n'), /git version \d+\./);
});

test('recent_commits returns the two commits the fixture made itself', async (t) => {
  if (!GIT_AVAILABLE) return t.skip('git is not installed on this machine');
  const res = await client.callTool({ name: 'recent_commits', arguments: { count: 10 } });
  const text = res.content.map((c) => c.text).join('\n');
  assert.match(text, /Extend the fixture note with a second line/);
  assert.match(text, /Add the fixture note/);
  assert.match(text, /2 commit\(s\)/, 'its own repository has exactly the two commits it seeded');
  assert.ok(!/SureX: a trust registry/.test(text), 'it must not be reading the surrounding repository');
});

test('an absurd count is clamped rather than passed through', async (t) => {
  if (!GIT_AVAILABLE) return t.skip('git is not installed on this machine');
  const res = await client.callTool({ name: 'recent_commits', arguments: { count: 999999 } });
  const text = res.content.map((c) => c.text).join('\n');
  assert.match(text, new RegExp(`max-count ${MAX_COUNT}`));
});

// ---------------------------------------------------------------------------
// safety invariants
// ---------------------------------------------------------------------------

test('the repository it reads is inside the package directory', () => {
  assert.ok(path.resolve(REPO_DIR).startsWith(PACKAGE_ROOT + path.sep));
  assert.ok(path.resolve(GIT_DIR).startsWith(FIXTURE_HOME + path.sep));
});

test('the pinned argv always names its own git directory explicitly', () => {
  const gitDirForGit = path.resolve(GIT_DIR).split(path.sep).join('/');
  for (const argv of [PINNED_ARGV.add, PINNED_ARGV.log(5), PINNED_ARGV.commit('Add the fixture note')]) {
    const at = argv.indexOf('--git-dir');
    assert.ok(at !== -1, `--git-dir must be present in: ${argv.join(' ')}`);
    assert.equal(argv[at + 1], gitDirForGit, 'and it must point at the fixture\'s own repository');
  }
});

test('assertPinnedArgv accepts every list the server can build', () => {
  assert.doesNotThrow(() => assertPinnedArgv(PINNED_ARGV.version));
  assert.doesNotThrow(() => assertPinnedArgv(PINNED_ARGV.init));
  assert.doesNotThrow(() => assertPinnedArgv(PINNED_ARGV.add));
  assert.doesNotThrow(() => assertPinnedArgv(PINNED_ARGV.commit('Add the fixture note')));
  for (const count of [1, 7, 10, MAX_COUNT]) {
    assert.doesNotThrow(() => assertPinnedArgv(PINNED_ARGV.log(count)), `--max-count=${count} should be allowed`);
  }
});

test('assertPinnedArgv refuses anything else, including the obvious attacks', () => {
  const refused = [
    ['log', '--max-count=51'],                       // past the clamp
    ['log', '--max-count=0'],                        // below the clamp
    ['log', '--max-count=5; rm -rf /'],              // a shell attempt in the numeric slot
    ['log', '--max-count=-1'],
    ['--exec-path=/tmp/evil'],                       // git's own escape hatches
    ['--upload-pack=/tmp/evil'],
    ['-c', 'core.pager=/tmp/evil'],
    ['-c', 'core.hooksPath=/tmp/evil-hooks'],
    ['clone', 'https://example.com/x.git'],          // a subcommand that reaches the network
    ['push', 'origin', 'main'],
    ['config', '--global', 'user.email', 'x@y.z'],   // touching the developer's config
    ['log', '--all'],
    ['--git-dir', path.join(os.homedir(), '.git')],  // someone else's repository
  ];
  for (const argv of refused) {
    assert.throws(() => assertPinnedArgv(argv), /not pinned|empty argument list/, `must refuse: ${argv.join(' ')}`);
  }
  assert.throws(() => assertPinnedArgv([]), /empty argument list/);
  assert.throws(() => assertPinnedArgv(['log', 5]), /non-string/);
});

test('the allowlist contains no path outside the package, and no network-capable subcommand', () => {
  for (const element of ALLOWED_ARGV_ELEMENTS) {
    assert.ok(!/^https?:\/\//.test(element), `no URL may be pinned: ${element}`);
    // Config elements carry their value after "=", so check that half too — this is
    // what keeps `core.hooksPath=` pointed inside the package rather than at a
    // developer's global hooks directory.
    const candidate = element.includes('=') ? element.slice(element.indexOf('=') + 1) : element;
    if (/^([A-Za-z]:[/\\]|[/\\])/.test(candidate)) {
      assert.doesNotThrow(() => assertInsidePackage(candidate), `pinned path must be inside the package: ${element}`);
    }
  }
  for (const subcommand of ['clone', 'fetch', 'push', 'pull', 'remote', 'submodule', 'config', 'daemon']) {
    assert.ok(!ALLOWED_ARGV_ELEMENTS.has(subcommand), `${subcommand} must not be pinned`);
  }
});

test('assertInsidePackage refuses paths outside the package', () => {
  assert.throws(() => assertInsidePackage(path.join(PACKAGE_ROOT, '..', 'escape')), /outside the package/);
  assert.throws(() => assertInsidePackage(os.homedir()), /outside the package/);
  assert.doesNotThrow(() => assertInsidePackage(REPO_DIR));
});

test('the server never passes a shell option to the child process', () => {
  // Checked against the comment-stripped source, the same view the capability scan
  // takes — the banner in this server names `execFile()` in prose, and prose is not
  // a call site.
  const code = stripComments(fs.readFileSync(SERVER, 'utf8'), 'js');
  assert.ok(!/shell\s*:\s*true/.test(code), 'shell: true must never appear');
  assert.ok(!/(?<![.\w$])spawn\s*\(/.test(code), 'only execFile is used');
  assert.ok(!/\bexecSync\s*\(|\bexecFileSync\s*\(/.test(code), 'no synchronous shell-capable variant');
  // Exactly one place starts a process, so there is one thing to audit.
  assert.equal((code.match(/(?<![.\w$])execFile\s*\(/g) ?? []).length, 1);
});

test('the capability surface is exec and filesystem — both declared', () => {
  const text = fs.readFileSync(SERVER, 'utf8');
  const capabilities = scanCapabilities([{ path: 'server.mjs', text }]);
  assert.equal(capabilities.exec.present, true, 'exec is present, and it is declared');
  assert.ok(capabilities.exec.evidence.some((e) => /execFile\(\)|child_process/.test(e)));
  assert.equal(capabilities.filesystem.present, true, 'filesystem is present, and it is declared');
  for (const absent of ['network', 'env', 'credentials']) {
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
