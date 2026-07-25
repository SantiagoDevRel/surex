import Link from 'next/link';

import { COPY } from '@/lib/copy.ts';
import { cn } from '@/lib/cn.ts';
import { STANDING_TONE, stateStyle } from '@/lib/state-styles.ts';
import type { RegistryRow, Tier } from '@/lib/types.ts';

/**
 * The compact custody row. LOCKED — design/tokens.html §06, option 1c.
 *
 *   state (hue, 600) · tier (letter 600 + 3-cell meter) · standing (plain)
 *   · meta right-aligned. 32px row, line-2 separators.
 *
 * The meter is the chain, shrunk to a glance: three cells, filled as far as the
 * link actually reaches.
 */

/** ▮▮▮ / ▮▮ / ▮ — 7px cells, 2px gaps, 25px total. */
export function TierMeter({ tier }: { tier: Tier | '—' }) {
  const filled = tier === 'A' ? 3 : tier === 'B' ? 2 : tier === 'C' ? 1 : 0;
  return (
    <span className="flex shrink-0 gap-[2px]" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn('h-[7px] w-[7px]', i < filled ? 'bg-ink-2' : 'bg-line')}
        />
      ))}
    </span>
  );
}

export function CustodyHeader() {
  return (
    <div className="flex items-center gap-2.5 border-b border-line px-4 py-2 text-[8.5px] uppercase tracking-[0.14em] text-faint">
      <span className="w-[236px]">{COPY.browse.columnServer}</span>
      <span className="w-[104px]">{COPY.browse.columnState}</span>
      <span className="w-[66px]">{COPY.browse.columnTier}</span>
      <span className="flex-1">{COPY.browse.columnStanding}</span>
      <span className="w-[120px]">{COPY.browse.columnReviewed}</span>
      <span className="w-[110px] text-right">{COPY.browse.columnCapabilities}</span>
    </div>
  );
}

export function CustodyRow({ row }: { row: RegistryRow }) {
  const s = stateStyle(row.status);

  const body = (
    <>
      <span className="w-[236px] truncate text-data text-ink">
        {row.name} <span className="text-ink-3">{row.version}</span>
      </span>
      <span className={cn('w-[104px] text-row font-semibold', s.text)}>
        {row.status === 'running' ? COPY.states.running : row.status}
      </span>
      <span className="flex w-[66px] items-center gap-1.5">
        <TierMeter tier={row.tier} />
        <span
          className={cn('text-row font-semibold', row.tier === '—' ? 'text-faint' : 'text-ink')}
        >
          {row.tier}
        </span>
      </span>
      <span
        className={cn(
          'flex-1 text-meta',
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
      <span className="w-[120px] text-mini text-ink-3">{row.reviewedAt}</span>
      <span className="w-[110px] text-right text-mini text-ink-3">{row.capabilities}</span>
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
