/**
 * Data shaping for the homepage ticker and stat band. Both only reshape what
 * `getRegistry()` returned — no invented rows, no hardcoded counts (see
 * `lib/copy.ts`). No copy lives here.
 */

import type { RegistryView } from './api.ts';
import type { RegistryRow, RowStatus, Tier } from './types.ts';

/** One row, shaped for the ticker. Fields stay separate so the component can colour the state word independently of the rest. */
export interface TickerItem {
  state: RowStatus;
  name: string;
  version: string;
  tier: Tier | '—';
  /** The short standing/reason phrase, e.g. "uncontested" or "rebuttal on file — both claims stand". */
  standing: string;
}

/** Shapes real registry rows into ticker entries; does not decide which rows to show. */
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

/** Which stat a tile is. Words live in `COPY.home.stats[key]`, not here. */
export type StatKey = 'entriesIndexed' | 'reviewed' | 'flagged';

export interface StatTile {
  value: number;
  key: StatKey;
  tone?: StatTone;
}

/**
 * The three stat-band tiles, derived from the registry view returned to the page.
 * Fields on `RegistryStats` are optional and stay omitted rather than coerced to
 * zero when unreported. When `view.partial` is true (API served only the flagged
 * feed, see `RegistryView` in `lib/api.ts`), `rows.length` is the flagged feed's
 * size, not the registry's — so the entries-indexed tile is omitted rather than
 * mislabeled.
 */
export function homeStats(view: RegistryView): StatTile[] {
  const tiles: StatTile[] = [];

  // A non-partial registry with zero rows is a real 0, not a missing stat.
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
