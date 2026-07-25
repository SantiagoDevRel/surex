import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normaliseStats } from '../lib/api.ts';

/**
 * The exact `byState` the live API returns for the seeded registry: 50 servers
 * crawled from the official MCP registry, of which 40 are `unknown` and 10 were
 * blocked by the licence gate, plus our own fixture, which is the only thing that
 * has actually been reviewed.
 */
const LIVE = {
  registry: {
    entries: 51,
    byState: { clean: 0, flagged: 1, disputed: 0, unreviewable: 10, stale: 0, unknown: 40 },
  },
};

test('reviewed counts ONLY states a real review can produce', () => {
  const stats = normaliseStats(LIVE, [], false);
  // This shipped to production as 41, computed as entries - unreviewable, which
  // silently counted 40 seeded `unknown` entries as reviewed. Coverage is the one
  // number nobody should inflate.
  assert.equal(stats.reviewed, 1);
  assert.equal(stats.flagged, 1);
});

test('reviewed can never exceed entries minus unknown minus unreviewable', () => {
  const { entries, byState } = LIVE.registry;
  const ceiling = entries - byState.unknown - byState.unreviewable;
  assert.ok(normaliseStats(LIVE, [], false).reviewed <= ceiling);
});

test('an unknown-only registry reports zero reviewed, not its size', () => {
  const seededOnly = { registry: { entries: 30, byState: { unknown: 30 } } };
  assert.equal(normaliseStats(seededOnly, [], false).reviewed, 0);
});

test('a stats body missing byState falls back to the rows, not to a guess', () => {
  const rows = [
    { status: 'flagged', tier: 'B' },
    { status: 'unknown', tier: 'C' },
    { status: 'unreviewable', tier: 'C' },
  ];
  // Derived from rows: only the flagged one has been reviewed.
  assert.equal(normaliseStats({ registry: { entries: 3 } }, rows, false).reviewed, 1);
});

test('tierA is left undefined rather than invented when nobody reported it', () => {
  assert.equal(normaliseStats(LIVE, [], false).tierA, undefined);
});
