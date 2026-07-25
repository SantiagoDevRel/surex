import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalise,
  fingerprint,
  normaliseRunner,
  parseNpmSpec,
  parseServerFromToolName,
  stableStringify,
  tierOf,
} from '../src/sxf1.mjs';

const npx = (args, env) => ({ command: 'npx', args, ...(env ? { env } : {}) });

test('the same server installed from different runner paths fingerprints identically', () => {
  const a = fingerprint({ command: '/usr/local/bin/npx', args: ['-y', 'pkg@1.2.3'] });
  const b = fingerprint({ command: '/opt/homebrew/bin/npx', args: ['-y', 'pkg@1.2.3'] });
  const c = fingerprint({ command: 'C:\\Program Files\\nodejs\\npx.cmd', args: ['-y', 'pkg@1.2.3'] });
  assert.equal(a, b);
  assert.equal(b, c);
});

test('runner normalisation keeps unknown runners distinguishable', () => {
  assert.equal(normaliseRunner('/usr/bin/uvx'), 'uvx');
  assert.equal(normaliseRunner('NPX.EXE'), 'npx');
  assert.equal(normaliseRunner('/opt/weird/launcher'), 'other:launcher');
});

test('pinned and unpinned are different registry entries — never collapse them', () => {
  const pinned = fingerprint(npx(['-y', '@modelcontextprotocol/server-github@1.2.3']));
  const floating = fingerprint(npx(['-y', '@modelcontextprotocol/server-github']));
  assert.notEqual(pinned, floating);
});

test('a range or dist-tag is not a pin', () => {
  for (const spec of ['pkg@^1.2.3', 'pkg@~1.2.3', 'pkg@latest', 'pkg@next', 'pkg@*']) {
    assert.equal(parseNpmSpec(spec).version, 'unpinned', spec);
  }
  assert.equal(parseNpmSpec('pkg@1.2.3').version, '1.2.3');
  assert.equal(parseNpmSpec('pkg').version, 'unpinned');
});

test('scoped package names survive the @ split', () => {
  assert.deepEqual(parseNpmSpec('@scope/name@1.2.3'), { name: '@scope/name', version: '1.2.3' });
  assert.deepEqual(parseNpmSpec('@scope/name'), { name: '@scope/name', version: 'unpinned' });
});

test('a git or file install can never be pinned', () => {
  for (const spec of ['git+https://x/y.git', 'github:owner/repo', 'file:../local', 'owner/repo#main']) {
    assert.equal(parseNpmSpec(spec).version, 'unpinned', spec);
  }
});

test('env is excluded entirely — two developers with different secrets are one entry', () => {
  const a = fingerprint(npx(['-y', 'pkg@1.0.0'], { TOKEN: 'ghp_aaa', HOME: '/home/ana' }));
  const b = fingerprint(npx(['-y', 'pkg@1.0.0'], { TOKEN: 'ghp_bbb' }));
  const c = fingerprint(npx(['-y', 'pkg@1.0.0']));
  assert.equal(a, b);
  assert.equal(b, c);
});

test('residual arg ORDER is preserved — most CLIs are order-sensitive', () => {
  const a = fingerprint(npx(['-y', 'pkg@1.0.0', '--mode', 'fast', '--read-only']));
  const b = fingerprint(npx(['-y', 'pkg@1.0.0', '--read-only', '--mode', 'fast']));
  assert.notEqual(a, b, 'sorting args would collapse two different servers onto one fingerprint');
});

test('ceremony, transient flags and absolute paths are stripped', () => {
  const canonical = canonicalise(
    npx(['-y', '--quiet', 'pkg@1.0.0', '--port', '8931', '--debug', '/home/ana/data', '--read-only']),
  );
  assert.deepEqual(canonical.args, ['--read-only']);
  assert.deepEqual(canonical.package, { name: 'pkg', version: '1.0.0' });
});

test('--port and its value are dropped together, not just the flag', () => {
  const a = fingerprint(npx(['-y', 'pkg@1.0.0', '--port', '3000', '--read-only']));
  const b = fingerprint(npx(['-y', 'pkg@1.0.0', '--port', '4000', '--read-only']));
  assert.equal(a, b, 'the port number must not orphan into the residual args');
});

test('docker: a sha256 digest counts as pinned, a floating tag does not', () => {
  const digest = canonicalise({
    command: 'docker',
    args: ['run', '--rm', '-i', '-e', 'TOKEN', 'ghcr.io/acme/mcp@sha256:abc123', '--serve'],
  });
  assert.equal(digest.package.name, 'ghcr.io/acme/mcp');
  assert.equal(digest.package.version, 'sha256:abc123');
  assert.deepEqual(digest.args, ['--serve']);

  const latest = canonicalise({ command: 'docker', args: ['run', '--rm', 'ghcr.io/acme/mcp:latest'] });
  assert.equal(latest.package.version, 'unpinned');

  const tagged = canonicalise({ command: 'docker', args: ['run', 'acme/mcp:2.1.0'] });
  assert.equal(tagged.package.version, '2.1.0');
});

test('a registry host with a port is not mistaken for a tag', () => {
  const c = canonicalise({ command: 'docker', args: ['run', 'localhost:5000/acme/mcp'] });
  assert.equal(c.package.name, 'localhost:5000/acme/mcp');
  assert.equal(c.package.version, 'unpinned');
});

test('uvx accepts pip-style pins', () => {
  const c = canonicalise({ command: 'uvx', args: ['mcp-server-git==0.6.2', '--repo', 'x'] });
  assert.deepEqual(c.package, { name: 'mcp-server-git', version: '0.6.2' });
});

test('THE PORTABILITY TEST: the same server on Windows and macOS is ONE entry', () => {
  // Found by running the gate against a real machine, not by writing a test
  // first. Every MCP server in a Windows config is `cmd /c npx <pkg>`; the same
  // server on macOS is `npx <pkg>`. Without unwrapping, the two hash
  // differently AND the Windows form loses the package name entirely — the gate
  // would look like it worked while recognising nothing (failure-modes §3.1).
  const windows = { command: 'cmd', args: ['/c', 'npx', '@playwright/mcp@1.2.3'] };
  const macos = { command: 'npx', args: ['@playwright/mcp@1.2.3'] };
  assert.equal(fingerprint(windows), fingerprint(macos));
  assert.deepEqual(canonicalise(windows).package, { name: '@playwright/mcp', version: '1.2.3' });
});

test('sh -c with a single quoted string unwraps too', () => {
  const viaSh = { command: '/bin/sh', args: ['-c', 'npx -y @acme/mcp@2.0.0 --read-only'] };
  const direct = { command: 'npx', args: ['-y', '@acme/mcp@2.0.0', '--read-only'] };
  assert.equal(fingerprint(viaSh), fingerprint(direct));
});

test('a proxy shim resolves to the endpoint behind it, not the shim', () => {
  // `npx mcp-remote <url>` is a remote server wearing a stdio costume.
  // Fingerprinting the shim would file every remote server under one entry.
  const viaProxy = canonicalise({ command: 'cmd', args: ['/c', 'npx', 'mcp-remote', 'https://mcp.vercel.com'] });
  assert.equal(viaProxy.transport, 'http');
  assert.equal(viaProxy.host, 'mcp.vercel.com');
  assert.equal(
    fingerprint({ command: 'npx', args: ['mcp-remote', 'https://mcp.vercel.com'] }),
    fingerprint({ type: 'http', url: 'https://mcp.vercel.com' }),
  );
  // A proxy with no visible URL must NOT become a wrong remote entry.
  assert.equal(canonicalise({ command: 'npx', args: ['mcp-remote'] }).transport, 'stdio');
});

test('unwrapping is bounded and never loses a non-wrapper command', () => {
  const plain = { command: 'node', args: ['./server.js'] };
  assert.equal(canonicalise(plain).runner, 'node');
  // `cmd` with no /c is not a wrapper invocation; leave it alone.
  assert.equal(canonicalise({ command: 'cmd', args: ['something'] }).runner, 'other:cmd');
});

test('a remote server identifies an endpoint, and is always tier C', () => {
  const c = canonicalise({ type: 'http', url: 'https://MCP.Stripe.com:443/v1/?x=1' });
  assert.deepEqual(c, { v: 'SXF-1', transport: 'http', host: 'mcp.stripe.com', path: '/v1' });
  assert.equal(tierOf(c), 'C');
  // query string and trailing slash must not change identity
  assert.equal(
    fingerprint({ type: 'http', url: 'https://mcp.stripe.com/v1' }),
    fingerprint({ type: 'http', url: 'https://mcp.stripe.com/v1/?session=abc' }),
  );
});

test('tier: A needs both digests and they must agree; a mismatch is its own state', () => {
  const pinned = canonicalise(npx(['-y', 'pkg@1.0.0']));
  assert.equal(tierOf(pinned), 'B', 'pinned but no digest available');
  assert.equal(tierOf(pinned, { recordedIntegrity: 'sha512-x', localIntegrity: 'sha512-x' }), 'A');
  assert.equal(tierOf(pinned, { recordedIntegrity: 'sha512-x', localIntegrity: 'sha512-y' }), 'MISMATCH');
  assert.equal(tierOf(canonicalise(npx(['-y', 'pkg']))), 'C', 'unpinned is always C');
});

test('the hash does not depend on key insertion order', () => {
  assert.equal(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }));
});

test('fingerprints are stable across runs and carry the version prefix', () => {
  const fp = fingerprint(npx(['-y', '@modelcontextprotocol/server-github@1.2.3']));
  assert.match(fp, /^sxf1_[0-9a-f]{64}$/);
  assert.equal(fp, fingerprint(npx(['-y', '@modelcontextprotocol/server-github@1.2.3'])));
});

test('server name parses out of tool_name, including the plugin shape', () => {
  assert.deepEqual(parseServerFromToolName('mcp__github__create_issue'), {
    plugin: null, server: 'github', tool: 'create_issue',
  });
  // The case a naive three-way split on __ gets wrong.
  assert.deepEqual(parseServerFromToolName('mcp__plugin_vercel_vercel__deploy_to_vercel'), {
    plugin: 'vercel', server: 'vercel', tool: 'deploy_to_vercel',
  });
  // A server name that itself contains an underscore.
  assert.deepEqual(parseServerFromToolName('mcp__my_server__do_thing'), {
    plugin: null, server: 'my_server', tool: 'do_thing',
  });
  assert.equal(parseServerFromToolName('Bash'), null);
});
