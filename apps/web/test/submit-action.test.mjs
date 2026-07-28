// What counts as a complete submission: a repository, plus a release tag or a
// commit — never both required.
//
// The commit is the stronger of the two claims, naming bytes that cannot change
// where a tag can be repointed or deleted. A project that has never cut a release
// resolves to its default-branch head, which carries a real 40-hex commit and an
// empty tag by design (`listReleases`, source `default-branch`), so requiring the
// tag refused exactly the repositories most worth submitting.

import test from 'node:test';
import assert from 'node:assert/strict';

import { submitRelease } from '../lib/submit-action.ts';

const SHA = 'a'.repeat(40);

/** A FormData the action will accept, minus whatever the test is withholding. */
function form(fields) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/**
 * Run the action with the network stubbed out. `missing` is decided before any
 * fetch, so recording whether the stub was called is what distinguishes "rejected
 * the body" from "accepted it and the call failed".
 */
async function run(fields) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    return {
      ok: true,
      status: 202,
      json: async () => ({ id: 'sub_test', status: 'queued' }),
      text: async () => '{"id":"sub_test"}',
    };
  };
  try {
    const outcome = await submitRelease({ kind: 'idle' }, form(fields));
    return { outcome, calls };
  } finally {
    globalThis.fetch = original;
  }
}

test('a commit with NO tag is a complete submission', async () => {
  // The default-branch case: a resolved commit, an empty tag.
  const { outcome, calls } = await run({ repo: 'acme/acme-mcp', release: '', commit: SHA });
  assert.notEqual(outcome.kind, 'missing', 'a resolved commit is a complete submission');
  assert.equal(calls.length, 1, 'it must actually reach the API');
  assert.equal(calls[0].body.commit, SHA);
});

test('a tag with no resolvable commit is still a complete submission', async () => {
  // GitHub rate-limits at 60/hour unauthenticated, so the browser cannot always
  // resolve the SHA. A tag alone is weaker, not invalid — it just bounds the tier.
  const { outcome, calls } = await run({ repo: 'acme/acme-mcp', release: 'v1.2.0', commit: '' });
  assert.notEqual(outcome.kind, 'missing');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.release, 'v1.2.0');
  assert.equal(calls[0].body.commit, undefined, 'an unresolved commit is omitted, never faked');
});

test('neither one is incomplete, and nothing is sent', async () => {
  const { outcome, calls } = await run({ repo: 'acme/acme-mcp', release: '', commit: '' });
  assert.equal(outcome.kind, 'missing');
  assert.equal(calls.length, 0, 'an incomplete body must not reach the API');
});

test('no repository is incomplete however good the commit is', async () => {
  const { outcome, calls } = await run({ repo: '', release: 'v1', commit: SHA });
  assert.equal(outcome.kind, 'missing');
  assert.equal(calls.length, 0);
});

test('a commit that is not a SHA is dropped rather than forwarded', async () => {
  // An unchecked string would end up recorded as provenance. With a tag present
  // the submission still stands; the commit simply does not travel.
  for (const bogus of ['HEAD', 'main', 'not-a-sha', 'a'.repeat(39), `${SHA}0`, '../etc/passwd']) {
    const { outcome, calls } = await run({ repo: 'acme/acme-mcp', release: 'v1', commit: bogus });
    assert.notEqual(outcome.kind, 'missing');
    assert.equal(calls[0].body.commit, undefined, `"${bogus}" must not be forwarded as a commit`);
  }
});

test('a bogus commit with no tag is incomplete — the invalid value cannot stand in for one', async () => {
  // Relaxing the guard to `!release && !commitRaw` would accept a body whose only
  // identifier is a string the action then refuses to send, producing a
  // submission that names a repository and nothing else.
  const { outcome, calls } = await run({ repo: 'acme/acme-mcp', release: '', commit: 'HEAD' });
  assert.equal(outcome.kind, 'missing');
  assert.equal(calls.length, 0);
});

test('a commit is normalised to lower case', async () => {
  const { calls } = await run({ repo: 'acme/acme-mcp', release: '', commit: SHA.toUpperCase() });
  assert.equal(calls[0].body.commit, SHA);
});
