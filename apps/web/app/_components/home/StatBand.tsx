import { cn } from '@/lib/cn.ts';
import { COPY } from '@/lib/copy.ts';
import type { StatTile } from '@/lib/home-data.ts';

/**
 * The homepage stat band — design/website-kit screen 08. "Every number on
 * screen is derived from rows actually rendered — a hardcoded count is a
 * fabrication," so this component never invents a tile: it renders exactly
 * what `homeStats()` derived, nothing more.
 *
 * The grid is `repeat(tiles.length, 1fr)`, not a fixed three columns —
 * `homeStats()` can hand back one, two, or three tiles (an unreported stat
 * is omitted, not zeroed; a partial view drops entries-indexed entirely) and
 * the layout has to hold in every case. The mock's fourth tile
 * (end-to-end chain checks) is dropped for the same reason `lib/copy.ts`
 * drops it: that figure comes from the test suite, not the registry, so
 * nothing on this page could derive it honestly.
 *
 * Dropped below `md` per screen 07 ("DROPPED ON MOBILE: the ticker · the
 * stat band") — `hidden md:grid` removes it from layout rather than
 * shrinking it, so there is no reserved space and no hydration mismatch.
 */
export function StatBand({ tiles }: { tiles: StatTile[] }) {
  if (tiles.length === 0) {
    return null;
  }

  return (
    <div
      className="hidden gap-[var(--v2-space-6)] px-[var(--v2-gutter)] py-[var(--v2-space-8)] text-center md:grid"
      style={{ gridTemplateColumns: `repeat(${tiles.length}, 1fr)` }}
    >
      {tiles.map((tile) => (
        <div key={tile.key}>
          <div
            className={cn(
              'font-[family-name:var(--font-suse)] text-[54px] font-extrabold tracking-[-0.04em]',
              tile.tone === 'flagged' ? 'text-[var(--v2-flagged)]' : 'text-[var(--v2-ink)]',
            )}
          >
            {tile.value}
          </div>
          {/* The label is allowed to undercut the number — that is the point
              of the band. It always renders in ink-3, tile tone or not. */}
          <div className="mt-2 font-[family-name:var(--font-suse-mono)] text-[10.5px] uppercase tracking-[0.16em] text-[var(--v2-ink-3)]">
            {COPY.home.stats[tile.key]}
          </div>
        </div>
      ))}
    </div>
  );
}
