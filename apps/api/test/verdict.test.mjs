// The read path, exercised against the exported Hono app. No live network.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.mjs';
import { MISS_FINGERPRINT, FIXTURES } from '../src/mock.mjs';
import { parseVerdictHead, decide, CACHE, ERROR_CODES } from '@surex/core';

const quiet = { warn() {}, info() {}, error() {} };
const mockApp = (env = {}) => createApp({ env: { SUREX_MOCK: '1', ...env }, logger: quiet });

const fp = (label) => FIXTURES.find((f) => f.label === label).fingerprint;
const FLAGGED = fp('flagged-tier-b');
const CLEAN = fp('clean-tier-a');
const DISPUTED = fp('disputed');
const STALE = fp('stale');
const UNREVIEWABLE = fp('unreviewable-licence');

async function json(app, path, init) {
  const res = await app.request(path, init);
  return { res, body: await res.json() };
}

test('hot path returns a valid head for a known fingerprint', async () => {
  const app = mockApp();
  const { res, body } = await json(app, `/v1/verdict?fp=${FLAGGED}`);
  assert.equal(res.status, 200);

  // The gate parses what it gets; if parseVerdictHead rejects it, the gate would
  // degrade this to `unknown` and the whole route would be pointless.
  const head = parseVerdictHead(body);
  assert.ok(head, 'the response must survive parseVerdictHead');
  assert.equal(head.fingerprint, FLAGGED);
  assert.equal(head.state, 'flagged');
  assert.equal(head.severity, 4);
  assert.equal(head.tier, 'B');
  assert.ok(head.topFinding?.description, 'a flagged head carries the finding the block message needs');
  assert.ok(head.evidence?.blobId, 'a flagged head points at the bytes it judged');
  assert.equal(decide(head), 'block');
});

test('every fixture state round-trips as a parseable head with the right decision', async () => {
  const app = mockApp();
  const expected = [
    [CLEAN, 'clean', 'allow'],
    [FLAGGED, 'flagged', 'block'],
    [DISPUTED, 'disputed', 'block'],
    [STALE, 'stale', 'warn'],
    [UNREVIEWABLE, 'unreviewable', 'warn'],
    [MISS_FINGERPRINT, 'unknown', 'warn'],
  ];
  for (const [fingerprint, state, verdict] of expected) {
    const { res, body } = await json(app, `/v1/verdict?fp=${fingerprint}`);
    assert.equal(res.status, 200, `${state} must be 200`);
    const head = parseVerdictHead(body);
    assert.ok(head, `${state} must parse`);
    assert.equal(head.state, state);
    assert.equal(decide(head), verdict, `${state} must decide ${verdict}`);
  }
});

test('a miss returns the unknown head, not a bodyless 404', async () => {
  const app = mockApp();
  const { res, body } = await json(app, `/v1/verdict?fp=${MISS_FINGERPRINT}`);
  assert.equal(res.status, 200);
  assert.equal(body.state, 'unknown');
  assert.equal(body.severity, 0);
  assert.equal(body.tier, 'C');
  assert.equal(body.fingerprint, MISS_FINGERPRINT);
  // A miss must never be served as clean — that is the one wrong answer here.
  assert.notEqual(body.state, 'clean');
});

test('the unreviewable fixture carries reason: licence', async () => {
  const { body } = await json(mockApp(), `/v1/verdict?fp=${UNREVIEWABLE}`);
  assert.equal(body.state, 'unreviewable');
  assert.equal(body.reason, 'licence');
});

test('the disputed fixture carries a rebuttal, and still blocks', async () => {
  const { body } = await json(mockApp(), `/v1/verdict?fp=${DISPUTED}`);
  assert.equal(body.state, 'disputed');
  assert.match(body.disputeSummary, /\S/);
  assert.equal(decide(parseVerdictHead(body)), 'block');
});

test('a malformed fp returns bad_fingerprint, not a 500', async () => {
  const app = mockApp();
  const bad = [
    'nope',
    'sxf1_short',
    'sxf1_ZZZZ87b5c52ccc054ff7aab31a1507f1264bbfc1b9d1c274d8e636d3b7e1bd8b', // non-hex
    `${CLEAN.toUpperCase()}`, // uppercase hex is not the canonical form
    'sxf2_98a187b5c52ccc054ff7aab31a1507f1264bbfc1b9d1c274d8e636d3b7e1bd8b', // wrong version
    `${CLEAN}extra`,
    '../../etc/passwd',
    '<script>alert(1)</script>',
  ];
  for (const value of bad) {
    const { res, body } = await json(app, `/v1/verdict?fp=${encodeURIComponent(value)}`);
    assert.equal(res.status, 400, `${value} must be 400, got ${res.status}`);
    assert.equal(body.error.code, ERROR_CODES.BAD_FINGERPRINT);
  }
});

test('a missing fp returns bad_fingerprint', async () => {
  const { res, body } = await json(mockApp(), '/v1/verdict');
  assert.equal(res.status, 400);
  assert.equal(body.error.code, ERROR_CODES.BAD_FINGERPRINT);
});

test('cache headers honour the frozen TTLs — positive for a hit, negative for a miss', async () => {
  const app = mockApp();
  const hit = await app.request(`/v1/verdict?fp=${CLEAN}`);
  assert.match(hit.headers.get('Cache-Control'), new RegExp(`max-age=${CACHE.positiveTtlMs / 1000}\\b`));

  const miss = await app.request(`/v1/verdict?fp=${MISS_FINGERPRINT}`);
  assert.match(miss.headers.get('Cache-Control'), new RegExp(`max-age=${CACHE.negativeTtlMs / 1000}\\b`));
});

test('the second lookup is served from the process cache', async () => {
  const app = mockApp();
  const first = await app.request(`/v1/verdict?fp=${CLEAN}`);
  assert.equal(first.headers.get('X-SureX-Cache'), 'miss');
  const second = await app.request(`/v1/verdict?fp=${CLEAN}`);
  assert.equal(second.headers.get('X-SureX-Cache'), 'hit');
});

test('a cached flagged head outlives its TTL when the registry is unreachable; a clean one does not', async () => {
  // The asymmetry in CACHE: a network blip must never un-flag a server we already
  // know is bad, and must never keep answering `clean` for one we can no longer
  // check. Driven with a fake clock so the 15-minute TTL is testable.
  const { createHeadCache } = await import('../src/app.mjs');
  let clock = 1_000_000;
  const cache = createHeadCache({ now: () => clock });

  let fail = false;
  const heads = {
    [FLAGGED]: { fingerprint: FLAGGED, state: 'flagged', severity: 4, tier: 'B' },
    [CLEAN]: { fingerprint: CLEAN, state: 'clean', severity: 0, tier: 'A' },
  };
  const flaky = {
    mode: 'live',
    illustrative: false,
    async getVerdictHead(f) {
      if (fail) throw new Error('rpc down');
      return heads[f] ?? null;
    },
    async getVerdictHeads() {
      return new Map();
    },
    async health() {
      return {};
    },
  };
  const app = createApp({ env: {}, logger: quiet, store: flaky, cache });

  // Warm both, then age past the positive TTL and take the registry away.
  assert.equal((await app.request(`/v1/verdict?fp=${FLAGGED}`)).status, 200);
  assert.equal((await app.request(`/v1/verdict?fp=${CLEAN}`)).status, 200);
  clock += CACHE.positiveTtlMs + 1;
  fail = true;

  const stillBlocked = await app.request(`/v1/verdict?fp=${FLAGGED}`);
  assert.equal(stillBlocked.status, 200, 'a known-bad server stays flagged while the registry is unreachable');
  assert.equal((await stillBlocked.json()).state, 'flagged');
  assert.equal(stillBlocked.headers.get('X-SureX-Cache'), 'stale');

  const noLongerClean = await app.request(`/v1/verdict?fp=${CLEAN}`);
  assert.equal(noLongerClean.status, 503, 'an expired clean is NOT re-served past its TTL — we say we could not look');
  assert.equal((await noLongerClean.json()).error.code, ERROR_CODES.UPSTREAM_UNAVAILABLE);

  // And the grace window is finite.
  clock += CACHE.flaggedGraceMs + 1;
  assert.equal((await app.request(`/v1/verdict?fp=${FLAGGED}`)).status, 503);
});

test('an unreachable registry with nothing cached is 503, never a synthesised unknown', async () => {
  const down = {
    mode: 'live',
    illustrative: false,
    async getVerdictHead() {
      throw new Error('rpc down');
    },
    async getVerdictHeads() {
      throw new Error('rpc down');
    },
    async health() {
      throw new Error('rpc down');
    },
  };
  const app = createApp({ env: {}, logger: quiet, store: down });
  const { res, body } = await json(app, `/v1/verdict?fp=${CLEAN}`);
  assert.equal(res.status, 503);
  assert.equal(body.error.code, ERROR_CODES.UPSTREAM_UNAVAILABLE);
  // "we could not look" must not be reported as "we looked and found nothing".
  assert.equal(body.state, undefined);
});

test('batch returns one entry per requested fingerprint, including misses', async () => {
  const requested = [CLEAN, MISS_FINGERPRINT, FLAGGED, STALE];
  const { res, body } = await json(mockApp(), '/v1/verdicts/batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fps: requested }),
  });
  assert.equal(res.status, 200);
  assert.equal(body.heads.length, requested.length);
  assert.deepEqual(
    body.heads.map((h) => h.fingerprint),
    requested,
    'in request order, so a client can zip the arrays',
  );
  assert.deepEqual(
    body.heads.map((h) => h.state),
    ['clean', 'unknown', 'flagged', 'stale'],
  );
  for (const head of body.heads) assert.ok(parseVerdictHead(head), 'every batch head must parse');
});

test('batch reports malformed fingerprints separately instead of failing the whole prefetch', async () => {
  const { res, body } = await json(mockApp(), '/v1/verdicts/batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fps: [CLEAN, 'garbage', FLAGGED] }),
  });
  assert.equal(res.status, 200);
  assert.equal(body.heads.length, 2);
  assert.equal(body.invalid.length, 1);
  assert.equal(body.invalid[0].code, ERROR_CODES.BAD_FINGERPRINT);
  // Never silently promoted to a state.
  assert.ok(!body.heads.some((h) => h.fingerprint === 'garbage'));
});

test('batch rejects a non-array and an oversized body', async () => {
  const app = mockApp();
  const post = (payload) =>
    json(app, '/v1/verdicts/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

  let r = await post({ fps: 'nope' });
  assert.equal(r.res.status, 400);
  assert.equal(r.body.error.code, ERROR_CODES.INVALID_BODY);

  r = await post({ fps: Array.from({ length: 101 }, () => CLEAN) });
  assert.equal(r.res.status, 400);
  assert.equal(r.body.error.code, ERROR_CODES.INVALID_BODY);

  const bad = await app.request('/v1/verdicts/batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: 'not json',
  });
  assert.equal(bad.status, 400);
});

test('entry, source and review return the record plus its Sui/Walrus links', async () => {
  const app = mockApp();
  const { res, body } = await json(app, `/v1/entry/${FLAGGED}`);
  assert.equal(res.status, 200);
  assert.equal(body.fingerprint, FLAGGED);
  assert.ok(body.entry, 'the entry itself');
  assert.equal(body.head.state, 'flagged');
  assert.ok(body.sources.length >= 1);
  assert.ok(body.reviews.length >= 1);

  const review = body.reviews[0];
  for (const link of ['blob', 'suiObject', 'registerTx', 'certifyTx', 'arkivEntity']) {
    assert.match(review.links[link], /^https:\/\//, `review must link ${link}`);
  }

  // The HEAD needs them too: this is the route the verdict page reads, and its
  // whole argument is "here is the blob we judged and the entity recording it".
  assert.ok(body.head.links, 'the head carries links');
  assert.match(body.head.links.blob, /\/v1\/blobs\//, 'the evidence blob, on a Walrus aggregator');
  assert.match(body.head.links.arkivEntity, /\/entity\//, 'the entity, on the Arkiv explorer');

  const one = await json(app, `/v1/review/${encodeURIComponent(review.key)}`);
  assert.equal(one.res.status, 200);
  assert.equal(one.body.review.key, review.key);
  assert.ok(one.body.review.links.blob);

  const src = body.sources[0];
  const srcRes = await json(app, `/v1/source/${encodeURIComponent(src.key)}`);
  assert.equal(srcRes.res.status, 200);
  assert.equal(srcRes.body.source.key, src.key);
});

test('an unknown entry / source / review key is a 404 with the contract error shape', async () => {
  const app = mockApp();
  for (const path of [`/v1/entry/${MISS_FINGERPRINT}`, '/v1/source/0xdead', '/v1/review/0xdead']) {
    const { res, body } = await json(app, path);
    assert.equal(res.status, 404, path);
    assert.equal(body.error.code, ERROR_CODES.NOT_FOUND);
  }
  const badFp = await json(app, '/v1/entry/nope');
  assert.equal(badFp.res.status, 400);
  assert.equal(badFp.body.error.code, ERROR_CODES.BAD_FINGERPRINT);
});

test('evidence=1 in mock mode says plainly that no Walrus request was made', async () => {
  const app = mockApp();
  const { body: entry } = await json(app, `/v1/entry/${FLAGGED}`);
  const { body } = await json(app, `/v1/review/${encodeURIComponent(entry.reviews[0].key)}?evidence=1`);
  assert.equal(body.evidence.fetched, false);
  assert.match(body.evidence.reason, /mock mode/i);
});

test('the flagged feed lists everything that blocks, worst first', async () => {
  const { res, body } = await json(mockApp(), '/v1/flagged');
  assert.equal(res.status, 200);
  assert.ok(body.heads.length >= 2);
  const states = new Set(body.heads.map((h) => h.state));
  assert.ok(states.has('flagged'));
  assert.ok(states.has('disputed'), 'a dispute does not unblock, so it belongs in the feed');
  const severities = body.heads.map((h) => Number(h.severity));
  assert.deepEqual(severities, [...severities].sort((a, b) => b - a), 'sorted client-side; orderBy is a no-op');
  // No clean row must ever appear in a feed of flags.
  assert.ok(!body.heads.some((h) => h.state === 'clean'));
});

test('stats puts the registry hit rate first and omits what is not real', async () => {
  const app = mockApp();
  const fresh = await json(app, '/v1/stats');
  // Nothing looked up yet in this process → the number does not exist, so it is
  // omitted and named in `omitted` rather than reported as zero.
  assert.equal(fresh.body.hitRate, undefined);
  assert.ok(fresh.body.omitted.some((o) => o.startsWith('hitRate')));

  await app.request(`/v1/verdict?fp=${CLEAN}`);
  await app.request(`/v1/verdict?fp=${MISS_FINGERPRINT}`);

  const { res, body } = await json(app, '/v1/stats');
  assert.equal(res.status, 200);
  assert.equal(Object.keys(body)[0], 'hitRate', 'the first number on the dashboard is the first key here');
  assert.equal(body.hitRate.lookups, 2);
  assert.equal(body.hitRate.hits, 1);
  assert.equal(body.hitRate.value, 0.5);
  assert.match(body.hitRate.scope, /process/i);
  assert.equal(typeof body.registry.entries, 'number');
  assert.equal(typeof body.registry.byState.flagged, 'number');
  // No fabricated numbers: anything we cannot measure is listed as omitted.
  assert.ok(body.omitted.some((o) => o.startsWith('timeToBlock')));
});

test('POST /v1/submissions is honest about not being built', async () => {
  const { res, body } = await json(mockApp(), '/v1/submissions', { method: 'POST' });
  assert.equal(res.status, 501);
  assert.equal(body.built, undefined);
  assert.equal(body.error.built, false);
  assert.match(body.error.message, /NOT built/);
});

test('an unrouted path is a 404 in the contract error shape', async () => {
  const { res, body } = await json(mockApp(), '/v1/nope');
  assert.equal(res.status, 404);
  assert.equal(body.error.code, ERROR_CODES.NOT_FOUND);
});

test('the live store cannot be constructed without a writer address to filter by', async () => {
  const { createArkivStore } = await import('../src/arkiv.mjs');
  assert.throws(
    () => createArkivStore({ env: { SUREX_WRITER_ADDRESS: 'not-an-address' } }),
    /createdBy/,
    'refusing to start is the only correct behaviour: an unfiltered read serves an attacker verdict',
  );
});
