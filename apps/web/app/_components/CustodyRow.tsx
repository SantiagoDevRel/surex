import Link from 'next/link';

import { COPY } from '@/lib/copy.ts';
import { cn } from '@/lib/cn.ts';
import { isoMinute } from '@/lib/format.ts';
import { STANDING_TONE, stateStyle } from '@/lib/state-styles.ts';
import type { RegistryRow } from '@/lib/types.ts';

// Column widths live here, once, shared by the header and the row — a single
// grid, so drifting them would silently misalign the table.
//
// `shrink-0` on every fixed cell is load-bearing: a flex item with a width
// can still be squeezed below it and wrap, which is how the REVIEWED column
// once doubled every row's height rendering its timestamp on two lines.
const COL = {
  server: 'w-[236px] shrink-0',
  state: 'w-[104px] shrink-0',
  standing: 'flex-1',
  reviewed: 'w-[148px] shrink-0 whitespace-nowrap',
  capabilities: 'w-[132px] shrink-0 whitespace-nowrap text-right',
} as const;

export function CustodyHeader() {
  return (
    <div className="flex items-center gap-2.5 border-b border-line px-4 py-2 text-[8.5px] uppercase tracking-[0.14em] text-faint">
      <span className={COL.server}>{COPY.browse.columnServer}</span>
      <span className={COL.state}>{COPY.browse.columnState}</span>
      <span className={COL.standing}>{COPY.browse.columnStanding}</span>
      <span className={COL.reviewed}>{COPY.browse.columnReviewed}</span>
      <span className={COL.capabilities}>{COPY.browse.columnCapabilities}</span>
    </div>
  );
}

export function CustodyRow({ row }: { row: RegistryRow }) {
  const s = stateStyle(row.status);

  // No version recorded is simply absent here, not an em dash — that read as a typo.
  const version = row.version && row.version !== '—' ? row.version : null;

  // Date AND time, to the minute, in UTC — a date alone can't distinguish
  // several verdicts published in one afternoon.
  const reviewedFull = row.reviewedAt && row.reviewedAt !== '—' ? row.reviewedAt : null;
  const reviewed = isoMinute(row.reviewedAt);

  const body = (
    <>
      <span className={cn(COL.server, 'truncate text-data text-ink')}>
        {row.name}
        {version ? <span className="text-ink-3"> {version}</span> : null}
      </span>
      <span className={cn(COL.state, 'text-row font-semibold', s.text)}>
        {row.status === 'running' ? COPY.states.running : row.status}
      </span>
      <span
        className={cn(
          COL.standing,
          'text-meta',
          STANDING_TONE[row.standingTone ?? 'neutral'] ?? STANDING_TONE.neutral,
        )}
      >
        {row.standing}
        {row.illustrative ? (
          <span
            title={COPY.illustrative.rowMarkerTitle}
            className="ml-2 border border-dashed border-stale-l px-1.5 text-[8.5px] uppercase tracking-[0.1em] text-stale"
          >
            {COPY.illustrative.rowMarker}
          </span>
        ) : null}
      </span>
      <span
        className={cn(COL.reviewed, 'text-mini text-ink-3')}
        title={reviewedFull ? `${COPY.browse.reviewedAtTitle}: ${reviewedFull}` : undefined}
      >
        {reviewed ? (
          <>
            {reviewed.date} <span className="text-faint">{reviewed.time}</span>
          </>
        ) : (
          '—'
        )}
      </span>
      <span className={cn(COL.capabilities, 'text-mini text-ink-3')}>{row.capabilities}</span>
    </>
  );

  const shell = 'flex items-center gap-2.5 border-b border-line-2 px-4 py-2';

  if (!row.linkable || !row.fingerprint) {
    return <div className={shell}>{body}</div>;
  }

  return (
    <Link
      href={`/r/${row.fingerprint}`}
      className={cn(shell, 'transition-colors duration-[140ms] ease-out hover:bg-panel-2')}
    >
      {body}
    </Link>
  );
}
