/**
 * The homepage ticker and stat band, over data shaped by `lib/home-data.ts`.
 * Mostly about what does not get rendered — an undefined stat produces no tile,
 * a partial view produces no entries-indexed tile — because a hardcoded count is
 * a fabrication.
 *
 * `.ts` imports are deliberate: Node strips types, so this runs with no build.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { homeStats, tickerItems } from '../lib/home-data.ts';

const row = (overrides = {}) => ({
  fingerprint: 'sxf1_deadbeef',
  name: 'mcp-server-postgres',
  version: '0.6.2',
  status: 'clean',
  tier: 'A',
  standing: 'uncontested',
  standingTone: undefined,
  reviewedAt: '2026-07-20',
  capabilities: 'net fs',
  ...overrides,
});

/* --------------------------------------------------------------- ticker --*/

test('tickerItems: empty rows produce an empty ticker and do not throw', () => {
  assert.deepEqual(tickerItems([]), []);
});

test('tickerItems: keeps the state word separate from the rest of the text', () => {
  const [item] = tickerItems([row({ status: 'flagged', standing: 'credential exfiltration' })]);
  // The component colours `state` on its own, so the item stays fields — a
  // pre-joined "flagged mcp-server-postgres 0.6.2" would force it to parse the
  // word back out.
  assert.equal(item.state, 'flagged');
  assert.equal(item.name, 'mcp-server-postgres');
  assert.equal(item.version, '0.6.2');
  assert.equal(item.standing, 'credential exfiltration');
  assert.ok(!('text' in item), 'no pre-formatted string field');
});

test('tickerItems: one item per row, in the order the rows arrived', () => {
  const rows = [
    row({ name: 'a', status: 'clean' }),
    row({ name: 'b', status: 'stale' }),
    row({ name: 'c', status: 'unknown' }),
  ];
  const items = tickerItems(rows);
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((i) => i.name), ['a', 'b', 'c']);
  assert.deepEqual(items.map((i) => i.state), ['clean', 'stale', 'unknown']);
});

test('tickerItems: does not carry the row standing tone into the ticker', () => {
  // The ticker colours the leading state word and mutes everything after it, so
  // the table's per-standing tone has no meaning here.
  const [item] = tickerItems([row({ status: 'disputed', standingTone: 'disputed' })]);
  assert.equal('standingTone' in item, false);
});

/* ----------------------------------------------------------- stat band --*/

test('homeStats: an undefined stat produces no tile, and is not rendered as 0', () => {
  const view = { rows: [row()], stats: { reviewed: undefined, flagged: undefined }, partial: false };
  const tiles = homeStats(view);
  const keys = tiles.map((t) => t.key);
  assert.equal(tiles.length, 1);
  assert.ok(keys.includes('entriesIndexed'));
  assert.ok(tiles.every((t) => t.value !== 0 || t.key === 'entriesIndexed'));
});

test('homeStats: entries indexed is a real 0 on an empty, non-partial registry', () => {
  const view = { rows: [], stats: {}, partial: false };
  const tiles = homeStats(view);
  const entries = tiles.find((t) => t.key === 'entriesIndexed');
  // Unlike an unreported stat, zero entries is a known fact, so the tile exists.
  assert.ok(entries);
  assert.equal(entries.value, 0);
});

test('homeStats: reviewed and flagged tiles appear when reported, flagged carries its tone', () => {
  const view = { rows: [row(), row({ name: 'b' })], stats: { reviewed: 1, flagged: 1 }, partial: false };
  const tiles = homeStats(view);
  assert.equal(tiles.length, 3);
  const flagged = tiles.find((t) => t.key === 'flagged');
  assert.equal(flagged.value, 1);
  assert.equal(flagged.tone, 'flagged');
  const reviewed = tiles.find((t) => t.key === 'reviewed');
  assert.equal(reviewed.value, 1);
  assert.equal(reviewed.tone, undefined);
});

test('homeStats: partial:true omits the entries-indexed tile, since rows.length is the flagged feed, not the registry', () => {
  const view = { rows: [row({ status: 'flagged' })], stats: { flagged: 1 }, partial: true };
  const tiles = homeStats(view);
  assert.ok(!tiles.some((t) => t.key === 'entriesIndexed'));
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].key, 'flagged');
});

test('homeStats: no tiles at all when nothing was reported and nothing to count', () => {
  // Not a shape getRegistry() produces, but it must not throw or invent a tile.
  const view = { rows: [], stats: {}, partial: true };
  assert.deepEqual(homeStats(view), []);
});
