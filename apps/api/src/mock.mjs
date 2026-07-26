// Mock mode. SUREX_MOCK=1 → every route answers from fixtures with NO Arkiv
// connection at all.
//
// THE ONE RULE: every response carries `illustrative: true`, and that flag is
// never stripped anywhere — fixture data rendered as real is the failure this
// product objects to (AGENTS.md §4).
//
// Fixtures are imported statically, not globbed off disk: a static import is
// traced by Vercel's bundler, a readdir in a serverless function finds nothing.

import { unknownHead, isFingerprint } from '@surex/core';
import { withLinks } from './links.mjs';

import cleanTierA from '../fixtures/clean-tier-a.json' with { type: 'json' };
import flaggedTierB from '../fixtures/flagged-tier-b.json' with { type: 'json' };
import disputed from '../fixtures/disputed.json' with { type: 'json' };
import stale from '../fixtures/stale.json' with { type: 'json' };
import unreviewableLicence from '../fixtures/unreviewable-licence.json' with { type: 'json' };
import unknownMiss from '../fixtures/unknown-miss.json' with { type: 'json' };

/** In fixture order, so /v1/flagged and /v1/stats are stable across runs. */
export const FIXTURES = Object.freeze([
  cleanTierA,
  flaggedTierB,
  disputed,
  stale,
  unreviewableLicence,
  unknownMiss,
]);

/** The fingerprint that is deliberately absent — the gate lane's miss-path input. */
export const MISS_FINGERPRINT = unknownMiss.fingerprint;

/** Stamp the flag. Applied on the way out of every mock read, without exception. */
export function mark(value) {
  if (Array.isArray(value)) return value.map(mark);
  if (!value || typeof value !== 'object') return value;
  return { ...value, illustrative: true };
}

export function createMockStore(options = {}) {
  const env = options.env ?? process.env;
  const fixtures = options.fixtures ?? FIXTURES;

  const present = fixtures.filter((f) => !f.absent && f.head);
  const byFp = new Map(present.map((f) => [f.fingerprint, f]));
  const byKey = new Map();
  for (const f of present) {
    for (const s of f.sources ?? []) if (s.key) byKey.set(s.key, { kind: 'source', record: s });
    for (const r of f.reviews ?? []) if (r.key) byKey.set(r.key, { kind: 'review', record: r });
  }

  async function getVerdictHead(fp) {
    if (!isFingerprint(fp)) return null;
    const f = byFp.get(fp);
    return f ? mark(f.head) : null;
  }

  async function getVerdictHeads(fps) {
    const out = new Map();
    for (const fp of fps) {
      const head = await getVerdictHead(fp);
      if (head) out.set(fp, head);
    }
    return out;
  }

  async function getEntry(fp) {
    if (!isFingerprint(fp)) return null;
    const f = byFp.get(fp);
    if (!f) return null;
    return mark({
      fingerprint: fp,
      entry: f.entry ? mark(withLinks(f.entry, env)) : null,
      head: mark(f.head ?? unknownHead(fp)),
      sources: (f.sources ?? []).map((s) => mark(withLinks(s, env))),
      reviews: (f.reviews ?? []).map((r) => mark(withLinks(r, env))),
      ...(f.dispute ? { dispute: mark(withLinks(f.dispute, env)) } : {}),
      ...(f.latestReleaseVersion ? { latestReleaseVersion: f.latestReleaseVersion } : {}),
    });
  }

  const getByKey = (key, kind) => {
    const hit = byKey.get(key);
    if (!hit || hit.kind !== kind) return null;
    return mark(withLinks(hit.record, env));
  };

  async function getSource(key) {
    return getByKey(key, 'source');
  }
  async function getReview(key) {
    return getByKey(key, 'review');
  }

  async function listFlagged({ limit = 100 } = {}) {
    const heads = present
      .map((f) => f.head)
      .filter((h) => h.state === 'flagged' || h.state === 'disputed')
      .sort(
        (a, b) =>
          Number(b.severity ?? 0) - Number(a.severity ?? 0) ||
          String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')),
      );
    return mark({ heads: heads.slice(0, limit).map(mark), total: heads.length });
  }

  /** The whole fixture registry, every state — mirrors the live shape. */
  async function listRegistry({ limit = 200, state = null } = {}) {
    const RANK = { flagged: 0, disputed: 1, stale: 2, unreviewable: 3, clean: 4, unknown: 5 };
    const heads = present
      .map((f) => f.head)
      .filter((h) => !state || h.state === state)
      .sort(
        (a, b) =>
          (RANK[a.state] ?? 9) - (RANK[b.state] ?? 9) ||
          Number(b.severity ?? 0) - Number(a.severity ?? 0) ||
          String(a.name ?? a.fingerprint).localeCompare(String(b.name ?? b.fingerprint)),
      );
    const byState = {};
    for (const h of heads) byState[h.state] = (byState[h.state] ?? 0) + 1;
    return mark({ heads: heads.slice(0, limit).map(mark), total: heads.length, byState });
  }

  async function stats() {
    const byState = {};
    for (const f of present) byState[f.head.state] = (byState[f.head.state] ?? 0) + 1;
    return mark({
      source: 'fixtures',
      entries: present.length,
      verdictHeads: present.length,
      byState,
    });
  }

  async function health() {
    return mark({ ok: true, mode: 'mock', fixtures: fixtures.length, arkiv: 'not connected' });
  }

  return {
    mode: 'mock',
    illustrative: true,
    fixtures,
    missFingerprint: MISS_FINGERPRINT,
    getVerdictHead,
    getVerdictHeads,
    getEntry,
    getSource,
    getReview,
    listFlagged,
    listRegistry,
    stats,
    health,
  };
}
