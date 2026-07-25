// The repository inspector: what it pins, what it refuses, and the one thing it
// must never do — turn a failed request into a claim about somebody's repo.
//
// Node 22 strips types, so this runs against the same `.ts` the app imports.

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseRepo, detectMcp, inspectRepo, MCP_PROBE_PATHS } from '../lib/github.ts';

// ---------------------------------------------------------------------------
// parsing what people actually paste
// ---------------------------------------------------------------------------

test('every shape of a GitHub URL a person might paste', () => {
  const expected = { owner: 'acme', repo: 'acme-mcp' };
  for (const input of [
    'github.com/acme/acme-mcp',
    'https://github.com/acme/acme-mcp',
    'http://github.com/acme/acme-mcp/',
    'https://github.com/acme/acme-mcp.git',
    'https://github.com/acme/acme-mcp/tree/main/src',
    'git@github.com:acme/acme-mcp.git',
    '  github.com/acme/acme-mcp  ',
    'acme/acme-mcp',
  ]) {
    assert.deepEqual(parseRepo(input), expected, input);
  }
});

test('nonsense is rejected rather than turned into a 404 later', () => {
  for (const input of ['', '   ', 'acme', 'https://gitlab.com/acme/x', 'github.com/acme']) {
    assert.equal(parseRepo(input), null, JSON.stringify(input));
  }
});

// ---------------------------------------------------------------------------
// is this an MCP server?
// ---------------------------------------------------------------------------

const file = (path, text) => ({ path, text });
const absent = (path) => ({ path, text: null });
const allAbsent = MCP_PROBE_PATHS.map(absent);

test('the SDK dependency is the signal, and the answer quotes it', () => {
  const r = detectMcp([
    file('package.json', JSON.stringify({ dependencies: { '@modelcontextprotocol/sdk': '^1.12.0' } })),
    ...allAbsent.slice(1),
  ]);
  assert.equal(r.isMcp, true);
  assert.equal(r.undetermined, false);
  assert.equal(r.signal, '@modelcontextprotocol/sdk');
});

test('a dev-only or peer dependency counts too', () => {
  for (const key of ['devDependencies', 'peerDependencies']) {
    const r = detectMcp([file('package.json', JSON.stringify({ [key]: { '@modelcontextprotocol/sdk': '^1' } }))]);
    assert.equal(r.isMcp, true, key);
  }
});

test('the known frameworks count', () => {
  for (const dep of ['fastmcp', 'mcp-framework', 'xmcp', 'mcp-handler']) {
    const r = detectMcp([file('package.json', JSON.stringify({ dependencies: { [dep]: '^1' } }))]);
    assert.equal(r.isMcp, true, dep);
    assert.equal(r.signal, dep);
  }
});

test('a Python MCP server is recognised', () => {
  const r = detectMcp([absent('package.json'), absent('server.json'), file('pyproject.toml', 'dependencies = [\n  "mcp>=1.2",\n]')]);
  assert.equal(r.isMcp, true);
  assert.equal(r.signal, 'pyproject.toml');
});

test('an MCP manifest at the root is a declaration', () => {
  const r = detectMcp([
    absent('package.json'),
    file('server.json', JSON.stringify({ $schema: 'https://…/mcp/server.schema.json', name: 'io.acme/mcp', packages: [] })),
  ]);
  assert.equal(r.isMcp, true);
});

test('a repository that is simply not an MCP server is refused, definitively', () => {
  const r = detectMcp([
    file('package.json', JSON.stringify({ name: 'a-website', dependencies: { next: '^15' } })),
    ...allAbsent.slice(1),
  ]);
  assert.equal(r.isMcp, false);
  assert.equal(r.undetermined, false, 'manifests were read and contained no signal — that is an answer');
});

test('UNREADABLE manifests are undetermined, NEVER "not an MCP server"', () => {
  // The rule the licence gate had to learn (FRICTION-LOG D10). GitHub rate-limits
  // an unauthenticated browser at 60 requests an hour; if that read as "no signals
  // found", the form would tell a maintainer their MCP server is not one.
  const r = detectMcp(MCP_PROBE_PATHS.map((p) => ({ path: p, text: null, unreachable: true })));
  assert.equal(r.undetermined, true);
  assert.equal(r.isMcp, false, 'still not a positive — but the caller must not refuse on it');
  assert.match(r.detail, /not a statement about the repository/i);
});

test('a package.json that will not parse is not evidence either way', () => {
  const r = detectMcp([file('package.json', '{ this is not json'), ...allAbsent.slice(1)]);
  assert.equal(r.isMcp, false);
  assert.equal(r.undetermined, false, 'the file was READ; it just says nothing');
});

// ---------------------------------------------------------------------------
// end to end, with a scripted network
// ---------------------------------------------------------------------------

function scriptedFetch(routes) {
  return async (url) => {
    // `key !== undefined`, not `key ?` — a catch-all route keyed on the empty
    // string is a legitimate pattern and `''` is falsy, so the truthiness check
    // silently routed every request to the 404 default and the rate-limit case
    // tested nothing.
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    const reply = key !== undefined ? routes[key] : { status: 404 };
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      async json() { return reply.body; },
      async text() { return typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body); },
    };
  };
}

test('the release tag AND its commit SHA are both captured', () => inspectRepo('github.com/acme/acme-mcp', {
  fetchImpl: scriptedFetch({
    '/releases/latest': { status: 200, body: { tag_name: 'v2.3.0' } },
    '/commits/v2.3.0': { status: 200, body: { sha: 'a'.repeat(40) } },
    'package.json': { status: 200, body: JSON.stringify({ dependencies: { '@modelcontextprotocol/sdk': '^1' } }) },
  }),
}).then((r) => {
  assert.equal(r.release.tag, 'v2.3.0');
  assert.equal(r.release.sha, 'a'.repeat(40), 'the SHA is what pins the bytes; the tag can be repointed');
  assert.equal(r.release.source, 'release');
  assert.equal(r.mcp.isMcp, true);
  assert.deepEqual(r.problems, []);
}));

test('no releases falls back to the newest tag, and says so', () => inspectRepo('acme/acme-mcp', {
  fetchImpl: scriptedFetch({
    '/releases/latest': { status: 404 },
    '/tags': { status: 200, body: [{ name: 'v0.1.0' }] },
    '/commits/': { status: 200, body: { sha: 'b'.repeat(40) } },
    'package.json': { status: 200, body: JSON.stringify({ keywords: ['mcp'] }) },
  }),
}).then((r) => {
  assert.equal(r.release.tag, 'v0.1.0');
  assert.equal(r.release.source, 'tag');
}));

test('a rate limit is reported as a problem, not as a verdict about the repo', () => inspectRepo('acme/acme-mcp', {
  fetchImpl: scriptedFetch({ '': { status: 403 } }),
}).then((r) => {
  assert.ok(r.problems.some((p) => /rate-limited/i.test(p)), JSON.stringify(r.problems));
  assert.equal(r.mcp.undetermined, true, 'the form must not refuse this repository');
}));

// ---------------------------------------------------------------------------
// the version is chosen from what the repository has, never typed
// ---------------------------------------------------------------------------

test('the form is offered the repository\'s own releases, newest first', async () => {
  const { listReleases } = await import('../lib/github.ts');
  const problems = [];
  const list = await listReleases({ owner: 'a', repo: 'b' }, scriptedFetch({
    '/releases?': { status: 200, body: [
      { tag_name: 'v3.0.0' },
      { tag_name: 'v3.0.0-rc1', prerelease: true },
      { tag_name: 'v2.9.0', draft: true },
    ] },
    '/tags?': { status: 200, body: [{ name: 'v3.0.0', commit: { sha: 'c'.repeat(40) } }, { name: 'v1.0.0', commit: { sha: 'd'.repeat(40) } }] },
  }), problems);

  assert.deepEqual(list.map((r) => r.tag), ['v3.0.0', 'v3.0.0-rc1', 'v1.0.0']);
  assert.equal(list[1].source, 'pre-release', 'a pre-release is offered but labelled');
  assert.ok(!list.some((r) => r.tag === 'v2.9.0'), 'a draft is not something anyone can install');
});

test('a repository with no releases and no tags offers only the branch head, labelled', async () => {
  const { listReleases } = await import('../lib/github.ts');
  const list = await listReleases({ owner: 'a', repo: 'b' }, scriptedFetch({
    '/releases?': { status: 200, body: [] },
    '/tags?': { status: 200, body: [] },
    '/commits/HEAD': { status: 200, body: { sha: 'e'.repeat(40) } },
  }), []);
  assert.equal(list.length, 1);
  assert.equal(list[0].source, 'default-branch', 'a branch head moves and must say so');
  assert.equal(list[0].tag, '');
});

test('selecting a version resolves its commit, dereferencing an annotated tag', async () => {
  const { resolveCommit } = await import('../lib/github.ts');
  const sha = await resolveCommit({ owner: 'a', repo: 'b' }, 'v2.3.0', scriptedFetch({
    '/commits/v2.3.0': { status: 200, body: { sha: 'f'.repeat(40) } },
  }));
  assert.equal(sha, 'f'.repeat(40));
});
