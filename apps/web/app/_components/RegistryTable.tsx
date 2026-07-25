import Link from 'next/link';

import { COPY } from '@/lib/copy.ts';
import type { RegistryRow, RegistryStats } from '@/lib/types.ts';

import { CustodyHeader, CustodyRow } from './CustodyRow.tsx';
import { Panel } from './Panel.tsx';

/**
 * Every number here is counted off the rows on screen. AGENTS.md §4: no
 * invented registry counts. If the registry is empty the strip says zero, which
 * is a fact, rather than a figure that reads well.
 */
export function StatStrip({ stats }: { stats: RegistryStats }) {
  const items: [number | undefined, string, string][] = [
    [stats.reviewed, 'reviewed', 'text-ink'],
    [stats.flagged, 'flagged', 'text-flagged'],
    [stats.disputed, 'disputed', 'text-disputed'],
    [stats.stale, 'stale', 'text-stale'],
    [stats.tierA, 'tier A', 'text-ink'],
  ];
  return (
    <div className="mt-4 flex flex-wrap items-baseline gap-x-7 gap-y-2">
      {items.map(([value, label, tone]) =>
        value === undefined ? null : (
          <span key={label} className={`text-title font-semibold ${tone}`}>
            {value} <span className="text-mini font-normal text-ink-3">{label}</span>
          </span>
        ),
      )}
    </div>
  );
}

export function RegistryTable({
  rows,
  total,
  query,
}: {
  rows: RegistryRow[];
  total: number;
  query: string;
}) {
  return (
    <>
      <Panel className="mt-4 overflow-x-auto">
        <div className="min-w-[900px]">
          <CustodyHeader />
          {rows.map((row) => (
            <CustodyRow key={row.fingerprint ?? `${row.name}@${row.version}`} row={row} />
          ))}
          {rows.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-body text-ink-2">{COPY.browse.emptyTitle}</p>
              <p className="mx-auto mt-1.5 max-w-[62ch] text-meta text-ink-3">
                {COPY.browse.emptyBody}
              </p>
              <Link
                href="/submit"
                className="mt-3.5 inline-block rounded-input border border-accent bg-accent-t px-3.5 py-2 text-row font-semibold text-accent no-underline"
              >
                {COPY.browse.emptyAction}
              </Link>
            </div>
          ) : null}
        </div>
      </Panel>

      <div className="mt-2.5 flex flex-wrap items-baseline gap-x-3.5 gap-y-1 text-mini text-faint">
        <span>
          {rows.length} of {total} {COPY.browse.countSuffix}
          {query ? ` · matching “${query}”` : ''}
        </span>
        <span aria-hidden="true">·</span>
        <span>{COPY.browse.meterLegend}</span>
        <span aria-hidden="true">·</span>
        <span>{COPY.browse.rowsAreLinks}</span>
      </div>
    </>
  );
}
