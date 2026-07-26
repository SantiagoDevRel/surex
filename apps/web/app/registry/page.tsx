import { getRegistry } from '@/lib/api.ts';
import { COPY } from '@/lib/copy.ts';
import { DEFAULT_STATE, matchesState, statusRank } from '@/lib/format.ts';
import type { RegistryRow } from '@/lib/types.ts';

import { Banner } from '../_components/Banner.tsx';
import { Footer } from '../_components/Footer.tsx';
import { IllustrativeBanner } from '../_components/IllustrativeBanner.tsx';
import { RegistryFilters, type RegistryQuery } from '../_components/RegistryFilters.tsx';
import { RegistryTable, StatStrip } from '../_components/RegistryTable.tsx';

// Dynamic on purpose — prerendering would freeze the fixture fallback into a
// page that could have been live.
export const dynamic = 'force-dynamic';

export const metadata = { title: COPY.browse.title };

function one(value: string | string[] | undefined, fallback: string): string {
  if (Array.isArray(value)) return value[0] ?? fallback;
  return value ?? fallback;
}

function filterRows(rows: RegistryRow[], query: RegistryQuery): RegistryRow[] {
  const needle = query.q.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (!matchesState(row.status, query.state)) return false;
    if (!needle) return true;
    return (
      row.name.toLowerCase().includes(needle) ||
      row.version.toLowerCase().includes(needle) ||
      row.capabilities.toLowerCase().includes(needle) ||
      (row.fingerprint ?? '').toLowerCase().includes(needle)
    );
  });

  // Sorted here, always — Arkiv accepts `orderBy` silently and does nothing with it.
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
    // The default is the decided view, not `all` — rows left out are counted
    // and linked under the filters, see HiddenNotice.
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
        <RegistryTable rows={visible} total={rows.length} query={query.q} />

        <Footer />
      </main>
    </>
  );
}
