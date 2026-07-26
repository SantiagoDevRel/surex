// A verdict written a second ago must be the verdict this API serves. Two ways that
// breaks, both guarded here:
//
//   1. `getVerdictHead` and `getVerdictHeads` choosing different rows for the same
//      fingerprint, so `/r/<fp>` and the registry list disagree.
//   2. A read route setting `max-age` with no shared-cache directive, letting
//      Vercel's CDN pin one body fleet-wide for the whole window.
//
// `verdict.test.mjs` pins the client `max-age`; these assertions are about the
// shared cache, the one nobody can bust from a browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.mjs';
import { newestHead, dedupeHeads } from '../src/arkiv.mjs';

const app = () => createApp({ env: { SUREX_MOCK: '1' } });

const FP_A = `sxf1_${'a'.repeat(64)}`;
const FP_B = `sxf1_${'b'.repeat(64)}`;

/** An Arkiv entity as the SDK hands it over: annotations, no payload helper. */
const entity = ({ fp, state, block, severity = 0, key = '0xk' }) => ({
  key,
  lastModifiedAtBlock: block,
  createdAtBlock: block,
  attributes: [
    { key: 'project', value: 'surex-lisbon' },
    { key: 'entityType', value: 'verdictHead' },
    { key: 'fingerprint', value: fp },
    { key: 'state', value: state },
    { key: 'severity', value: severity },
  ],
});

// ---------------------------------------------------------------------------
// which head is current
// ---------------------------------------------------------------------------

test('the newest head wins, whatever order the node returned them in', () => {
  const older = entity({ fp: FP_A, state: 'flagged', block: 100 });
  const newer = entity({ fp: FP_A, state: 'clean', block: 200 });

  assert.equal(newestHead([older, newer]), newer);
  assert.equal(newestHead([newer, older]), newer, 'return order must not decide the verdict');
});

test('on a tie, the more restrictive head wins — never the more permissive one', () => {
  const clean = entity({ fp: FP_A, state: 'clean', block: 500, key: '0xclean' });
  const flagged = entity({ fp: FP_A, state: 'flagged', block: 500, key: '0xflagged' });

  assert.equal(newestHead([clean, flagged]).key, '0xflagged');
  assert.equal(newestHead([flagged, clean]).key, '0xflagged', 'a tie must not round a flag down to a pass');
});

test('two heads for one fingerprint collapse to one row', () => {
  const heads = dedupeHeads([
    entity({ fp: FP_A, state: 'flagged', block: 10, severity: 3 }),
    entity({ fp: FP_A, state: 'clean', block: 20 }),
    entity({ fp: FP_B, state: 'clean', block: 5 }),
  ]);
  assert.equal(heads.length, 2, 'a republished entry must not appear twice in the registry');
  const a = heads.find((h) => h.fingerprint === FP_A);
  assert.equal(a.state, 'clean', 'and the row shown must be the current one');
});

test('newestHead survives the empty and the malformed', () => {
  assert.equal(newestHead([]), null);
  assert.equal(newestHead(undefined), null);
  assert.equal(newestHead([null, undefined]), null);
  assert.deepEqual(dedupeHeads([{ attributes: [] }]), [], 'a row with no fingerprint is dropped, not guessed at');
});

// ---------------------------------------------------------------------------
// the shared cache holds nothing that can change
// ---------------------------------------------------------------------------

const MUTABLE_ROUTES = [
  ['/v1/registry', 'the browse list'],
  ['/v1/flagged', 'the org gateway feed'],
  ['/v1/stats', 'the counts on the registry page'],
  [`/v1/verdict?fp=${FP_A}`, 'what the gate reads'],
];

for (const [route, why] of MUTABLE_ROUTES) {
  test(`${route} is never held by a shared cache (${why})`, async () => {
    const res = await app().request(route);
    assert.equal(res.status, 200, route);

    const cc = res.headers.get('cache-control') ?? '';
    assert.match(cc, /s-maxage=0/, `${route} lets the CDN pin a stale body: "${cc}"`);

    const cdn = res.headers.get('cdn-cache-control') ?? '';
    assert.match(cdn, /max-age=0/, `${route} has no CDN-Cache-Control: "${cdn}"`);
  });
}

test('/v1/entry is never held by a shared cache — it is the only source for /r', async () => {
  // The fingerprint comes from the registry the app just served, and the 200 is
  // asserted — guarding assertions behind `if (res.status === 200)` reports `ok` on
  // zero executed assertions.
  const listed = await (await app().request('/v1/registry?limit=1')).json();
  const fp = listed.heads?.[0]?.fingerprint;
  assert.ok(fp, 'the mock registry must serve at least one head for this test to mean anything');

  const res = await app().request(`/v1/entry/${fp}`);
  assert.equal(res.status, 200, `/v1/entry/${fp} must answer for a fingerprint the registry just listed`);
  assert.match(res.headers.get('cache-control') ?? '', /s-maxage=0/);
  assert.match(res.headers.get('cdn-cache-control') ?? '', /max-age=0/);
});

test('the client TTL the contract froze is still honoured', async () => {
  // Freshness at the edge must not be bought by throwing away the gate's own budget.
  const res = await app().request(`/v1/verdict?fp=${FP_A}`);
  const cc = res.headers.get('cache-control') ?? '';
  assert.match(cc, /max-age=\d+/);
  assert.match(cc, /public/);
});
