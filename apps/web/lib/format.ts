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
