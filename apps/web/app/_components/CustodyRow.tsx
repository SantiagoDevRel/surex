import Link from 'next/link';

import { COPY } from '@/lib/copy.ts';
import { cn } from '@/lib/cn.ts';
import { isoMinute } from '@/lib/format.ts';
import { STANDING_TONE, stateStyle } from '@/lib/state-styles.ts';
import type { RegistryRow } from '@/lib/types.ts';

/**
 * The compact custody row.
 *
 *   state (hue, 600) · standing (plain) · meta right-aligned.
 *   32px row, line-2 separators.
 *
 * The TIER cell and its three-cell meter used to sit between state and standing.
 * Both are gone: every published entry is Tier C, so the column printed one
 * identical letter down the page and the meter one identical bar. Tier is still
 * real and still decides what the gate may claim on a developer's machine — it
 * just told a reader of this list nothing.
 */

/**
 * Column widths live here, once, shared by the header and the row — they are a
 * single grid and drifting them silently misaligns the table.
 *
 * `shrink-0` on every fixed cell is load-bearing: a flex item with a width can
 * still be squeezed below it, and a squeezed cell wraps. That is exactly how the
 * REVIEWED column came to render its ISO timestamp over two lines and double the
 * height of every row in the table (spec is a 32px row — tokens §06).
 */
const COL = {
  server: 'w-[236px] shrink-0',
  state: 'w-[104px] shrink-0',
  standing: 'flex-1',
  /**
   * `2026-07-25 14:31Z` — 17 mono chars ≈ 106px, plus the same breathing room the
   * date-only version had. `shrink-0` and `whitespace-nowrap` are load-bearing
   * here for the reason recorded above: this is the cell that wrapped and doubled
   * every row's height, and it now carries six more characters.
   */
  reviewed: 'w-[148px] shrink-0 whitespace-nowrap',
  /** Fits the widest capability line the scanner can emit, `net fs proc env cred`. */
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

  // An em dash trailing the name is how "no version recorded" used to read, and
  // in a list it reads as a typo instead of as an absence. The version is simply
  // absent here; the entry's own page is where a missing version is explained.
  const version = row.version && row.version !== '—' ? row.version : null;

  // Date AND time, to the minute, in UTC.
  //
  // This column used to show the date alone, on the argument that a list wants a
  // date. That argument does not survive a registry that publishes several
  // verdicts in an afternoon: a demo where three servers are reviewed minutes
  // apart renders three identical cells, and "when was this reviewed" — the
  // question the column exists to answer — stops being answerable from the list.
  //
  // The two are rendered at different weights rather than as one 16-character
  // run, so the date still scans down the column and the time reads as its
  // qualifier. The full recorded timestamp stays on the hover title and on the
  // verdict page's provenance panel.
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
