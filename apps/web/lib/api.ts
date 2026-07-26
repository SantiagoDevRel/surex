/**
 * The registry client.
 *
 * Written against the frozen contract in `packages/core/src/contract.mjs`, not
 * against the API implementation — `ROUTES` builds every path and
 * `parseVerdictHead()` validates every head before anything renders it. The
 * API is a separate lane being built in parallel; this file must work whether
 * or not it is up yet.
 *
 * Three outcomes, kept distinct because they mean different things:
 *
 *   reachable + answer   → live data, no banner
 *   reachable + 404      → `unknown`. A real fact: nobody has submitted this
 *                          install configuration. Not an error, not fixtures.
 *   unreachable / 5xx    → local fixtures, and the illustrative banner goes up
 *                          and stays up for as long as the data is fake.
 *
 * A malformed head degrades to `unknown`, never to `clean` — same rule the
 * gate follows, for the same reason.
 */

import { ROUTES, parseVerdictHead, unknownHead, isFingerprint } from '@surex/core';

import { apiBase } from './api-base.ts';
import { COPY } from './copy.ts';
import {
  fixtureDispute,
  fixtureEntry,
  fixtureRows,
  fixtureStats,
} from './fixtures.ts';
import { shortCapabilities, splitName } from './format.ts';
import type {
  Dispute,
  Entry,
  Finding,
  RegistryRow,
  RegistryStats,
  Sourced,
  Tier,
  VerdictHead,
} from './types.ts';

/** Lives in `api-base.ts` so the browser can import it without `@surex/core`. */
export { apiBase } from './api-base.ts';

/**
 * More generous than `GATE_BUDGET.networkTimeoutMs` (1500 ms) on purpose: that
 * budget exists because the gate sits in front of every tool call. A page
 * render can afford to wait longer before giving up on live data.
 *
 * 2500 ms was not longer enough. Six consecutive `/v1/entry` reads against the
 * deployed API measured 2.7-3.2 s warm, so the budget was under the ordinary
 * case and every read fell back to fixtures; a cold function is slower still.
 * The failure is silent and asymmetric — the page loses live data and shows
 * placeholder content in its place — so the budget is set above the cold case
 * rather than beside the warm one.
 */
const TIMEOUT_MS = 8000;

type Fetched<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      kind: 'notfound' | 'unreachable';
      detail: string;
      /** The API marks its own error bodies too. Carried so a 404 from a mock
          registry can still say the answer is illustrative. */
      illustrative?: boolean;
    };

async function getJson<T>(path: string, init?: RequestInit): Promise<Fetched<T>> {
  const url = `${apiBase()}${path}`;
  try {
    const res = await fetch(url, {
      ...init,
      cache: 'no-store',
      headers: { accept: 'application/json', ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404 || res.status === 400) {
      const body = (await res.json().catch(() => null)) as { illustrative?: boolean } | null;
      return {
        ok: false,
        kind: 'notfound',
        detail: `HTTP ${res.status}`,
        illustrative: body?.illustrative === true,
      };
    }
    if (!res.ok) return { ok: false, kind: 'unreachable', detail: `HTTP ${res.status}` };
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'network error';
    return { ok: false, kind: 'unreachable', detail };
  }
}

function fixture<T>(data: T, note: string): Sourced<T> {
  return { data, origin: 'fixture', illustrative: true, note };
}

function live<T>(data: T, illustrative: boolean): Sourced<T> {
  return { data, origin: 'api', illustrative };
}

/** Anything the API marked as demo data taints the whole screen. */
function tainted(...values: unknown[]): boolean {
  return values.some((v) => {
    if (Array.isArray(v)) return v.some((x) => tainted(x));
    if (v && typeof v === 'object') return (v as { illustrative?: boolean }).illustrative === true;
    return false;
  });
}

/* ----------------------------------------------------------- the verdict --*/

/**
 * `GET /v1/verdict?fp=…` — the hot path. Returns a head that is always safe to
 * render: a bad fingerprint, a 404 or a malformed payload all come back as
 * `unknown`, which the UI presents as "not in the registry" rather than as a
 * clean bill of health.
 */
export async function getVerdict(fp: string): Promise<Sourced<VerdictHead>> {
  if (!isFingerprint(fp)) {
    return { data: unknownHead(fp) as VerdictHead, origin: 'api', illustrative: false };
  }

  const res = await getJson<unknown>(ROUTES.verdict(fp));
  if (res.ok) {
    const head = parseVerdictHead(res.data) as VerdictHead | null;
    if (head) return live(head, head.illustrative === true);
    // Reachable but unreadable. Degrade visibly, never to `clean`.
    return live(unknownHead(fp) as VerdictHead, false);
  }
  if (res.kind === 'notfound') return live(unknownHead(fp) as VerdictHead, false);

  const entry = fixtureEntry(fp);
  if (entry) return fixture(entry.head, `${COPY.banners.unreachableLabel}: ${res.detail}`);
  return fixture(unknownHead(fp) as VerdictHead, `${COPY.banners.unreachableLabel}: ${res.detail}`);
}

/* ------------------------------------------------------------- the entry --*/

/** Read whatever the entry route gives us without assuming its full shape. */
function normaliseEntry(fp: string, raw: unknown): Entry | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Record<string, unknown>;
  const head = parseVerdictHead(body.head ?? body) as VerdictHead | null;
  if (!head) return null;

  const pick = <T>(key: string): T | undefined => body[key] as T | undefined;

  /**
   * `parseVerdictHead` copies only the frozen contract's fields, so `links` —
   * which the API attaches beside the pointer — is dropped on the way through.
   * Re-attached here from the raw body rather than widened into the core
   * contract, because the gate resolves a decision from annotations alone and
   * has no use for a URL.
   */
  const rawHead = (body.head ?? body) as Record<string, unknown>;
  const headLinks = rawHead.links as Entry['head']['links'] | undefined;

  /**
   * The API returns `sources` and `reviews` — PLURAL, newest first, because a
   * fingerprint accumulates them. This read `body.source` and `body.review`,
   * which the API has never sent, so both were always undefined: the verdict
   * page fell back to synthesising a review from the head's own fields and the
   * source panel had nothing at all. Take the newest of each, and keep the
   * singular fallback for the shape the fixtures use.
   */
  const newest = <T>(key: string): T | undefined => {
    const list = body[key] as T[] | undefined;
    return Array.isArray(list) && list.length ? list[0] : undefined;
  };

  return {
    head: headLinks ? { ...head, links: headLinks } : head,
    summary: pick<string>('summary'),
    options: pick<string>('options'),
    /**
     * The whole list when the API could refetch the certified blob, the head's
     * single finding when it could not.
     *
     * A failed fetch must NEVER collapse to `[]`: an empty findings array renders
     * as "none recorded", which on a flagged entry states the opposite of what
     * happened. So the fallback is the one finding we do have, and if the head has
     * none either the page says so in its own words.
     */
    findings: (() => {
      const served = body.findings as { items?: Entry['findings'] } | Entry['findings'] | undefined;
      if (Array.isArray(served) && served.length) return served;
      const items = (served as { items?: Entry['findings'] } | undefined)?.items;
      if (Array.isArray(items) && items.length) return items;
      return head.topFinding ? [head.topFinding] : [];
    })(),
    source: newest<Entry['source']>('sources') ?? pick<Entry['source']>('source'),
    review:
      newest<Entry['review']>('reviews') ??
      pick<Entry['review']>('review') ??
      (head.modelId
        ? { modelId: head.modelId, promptVersion: head.promptVersion, analyzedAt: head.reviewedAt }
        : undefined),
    localLinkage: pick<Entry['localLinkage']>('localLinkage'),
    tierNote: pick<string>('tierNote'),
    dispute: pick<Dispute>('dispute'),
    supersededBy: pick<string>('supersededBy'),
    supersededAt: pick<string>('supersededAt'),
    overrideCommand: pick<string>('overrideCommand') ?? `surex allow ${fp}`,
    illustrative: head.illustrative === true,
  };
}

/**
 * `GET /v1/entry/<fp>` — the whole verdict page. `null` data means the
 * registry genuinely has no entry, which is a different screen from a registry
 * we could not reach.
 */
export async function getEntry(fp: string): Promise<Sourced<Entry | null>> {
  if (!isFingerprint(fp)) return { data: null, origin: 'api', illustrative: false };

  // Without `?findings=1`, so this answers from the Arkiv read alone. The flag
  // makes the API refetch the certified blob from Walrus, and measured against
  // the deployed API that is the entire cost of the route: 2.77-2.83 s with it,
  // 0.32-0.49 s without. `getFindings` asks for it separately so the page can
  // render from what the head already carries and stream the rest in.
  const res = await getJson<unknown>(ROUTES.entry(fp));
  if (res.ok) {
    const entry = normaliseEntry(fp, res.data);
    if (entry) return live(entry, entry.illustrative === true || tainted(res.data));
    return live(null, tainted(res.data));
  }
  // A mock registry's "no entry" is not a real fact about the registry either,
  // so the API's own `illustrative` flag on the 404 body still raises the banner.
  if (res.kind === 'notfound') return live(null, res.illustrative === true);

  const entry = fixtureEntry(fp);
  return fixture(entry, `${COPY.banners.unreachableLabel}: ${res.detail}`);
}

/* ---------------------------------------------------------- the findings --*/

/**
 * The whole finding list, or the reason it is not here.
 *
 * `loaded: false` is never the same as an empty `items`. An empty list renders
 * as "the review found nothing", which on a flagged entry states the opposite
 * of what happened, so a failure carries `loaded: false` and the page shows the
 * record's own links instead of a verdict it could not read.
 */
export interface FindingsResult {
  loaded: boolean;
  items: Finding[];
  /** Why the list is absent, when it is. Shown, not swallowed. */
  error?: string;
}

const notLoaded = (error: string): FindingsResult => ({ loaded: false, items: [], error });

/**
 * `GET /v1/entry/<fp>?findings=1` — the certified blob, refetched by the API.
 *
 * Split out of `getEntry` because it is a second network hop on top of the
 * Arkiv read and the page must not wait on it: the head already carries
 * `topFinding` and `findingCount`, so the verdict, the count and the first
 * finding all render without this call ever returning.
 */
export async function getFindings(fp: string): Promise<FindingsResult> {
  if (!isFingerprint(fp)) return notLoaded('not a fingerprint');

  const res = await getJson<unknown>(`${ROUTES.entry(fp)}?findings=1`);
  if (!res.ok) return notLoaded(`${COPY.banners.unreachableLabel}: ${res.detail}`);

  const body = res.data as { findings?: unknown } | null;
  const block = body?.findings as
    | { fetched?: boolean; items?: Finding[]; error?: string; reason?: string }
    | Finding[]
    | undefined;

  // The fixtures carry a plain array where the API sends a block.
  if (Array.isArray(block)) {
    return block.length ? { loaded: true, items: block } : notLoaded('the record carries no findings');
  }
  if (block?.fetched && Array.isArray(block.items) && block.items.length) {
    return { loaded: true, items: block.items };
  }
  return notLoaded(block?.error ?? block?.reason ?? 'the certified record could not be read');
}

/* ----------------------------------------------------------- the dispute --*/

/**
 * The contract has no per-fingerprint dispute route — `POST /v1/disputes`
 * files one, and the dispute record rides along on the entry. So the dispute
 * screen reads the entry and takes the dispute off it.
 */
export async function getDispute(fp: string): Promise<Sourced<Dispute | null>> {
  const entry = await getEntry(fp);
  if (entry.origin === 'fixture') {
    return fixture(fixtureDispute(fp), entry.note ?? COPY.banners.unreachableLabel);
  }
  const dispute = entry.data?.dispute ?? null;
  return live(dispute, entry.illustrative);
}

/* ---------------------------------------------------------- the registry --*/

export interface RegistryView {
  rows: RegistryRow[];
  stats: RegistryStats;
  /**
   * True when the live rows are the flagged feed only, rather than the whole
   * registry — which happens when the API predates `/v1/registry` and this page
   * had to fall back to `/v1/flagged`. The screen must then say that is what it
   * is showing rather than implying it is everything.
   */
  partial: boolean;
}

function rowFromHead(head: VerdictHead): RegistryRow {
  const { name, version } = splitName(head.name ?? head.fingerprint);
  const standing =
    head.state === 'disputed'
      ? COPY.confidence.disputed
      : head.enforceAfter && Date.now() > Number(head.enforceAfter)
        ? COPY.confidence.confirmed
        : COPY.confidence.unconfirmed;
  return {
    fingerprint: head.fingerprint,
    name,
    version: version || '—',
    status: head.state,
    tier: (head.tier ?? 'C') as Tier,
    standing,
    standingTone: head.state === 'disputed' ? 'disputed' : undefined,
    reviewedAt: head.reviewedAt ?? head.updatedAt ?? '—',
    capabilities: shortCapabilities(head.capabilities),
    illustrative: head.illustrative === true,
    linkable: true,
  };
}

function statsFromRows(rows: RegistryRow[], illustrative: boolean): RegistryStats {
  return {
    // Neither `unreviewable` nor `running` has been reviewed. Counting them
    // would overstate coverage, which is the one number nobody should inflate.
    reviewed: rows.filter(
      (r) => r.status !== 'running' && r.status !== 'unknown' && r.status !== 'unreviewable',
    ).length,
    flagged: rows.filter((r) => r.status === 'flagged').length,
    disputed: rows.filter((r) => r.status === 'disputed').length,
    stale: rows.filter((r) => r.status === 'stale').length,
    tierA: rows.filter((r) => r.tier === 'A').length,
    illustrative,
  };
}

export async function getRegistry(): Promise<Sourced<RegistryView>> {
  // `/v1/registry` lists every state and is what a browse page needs. It was
  // added after this screen surfaced the gap: seeded entries are written
  // `unknown` and never `clean`, so a flagged-only feed renders an EMPTY
  // registry as soon as seeding is what populates it.
  //
  // `/v1/flagged` remains the fallback so this page still works against an API
  // deployed before the route existed — in which case it is showing the flagged
  // feed only, and `partial` makes it say so.
  let res = await getJson<unknown>(ROUTES.registry({ limit: 200 }));
  let partialLive = false;
  if (!res.ok && res.kind !== 'unreachable') {
    res = await getJson<unknown>(ROUTES.flagged());
    partialLive = true;
  }

  if (!res.ok && res.kind === 'unreachable') {
    return fixture(
      { rows: fixtureRows(), stats: fixtureStats(), partial: false },
      `${COPY.banners.unreachableLabel}: ${res.detail}`,
    );
  }

  const body = res.ok ? res.data : null;
  const rows = headList(body)
    .map((r) => parseVerdictHead(r) as VerdictHead | null)
    .filter((h): h is VerdictHead => h !== null)
    .map(rowFromHead);

  // Reachable but with nothing to show is a real answer — an empty registry.
  const illustrative =
    rows.some((r) => r.illustrative) || tainted(body) || bodyFlag(body) === true;

  const statsRes = await getJson<unknown>(ROUTES.stats());
  const stats = statsRes.ok
    ? normaliseStats(statsRes.data, rows, illustrative)
    : statsFromRows(rows, illustrative);

  return live({ rows, stats, partial: partialLive }, illustrative || stats.illustrative === true);
}

/**
 * The frozen contract names the routes and the head fields; it does not name the
 * envelope. So read every envelope the other lane could reasonably have picked
 * rather than making them change one.
 */
function headList(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return [];
  const b = body as Record<string, unknown>;
  for (const key of ['heads', 'entries', 'verdicts', 'items', 'results']) {
    if (Array.isArray(b[key])) return b[key] as unknown[];
  }
  return [];
}

function bodyFlag(body: unknown): boolean | undefined {
  if (!body || typeof body !== 'object') return undefined;
  return (body as { illustrative?: boolean }).illustrative;
}

/**
 * `/v1/stats` is a telemetry document, not a counts document — the API lane
 * reports hit rate, lookups by state, and a nested `registry` block. Take the
 * counts where they exist and count the rows where they do not. A number that
 * is not reported is left undefined and simply not rendered; nothing here
 * invents one.
 */
export function normaliseStats(raw: unknown, rows: RegistryRow[], illustrative: boolean): RegistryStats {
  const derived = statsFromRows(rows, illustrative);
  if (!raw || typeof raw !== 'object') return derived;

  const top = raw as Record<string, unknown>;
  const flat = top as Partial<RegistryStats>;
  const registry = (top.registry ?? {}) as {
    entries?: number;
    byState?: Record<string, number>;
    illustrative?: boolean;
  };
  const byState = registry.byState ?? {};
  const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

  /**
   * `reviewed` is the SUM of the states only a real review can produce — never
   * `entries` minus something.
   *
   * The subtraction shipped once and published "41 reviewed" on a registry where
   * exactly ONE server had been reviewed: 40 seeded entries are `unknown` and the
   * API's byState did not report `unknown`, so the difference silently counted
   * them as reviewed. Coverage is the one number nobody should inflate, so it is
   * now built up from what is known rather than derived from what is missing.
   */
  const REVIEWED_STATES = ['clean', 'flagged', 'disputed', 'stale'] as const;
  const reportedReviewed = REVIEWED_STATES.reduce<number | undefined>((sum, key) => {
    const n = num(byState[key]);
    if (n === undefined) return sum;
    return (sum ?? 0) + n;
  }, undefined);
  const reviewed = num(flat.reviewed) ?? reportedReviewed;

  return {
    reviewed: reviewed ?? derived.reviewed,
    flagged: num(flat.flagged) ?? num(byState.flagged) ?? derived.flagged,
    disputed: num(flat.disputed) ?? num(byState.disputed) ?? derived.disputed,
    stale: num(flat.stale) ?? num(byState.stale) ?? derived.stale,
    // Tier A is not reported by the stats route. Left undefined, so the strip
    // omits it rather than showing a figure nobody counted.
    tierA: num(flat.tierA),
    illustrative:
      illustrative || bodyFlag(raw) === true || registry.illustrative === true,
  };
}
