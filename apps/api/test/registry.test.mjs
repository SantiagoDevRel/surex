import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.mjs';
import { STATES } from '@surex/core';

/**
 * `/v1/registry` exists because `/v1/flagged` is the wrong shape for a browse
 * page: seeded entries are written `unknown` and never `clean`, so a
 * flagged-only feed renders an EMPTY registry the moment seeding is what
 * populates it — which reads to a visitor as "nothing here" rather than
 * "nothing flagged".
 */
const app = () => createApp({ env: { SUREX_MOCK: '1' } });

test('the registry lists every state, not just the blocking ones', async () => {
  const res = await app().request('/v1/registry');
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.ok(Array.isArray(body.heads) && body.heads.length > 0);
  const states = new Set(body.heads.map((h) => h.state));
  assert.ok(states.size > 1, `expected several states, got ${[...states]}`);
  // The point of the route: states a flagged feed would omit are present.
  assert.ok(
    states.has('clean') || states.has('unknown') || states.has('stale') || states.has('unreviewable'),
    `a browse page must show non-blocking states too, got ${[...states]}`,
  );
});

test('ordering puts what stops a call first and unknown last', async () => {
  const body = await (await app().request('/v1/registry')).json();
  const RANK = { flagged: 0, disputed: 1, stale: 2, unreviewable: 3, clean: 4, unknown: 5 };
  const ranks = body.heads.map((h) => RANK[h.state] ?? 9);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), 'rows must be ordered by rank');
});

test('byState is reported so a page can show coverage without counting rows itself', async () => {
  const body = await (await app().request('/v1/registry')).json();
  assert.equal(typeof body.byState, 'object');
  assert.equal(
    Object.values(body.byState).reduce((a, b) => a + b, 0),
    body.total,
    'byState must sum to total, or the page will overstate coverage',
  );
});

test('a state filter works, and an unknown state is rejected rather than ignored', async () => {
  for (const state of STATES) {
    const res = await app().request(`/v1/registry?state=${state}`);
    assert.equal(res.status, 200, state);
    const body = await res.json();
    assert.ok(body.heads.every((h) => h.state === state), `${state} filter leaked other states`);
  }
  // Silently ignoring an unrecognised filter would return the whole registry to
  // a caller who asked for a subset — the wrong direction to fail in.
  const bad = await app().request('/v1/registry?state=probably-fine');
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, 'invalid_body');
});

test('limit is clamped, never trusted', async () => {
  const one = await (await app().request('/v1/registry?limit=1')).json();
  assert.equal(one.heads.length, 1);
  assert.ok(one.total >= 1, 'total must still report the real count');

  for (const bad of ['0', '-5', '999999', 'abc']) {
    const res = await app().request(`/v1/registry?limit=${bad}`);
    assert.equal(res.status, 200, bad);
    const body = await res.json();
    assert.ok(body.heads.length >= 1, bad);
  }
});

test('every row is still marked illustrative in mock mode', async () => {
  const body = await (await app().request('/v1/registry')).json();
  assert.equal(body.illustrative, true);
  for (const head of body.heads) {
    assert.equal(head.illustrative, true, `${head.fingerprint} is unmarked demo data`);
  }
});

test('the note explains what unknown means, so the page cannot imply a judgement', async () => {
  const body = await (await app().request('/v1/registry')).json();
  assert.match(body.note, /not a statement about the code/i);
  assert.match(body.note, /never written clean/i);
});
