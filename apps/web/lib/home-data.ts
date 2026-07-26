/**
 * Data shaping for the two data-driven sections of the homepage: the ticker
 * and the stat band.
 *
 * Both sections exist to make a claim ("this many entries", "these are real
 * rows") and the design system is explicit that the claim has to be true:
 * "Every number on screen is derived from rows actually rendered — a
 * hardcoded count is a fabrication," and for the ticker, "Real rows only — a
 * ticker of invented entries would be the loudest lie on the page." So
 * neither function here invents anything: they only reshape what
 * `getRegistry()` already returned.
 *
 * No copy lives here — see `lib/copy.ts`'s own rule against hardcoded counts.
 * Labels are left as `TODO` markers naming the `COPY.home.*` key that should
 * fill them in once that file has one.
 *
 * `.ts` import, no build step: Node strips types when the tests run this file
 * directly.
 */

import type { RegistryView } from './api.ts';
import type { RegistryRow, RowStatus, Tier } from './types.ts';

/**
 * One row, shaped for the ticker. Fields stay separate rather than being
 * joined into one string — `clean mcp-server-postgres 0.6.2 · tier A ·
 * uncontested` — because the component colours the state word by its own
 * hue and leaves the rest in muted ink; a pre-joined string would force it to
 * parse the state word back out.
 */
export interface TickerItem {
  state: RowStatus;
  name: string;
  version: string;
  tier: Tier | '—';
  /** The short standing/reason phrase, e.g. "uncontested" or "rebuttal on file — both claims stand". */
  standing: string;
}

/**
 * Shapes real registry rows into ticker entries. Nothing here decides which
 * rows to show or invents a count — that is the caller's job (and the
 * registry's, upstream). An empty registry produces an empty ticker; the
 * component decides what an empty ticker does, not this function.
 */
export function tickerItems(rows: RegistryRow[]): TickerItem[] {
  return rows.map((row) => ({
    state: row.status,
    name: row.name,
    version: row.version,
    tier: row.tier,
    standing: row.standing,
  }));
}

/** The colour a stat tile takes. Only the states the mock actually emphasises. */
export type StatTone = 'flagged';

/**
 * Which stat a tile is. The words live in `COPY.home.stats[key]`, not here —
 * this module derives numbers, and a number's identity is stable in a way its
 * caption is not. The band renders `COPY.home.stats[tile.key]`.
 */
export type StatKey = 'entriesIndexed' | 'reviewed' | 'flagged';

export interface StatTile {
  value: number;
  key: StatKey;
  tone?: StatTone;
}

/**
 * The three stat-band tiles, derived from the registry view actually
 * returned to the page.
 *
 * Two honesty rules, both already established elsewhere in this codebase and
 * followed here rather than re-litigated:
 *
 *   1. Every field on `RegistryStats` is optional, and `StatStrip` already
 *      treats "undefined" and "0" as different claims — a stat nobody
 *      reported is omitted, never coerced to zero. Same rule here.
 *
 *   2. `view.partial` is true when the API could only serve the flagged feed,
 *      not the whole registry (see `RegistryView` in `lib/api.ts`). In that
 *      case `view.rows.length` is the size of the flagged feed, not the size
 *      of the registry — presenting it as "entries indexed" would claim
 *      coverage the page does not have. The entries-indexed tile is omitted
 *      in that case rather than captioned, because the alternative (a
 *      partial-data caveat baked into this tile) is new copy this function
 *      does not own, and an omitted tile is a page that is honest about
 *      exactly as much as it knows — the same choice `hiddenFromDefault()`
 *      makes for the table, just applied to a tile instead of a row.
 *      `view.partial` is still on `RegistryView` if a section elsewhere
 *      wants to say so.
 */
export function homeStats(view: RegistryView): StatTile[] {
  const tiles: StatTile[] = [];

  // Unlike the fields on `RegistryStats`, `rows.length` is never "not
  // reported" — a reachable, non-partial registry with zero rows is a real
  // fact (an empty registry), not a missing one, so it renders as 0.
  if (!view.partial) {
    tiles.push({ value: view.rows.length, key: 'entriesIndexed' });
  }

  if (view.stats.reviewed !== undefined) {
    tiles.push({ value: view.stats.reviewed, key: 'reviewed' });
  }

  if (view.stats.flagged !== undefined) {
    tiles.push({ value: view.stats.flagged, key: 'flagged', tone: 'flagged' });
  }

  return tiles;
}
