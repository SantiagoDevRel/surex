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
      <Panel className="mt-3 overflow-x-auto">
        {/* Wide enough that STANDING never wraps — a wrapped cell doubles the
            row height, and the row is specified at 32px (tokens §06). Below
            this the panel scrolls sideways instead of growing downwards.

            THE NUMBER IS ARITHMETIC, NOT TASTE, so it has to move when a column
            does. The five fixed cells in CustodyRow's COL (236+104+66+148+132),
            the gaps and 16px of padding either side come to 768px; the
            remainder is STANDING, the only flexible cell, which needs 316px to
            hold its longest line plus the `illustrative` marker on one row.

            This number is ARITHMETIC over the column widths and has to move
            whenever they do — it was already caught once lagging behind REVIEWED
            growing 104px to 148px, which cut STANDING to 272px and wrapped every
            row to 51px. Dropping the 66px TIER cell and one 10px gap takes the
            fixed total 768 → 692, so 692 + 316 = 1008. */}
        <div className="min-w-[1008px]">
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
        <span>{COPY.browse.rowsAreLinks}</span>
      </div>
    </>
  );
}
