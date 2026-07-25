/**
 * The default registry view — which states it contains, and what it says about
 * the ones it does not.
 *
 * The registry's default list is FILTERED: it shows the entries where a review
 * reached a verdict, and holds back the ones where none was reached. That is a
 * display decision and a defensible one — 25 of 33 live heads are `unreviewable`
 * and they bury every verdict under them — but it is one line of code away from
 * being concealment. So the two properties that keep it honest are pinned here
 * rather than left to a reviewer's eye:
 *
 *   1. nothing worse than `clean` is ever held back (so `stale` stays visible);
 *   2. shown + held back = everything, and the held-back count is countable, so
 *      the screen can print it instead of leaving a reader to notice a gap.
 *
 * `.ts` imports are deliberate: Node strips types, so this runs with no build.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COPY } from '../lib/copy.ts';
import {
  DEFAULT_STATE,
  hiddenCount,
  hiddenFromDefault,
  isDecided,
  matchesState,
  statusRank,
} from '../lib/format.ts';

/** Every state a row can carry. `unknown` and `running` included on purpose. */
const ALL_STATES = [
  'flagged',
  'disputed',
  'stale',
  'clean',
  'unreviewable',
  'unknown',
  'running',
];

const DECIDED = ['flagged', 'disputed', 'stale', 'clean'];
const UNDECIDED = ['unreviewable', 'unknown', 'running'];

const rows = (spec) =>
  Object.entries(spec).flatMap(([status, n]) =>
    Array.from({ length: n }, (_, i) => ({ status, name: `${status}-${i}` })),
  );

/**
 * The live registry on 2026-07-25, read from
 * `GET https://arkiv-surex-api.vercel.app/v1/stats` → `registry.byState`.
 * 33 verdict heads, 25 of them a licence-gate refusal we could not read.
 */
const LIVE = { clean: 7, flagged: 1, disputed: 0, unreviewable: 25, stale: 0, unknown: 0 };

/* ------------------------------------------------ which states are in view --*/

test('the default view is exactly the states where a review reached a verdict', () => {
  for (const status of DECIDED) assert.equal(isDecided(status), true, `${status} should be in`);
  for (const status of UNDECIDED) assert.equal(isDecided(status), false, `${status} should be out`);
});

test('`stale` is in the default view — it is worse news than `clean`, not lesser news', () => {
  // The one that would be easiest to drop and worst to drop. An entry whose
  // reviewed release is no longer the released one ranks ABOVE clean in
  // statusRank; hiding it while showing clean entries would hide the worse news
  // of the two, which is the failure this whole control has to avoid.
  assert.ok(statusRank('stale') < statusRank('clean'));
  assert.equal(isDecided('stale'), true);
});

test('the default set is derived from statusRank, so the two cannot drift', () => {
  // Both halves read out of isDecided() itself rather than off the lists above,
  // so this fails if the predicate moves OR if statusRank is reordered under it.
  const inView = ALL_STATES.filter((s) => isDecided(s)).map(statusRank);
  const outOfView = ALL_STATES.filter((s) => !isDecided(s)).map(statusRank);
  assert.ok(inView.length > 0 && outOfView.length > 0, 'the view must be a real partition');
  assert.ok(
    Math.max(...inView) < Math.min(...outOfView),
    'every state in the default view must rank ahead of every state left out of it',
  );
  assert.equal(
    Math.max(...inView),
    statusRank('clean'),
    'clean is the boundary: the worst news kept out must be no worse than clean',
  );
});

test('the default view is not the name of any state it could be confused with', () => {
  // `?state=decided` must not collide with `?state=clean` and friends, or a
  // pasted URL becomes ambiguous.
  assert.ok(!ALL_STATES.includes(DEFAULT_STATE), `${DEFAULT_STATE} collides with a state name`);
});

/* ------------------------------------------------------ the filter itself --*/

test('matchesState: all shows everything, the default shows the decided, a state is exact', () => {
  for (const status of ALL_STATES) {
    assert.equal(matchesState(status, 'all'), true, `all should include ${status}`);
    assert.equal(matchesState(status, DEFAULT_STATE), isDecided(status));
    assert.equal(matchesState(status, status), true, `${status} should match itself`);
    assert.equal(matchesState(status, 'clean'), status === 'clean');
  }
});

test('`unreviewable` is reachable — it is filtered out of the default, not removed', () => {
  // The whole justification for the default view is that these entries stay
  // one click away. If this ever fails, the filter has become a delete.
  assert.equal(matchesState('unreviewable', 'unreviewable'), true);
  assert.equal(matchesState('unreviewable', 'all'), true);
  assert.equal(matchesState('unreviewable', DEFAULT_STATE), false);
});

/* -------------------------------------------- what the screen has to print --*/

test('the live registry: 8 entries carry a verdict, 25 are held back and counted', () => {
  const live = rows(LIVE);
  assert.equal(live.length, 33);
  assert.equal(live.filter((r) => matchesState(r.status, DEFAULT_STATE)).length, 8);
  assert.equal(hiddenCount(live), 25);
  assert.deepEqual(hiddenFromDefault(live), [{ status: 'unreviewable', count: 25 }]);
});

test('shown plus held back is everything — no row can go missing without a count', () => {
  const mixed = rows({ flagged: 2, clean: 3, stale: 1, unreviewable: 9, unknown: 4, running: 1 });
  const shown = mixed.filter((r) => matchesState(r.status, DEFAULT_STATE)).length;
  assert.equal(shown + hiddenCount(mixed), mixed.length);
  // and the breakdown accounts for the same total, state by state
  assert.equal(
    hiddenFromDefault(mixed).reduce((n, g) => n + g.count, 0),
    hiddenCount(mixed),
  );
});

test('the breakdown is worst news first and never renders an empty state', () => {
  const mixed = rows({ clean: 1, unknown: 4, running: 1, unreviewable: 9, disputed: 0 });
  const groups = hiddenFromDefault(mixed);
  assert.deepEqual(groups, [
    { status: 'unreviewable', count: 9 },
    { status: 'unknown', count: 4 },
    { status: 'running', count: 1 },
  ]);
  // statusRank order, not insertion order and not alphabetical
  const ranks = groups.map((g) => statusRank(g.status));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  assert.ok(groups.every((g) => g.count > 0));
});

test('a registry with nothing held back renders no notice at all', () => {
  // The control must disappear rather than announce "0 hidden", which reads as
  // a filter being applied when none is.
  assert.deepEqual(hiddenFromDefault(rows({ clean: 4, flagged: 1 })), []);
  assert.equal(hiddenCount(rows({ clean: 4, flagged: 1 })), 0);
});

/* ---------------------------------------------------------------- the copy --*/

test('the notice says the entries still exist, and hardcodes no count', () => {
  const { hiddenTag, hiddenSuffix, hiddenShowAll, hiddenWhy, viewDecided } = COPY.browse;
  for (const s of [hiddenTag, hiddenSuffix, hiddenShowAll, hiddenWhy, viewDecided]) {
    assert.ok(s && s.length > 0);
    // Every number on that line is counted off the rows the page received.
    // A digit in the copy is a fabrication the moment the registry disagrees.
    assert.ok(!/\d/.test(s), `hardcoded number in registry-filter copy: "${s}"`);
  }
  assert.match(hiddenTag, /FILTERED/);
  assert.match(hiddenWhy, /nothing is removed/i);
  assert.match(hiddenWhy, /own page|still|published answer/i);
});
