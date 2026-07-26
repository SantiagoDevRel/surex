import { cn } from '@/lib/cn.ts';
import { COPY } from '@/lib/copy.ts';
import type { StatTile } from '@/lib/home-data.ts';

/**
 * Never invents a tile — renders exactly what `homeStats()` derived. Grid is
 * `repeat(tiles.length, 1fr)`, not a fixed three columns, since `homeStats()`
 * can hand back one, two, or three tiles. `hidden md:grid` removes it from
 * mobile layout rather than shrinking it.
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
          <div className="mt-2 font-[family-name:var(--font-suse-mono)] text-[10.5px] uppercase tracking-[0.16em] text-[var(--v2-ink-3)]">
            {COPY.home.stats[tile.key]}
          </div>
        </div>
      ))}
    </div>
  );
}
