/**
 * Display formatting only. No decisions live here.
 *
 * Anything that decides — block or warn, which tier sentence, which
 * confidence tone — comes from `@surex/core`, because the site and the gate
 * have to agree and they agree by sharing that module.
 */

import type { Capabilities, RowStatus, Tier } from './types.ts';

/** `sxf1_9f2e4c81…30d6a` — enough to recognise, short enough to sit in a row. */
export function shortFingerprint(fp: string | undefined, head = 13, tail = 5): string {
  if (!fp) return '—';
  return fp.length <= head + tail + 1 ? fp : `${fp.slice(0, head)}…${fp.slice(-tail)}`;
}

export function shortId(id: string | undefined, head = 6, tail = 4): string {
  if (!id) return '—';
  return id.length <= head + tail + 1 ? id : `${id.slice(0, head)}…${id.slice(-tail)}`;
}

/** ISO or epoch → `2026-07-23`. Never invents a date it does not have. */
export function isoDate(value: string | number | undefined | null): string | null {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(typeof value === 'number' ? value : String(value));
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString().slice(0, 10);
}

/**
 * ISO or epoch → `{ date: '2026-07-23', time: '14:31Z' }`, split so a row can
 * render the two at different weights. Always UTC (the `Z`) so readers in
 * different timezones agree on when a verdict happened. Minutes, not seconds —
 * seconds would imply precision `reviewedAt` doesn't have.
 */
export function isoMinute(
  value: string | number | undefined | null,
): { date: string; time: string } | null {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(typeof value === 'number' ? value : String(value));
  if (Number.isNaN(d.getTime())) return null;
  const iso = d.toISOString();
  return { date: iso.slice(0, 10), time: `${iso.slice(11, 16)}Z` };
}

/**
 * `104000` → `1m 44s`. `null` for anything that is not a duration — a run that
 * hasn't reported one gets no value, not a zero: `0s` reads as "just started",
 * a different claim from "nobody said".
 */
export function humanDuration(ms: number | undefined | null): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return null;
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/** `stripe-mcp-tools@1.0.4` → `{ name, version }`. Scoped names keep their `@`. */
export function splitName(name: string | undefined): { name: string; version: string } {
  if (!name) return { name: 'unnamed entry', version: '' };
  const at = name.lastIndexOf('@');
  if (at <= 0) return { name, version: '' };
  return { name: name.slice(0, at), version: name.slice(at + 1) };
}

const SHORT_CAPS: Record<string, string> = {
  network: 'net',
  filesystem: 'fs',
  exec: 'proc',
  env: 'env',
  credentials: 'cred',
};

/** The row-width form: `net env cred`. The long prose form is `capabilityLine()`. */
export function shortCapabilities(capabilities: Capabilities | undefined): string {
  if (!capabilities) return '—';
  const present = Object.entries(capabilities)
    .filter(([, v]) => v && v.present)
    .map(([k]) => SHORT_CAPS[k] ?? k);
  return present.length ? present.join(' ') : 'none detected';
}

/** How many of the three linkage segments are actually connected. */
export function tierSegments(tier: Tier | '—'): number {
  switch (tier) {
    case 'A':
      return 3;
    case 'B':
      return 2;
    case 'C':
      return 1;
    default:
      // MISMATCH is a broken chain, not a weak one.
      return 0;
  }
}

/** Sort order for the registry's default view: worst news first. */
export function statusRank(status: RowStatus): number {
  const order: RowStatus[] = [
    'flagged',
    'disputed',
    'stale',
    'clean',
    'unreviewable',
    'unknown',
    'running',
  ];
  const i = order.indexOf(status);
  return i === -1 ? order.length : i;
}

/* ------------------------------------------------ what the default view is --*/

/**
 * The value of `?state=` meaning "the default view" (`all`). Not a `RowStatus`
 * on purpose — otherwise `?state=clean` and the default would be indistinguishable
 * in a pasted URL. `decided` still exists as a selectable value; it just isn't default.
 */
export const DEFAULT_STATE = 'all';

/**
 * Is this a state where a review reached a verdict about the code? Derived from
 * `statusRank` (worst-news-first) rather than a second list, so the two can't
 * drift — `clean` is the boundary. `stale` counts as decided: it ranks worse
 * than `clean`, and it's the same set `normaliseStats()` counts as `reviewed`
 * (lib/api.ts, REVIEWED_STATES).
 */
export function isDecided(status: RowStatus): boolean {
  return statusRank(status) <= statusRank('clean');
}

/** The view that shows only the entries a review reached a verdict on. */
export const DECIDED_STATE = 'decided';

/**
 * Does a row belong in the view `state` names? The one place that decides.
 * `decided` is matched by name, not by comparing against `DEFAULT_STATE` — the
 * two are independent, so changing the default can't silently break `?state=decided`.
 */
export function matchesState(status: RowStatus, state: string): boolean {
  if (state === 'all') return true;
  if (state === DECIDED_STATE) return isDecided(status);
  return status === state;
}

export interface StateCount {
  status: RowStatus;
  count: number;
}

/**
 * What the default view is holding back, by state, worst news first — so the
 * screen can print the number it isn't showing. States with nothing in them are
 * omitted rather than rendered as "0 running": that's noise, not disclosure.
 */
export function hiddenFromDefault(rows: readonly { status: RowStatus }[]): StateCount[] {
  const counts = new Map<RowStatus, number>();
  for (const row of rows) {
    if (isDecided(row.status)) continue;
    counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => statusRank(a.status) - statusRank(b.status));
}

/** How many rows the default view leaves out. Never derived by subtraction. */
export function hiddenCount(rows: readonly { status: RowStatus }[]): number {
  return rows.filter((row) => !isDecided(row.status)).length;
}
