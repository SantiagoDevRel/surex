// The one non-negotiable property of mock mode: nothing leaves this API able to
// be rendered as real. Every mocked response — success, error, feed, admin —
// carries illustrative: true, and no surface may strip it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.mjs';
import { FIXTURES, MISS_FINGERPRINT, createMockStore, mark } from '../src/mock.mjs';

const quiet = { warn() {}, info() {}, error() {} };
const FLAGGED = FIXTURES.find((f) => f.label === 'flagged-tier-b').fingerprint;
const CLEAN = FIXTURES.find((f) => f.label === 'clean-tier-a').fingerprint;

/** Every route this API answers, including the ones that fail. */
function requestsFor(adminPath) {
  const post = (path, payload) => [
    path,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) },
  ];
  const reqs = [
    ['/'],
    ['/healthz'],
    [`/v1/verdict?fp=${FLAGGED}`],
    [`/v1/verdict?fp=${CLEAN}`],
    [`/v1/verdict?fp=${MISS_FINGERPRINT}`],
    ['/v1/verdict'], // 400
    ['/v1/verdict?fp=garbage'], // 400
    [`/v1/entry/${FLAGGED}`],
    [`/v1/entry/${MISS_FINGERPRINT}`], // 404
    ['/v1/entry/garbage'], // 400
    ['/v1/source/0xdead'], // 404
    ['/v1/review/0xdead'], // 404
    ['/v1/flagged'],
    ['/v1/flagged?limit=1'],
    ['/v1/stats'],
    ['/v1/nope'], // 404
    post('/v1/verdicts/batch', { fps: [FLAGGED, MISS_FINGERPRINT] }),
    post('/v1/verdicts/batch', { fps: 'nope' }), // 400
    post('/v1/disputes', { fingerprint: FLAGGED, agentAddress: '0xabc', evidence: 'x' }), // 403
    post('/v1/disputes', { fingerprint: FLAGGED, statement: 'x' }), // 401
    post('/v1/disputes', {}), // 400
    post('/v1/submissions', {}), // 501
  ];
  if (adminPath) {
    reqs.push([adminPath, { method: 'POST' }]); // 401
    reqs.push([adminPath, { method: 'POST', headers: { 'x-surex-admin-password': '123' } }]);
  }
  return reqs;
}

test('EVERY mocked response carries illustrative: true', async () => {
  const app = createApp({
    env: {
      SUREX_MOCK: '1',
      SUREX_ADMIN_SLUG: 'test-slug-long-enough-to-not-warn',
      SUREX_REVIEWER_BASE_URL: 'http://reviewer.invalid',
      SUREX_REVIEWER_MODEL: 'demo-model',
    },
    logger: quiet,
    fetchImpl: async () => new Response('{"model":"demo-model"}', { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  const adminPath = app.surex.admin.path;

  let checked = 0;
  for (const [path, init] of requestsFor(adminPath)) {
    const res = await app.request(path, init);
    assert.equal(res.headers.get('X-SureX-Mode'), 'mock', `${path} must declare mock mode in a header`);
    assert.equal(res.headers.get('X-SureX-Illustrative'), 'true', `${path} must carry the illustrative header`);
    const body = await res.json();
    assert.equal(
      body.illustrative,
      true,
      `${init?.method ?? 'GET'} ${path} (${res.status}) is missing illustrative:true — body was ${JSON.stringify(body).slice(0, 160)}`,
    );
    checked += 1;
  }
  assert.ok(checked >= 20, `expected to sweep the whole surface, only checked ${checked}`);
});

test('every head inside a batch and a feed is individually marked, not just the envelope', async () => {
  // A client that pulls one head out of an array and renders it alone must still
  // see the flag, so the marking cannot live only on the wrapper.
  const app = createApp({ env: { SUREX_MOCK: '1' }, logger: quiet });

  const batch = await (
    await app.request('/v1/verdicts/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fps: [FLAGGED, CLEAN, MISS_FINGERPRINT] }),
    })
  ).json();
  assert.equal(batch.illustrative, true);
  for (const head of batch.heads) {
    // The unknown head for a miss is synthesised by the contract helper and then
    // marked on the way out — check that path too.
    assert.equal(head.illustrative, true, `head ${head.fingerprint} (${head.state}) unmarked`);
  }

  const feed = await (await app.request('/v1/flagged')).json();
  assert.equal(feed.illustrative, true);
  for (const head of feed.heads) assert.equal(head.illustrative, true);

  const entry = await (await app.request(`/v1/entry/${FLAGGED}`)).json();
  assert.equal(entry.illustrative, true);
  assert.equal(entry.head.illustrative, true);
  assert.equal(entry.entry.illustrative, true);
  for (const s of entry.sources) assert.equal(s.illustrative, true);
  for (const r of entry.reviews) assert.equal(r.illustrative, true);
});

test('live mode does NOT claim to be illustrative', async () => {
  // The flag has to mean something: if it appeared on real data it would be as
  // misleading as its absence on fake data.
  const store = {
    mode: 'live',
    illustrative: false,
    async getVerdictHead() {
      return { fingerprint: CLEAN, state: 'clean', severity: 0, tier: 'A' };
    },
    async getVerdictHeads() {
      return new Map();
    },
    async health() {
      return { ok: true };
    },
  };
  const app = createApp({ env: {}, logger: quiet, store });
  const res = await app.request(`/v1/verdict?fp=${CLEAN}`);
  assert.equal(res.headers.get('X-SureX-Mode'), 'live');
  assert.equal(res.headers.get('X-SureX-Illustrative'), null);
  assert.equal((await res.json()).illustrative, undefined);
});

test('the mock store never returns an unmarked object', async () => {
  const store = createMockStore({ env: {} });
  assert.equal((await store.getVerdictHead(FLAGGED)).illustrative, true);
  assert.equal((await store.getEntry(FLAGGED)).illustrative, true);
  assert.equal((await store.listFlagged()).illustrative, true);
  assert.equal((await store.stats()).illustrative, true);
  assert.equal((await store.health()).illustrative, true);
  // A miss is null, not an unmarked head.
  assert.equal(await store.getVerdictHead(MISS_FINGERPRINT), null);
  assert.equal(mark({ a: 1 }).illustrative, true);
  assert.deepEqual(mark([{ a: 1 }]).map((x) => x.illustrative), [true]);
});
