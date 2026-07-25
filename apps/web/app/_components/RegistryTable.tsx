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
      <Panel className="mt-3 overflow-x-auto">
        {/* Wide enough that STANDING never wraps — a wrapped cell doubles the
            row height, and the row is specified at 32px (tokens §06). Below
            this the panel scrolls sideways instead of growing downwards.

            THE NUMBER IS ARITHMETIC, NOT TASTE, so it has to move when a column
            does. The five fixed cells in CustodyRow's COL (236+104+66+148+132),
            five 10px gaps and 16px of padding either side come to 768px; the
            remainder is STANDING, which is the only flexible cell. This was
            1040 when REVIEWED was 104px wide — 724 fixed + 316 for STANDING.
            REVIEWED then grew to 148px for the timestamp and this number did
            not follow it, which quietly cut STANDING to 272px at the narrow end
            and put the longest standing line plus the `illustrative` marker back
            over the edge the min-width exists to keep it inside. 768 + 316 =
            1084 restores exactly the slack the row was designed with. */}
        <div className="min-w-[1084px]">
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

      {/* The tier gloss that used to sit here is now the legend above the table
          (TierLegend) — one wording for the three letters, where the reader
          meets the column rather than after they have scrolled past it. */}
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
