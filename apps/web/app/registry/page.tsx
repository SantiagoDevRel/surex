import { getRegistry } from '@/lib/api.ts';
import { COPY } from '@/lib/copy.ts';
import { DEFAULT_STATE, matchesState, statusRank } from '@/lib/format.ts';
import type { RegistryRow } from '@/lib/types.ts';

import { Banner } from '../_components/Banner.tsx';
import { Footer } from '../_components/Footer.tsx';
import { IllustrativeBanner } from '../_components/IllustrativeBanner.tsx';
import { RegistryFilters, type RegistryQuery } from '../_components/RegistryFilters.tsx';
import { RegistryTable, StatStrip } from '../_components/RegistryTable.tsx';

/**
 * The registry list — `browse` in design/prototype.html.
 *
 * Dynamic on purpose: the API is a separate lane and may come up after this
 * page is deployed. Prerendering would freeze whichever answer was available at
 * build time, including the fixture fallback, and bake the illustrative banner
 * into a page that could have been live.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: COPY.browse.title };

function one(value: string | string[] | undefined, fallback: string): string {
  if (Array.isArray(value)) return value[0] ?? fallback;
  return value ?? fallback;
}

function filterRows(rows: RegistryRow[], query: RegistryQuery): RegistryRow[] {
  const needle = query.q.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    // `matchesState` owns which states a view contains — including the default
    // one, which is a filter and therefore something a test has to be able to
    // pin. Nothing is dropped here that RegistryFilters does not announce.
    if (!matchesState(row.status, query.state)) return false;
    if (!needle) return true;
    return (
      row.name.toLowerCase().includes(needle) ||
      row.version.toLowerCase().includes(needle) ||
      row.capabilities.toLowerCase().includes(needle) ||
      (row.fingerprint ?? '').toLowerCase().includes(needle)
    );
  });

  // Sorted here, always. Arkiv accepts `orderBy` silently and does nothing with
  // it (AGENTS.md §7) — anything ordered is ordered client-side or not at all.
  return filtered.sort((a, b) => {
    if (query.sort === 'name') return a.name.localeCompare(b.name);
    if (query.sort === 'recent') return b.reviewedAt.localeCompare(a.reviewedAt);
    return statusRank(a.status) - statusRank(b.status) || a.name.localeCompare(b.name);
  });
}

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const query: RegistryQuery = {
    q: one(sp.q, ''),
    // The default is the decided view, not `all`. A registry whose honest answer
    // for most third-party packages is "we could not read this" buries its
    // verdicts under those answers otherwise. The rows left out are counted and
    // linked immediately under the filters — see HiddenNotice.
    state: one(sp.state, DEFAULT_STATE),
    tier: one(sp.tier, 'all'),
    sort: one(sp.sort, 'state'),
  };

  const registry = await getRegistry();
  const { rows, stats, partial } = registry.data;
  const visible = filterRows(rows, query);

  return (
    <>
      <IllustrativeBanner
        origin={registry.origin}
        illustrative={registry.illustrative}
        note={registry.note}
      />

      <main className="mx-auto max-w-[1180px] px-7 pb-20 pt-9">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-title font-semibold">{COPY.browse.title}</h1>
          <p className="text-meta text-ink-2">{COPY.browse.lede}</p>
        </div>

        <StatStrip stats={stats} />

        {registry.origin === 'fixture' ? (
          <div className="mt-4">
            <Banner tone="stale" label={COPY.banners.unreachableLabel}>
              {COPY.banners.unreachableBody}
            </Banner>
          </div>
        ) : partial ? (
          <div className="mt-4">
            <Banner tone="neutral" label="FLAGGED FEED ONLY">
              The frozen /v1 contract exposes <code className="text-ink">GET /v1/flagged</code> and a
              per-fingerprint lookup, but no route that lists the whole registry — so this table is
              the flagged feed, not everything the registry holds. A clean entry is reachable by its
              fingerprint.
            </Banner>
          </div>
        ) : null}

        <RegistryFilters query={query} rows={rows} />
        {/*
          The tier legend and the two-axes explainer used to sit here.

          Both are gone from the SITE, not from the product. Tier answers "is the
          code we read the code you will run", and today every published entry is
          Tier C — so the column printed one identical letter down the page and
          the legend spent a paragraph explaining three values the registry has
          never shown two of. An explanation of a distinction the data does not
          make is something a reader has to get past, not something they learn
          from.

          `tierSentence()` still runs where it earns its place: in the gate's
          message on a developer's own machine, where "nothing was checked — this
          verdict may be about code that is not your code" is the difference
          between a verdict about their bytes and a verdict about somebody
          else's. That claim is load-bearing there and decorative here.
        */}
        <RegistryTable rows={visible} total={rows.length} query={query.q} />

        <Footer />
      </main>
    </>
  );
}
