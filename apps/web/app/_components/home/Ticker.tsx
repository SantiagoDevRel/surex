import { cn } from '@/lib/cn.ts';
import { COPY } from '@/lib/copy.ts';
import type { TickerItem } from '@/lib/home-data.ts';
import type { RowStatus } from '@/lib/types.ts';

// `running` has no entry — motion carries that state, not colour. Literal
// class strings, not template interpolation — Tailwind only generates what
// it can see in the source.
const STATE_HUE: Partial<Record<RowStatus, string>> = {
  clean: 'text-[var(--v2-clean)]',
  flagged: 'text-[var(--v2-flagged)]',
  disputed: 'text-[var(--v2-disputed)]',
  stale: 'text-[var(--v2-stale)]',
  unknown: 'text-[var(--v2-unknown)]',
  unreviewable: 'text-[var(--v2-unreviewable-ink)]',
};

/** One ticker line. Tier is only printed when the row has one — `'—'` means
 *  "no tier assigned", and printing "tier —" would read as a typo. */
function TickerEntry({ item }: { item: TickerItem }) {
  return (
    <span className="whitespace-nowrap">
      <span className={cn('font-semibold', STATE_HUE[item.state])}>
        {COPY.states[item.state]}
      </span>{' '}
      {item.name} {item.version}
      {item.tier !== '—' ? (
        <>
          {' '}
          <span aria-hidden="true">·</span> tier {item.tier}
        </>
      ) : null}{' '}
      <span aria-hidden="true">·</span> {item.standing}
    </span>
  );
}

/** Rendered twice by `Ticker` so the `translateX(-50%)` loop is seamless; the
 *  second copy is `aria-hidden` so a screen reader gets the list once. */
function TickerPass({ items, duplicate }: { items: TickerItem[]; duplicate?: boolean }) {
  return (
    <span
      aria-hidden={duplicate ? 'true' : undefined}
      className="inline-flex shrink-0 gap-[var(--v2-space-6)] pr-[var(--v2-space-6)]"
    >
      {items.map((item, i) => (
        <TickerEntry key={`${duplicate ? 'dup' : 'real'}-${item.name}@${item.version}-${i}`} item={item} />
      ))}
    </span>
  );
}

/**
 * The scrolling strip beneath the hero. Real rows only — an empty registry
 * renders nothing here. The animation is `.sx-marquee` from `globals.css`
 * (36s linear, disabled under `prefers-reduced-motion`); this component only
 * supplies the content and duplication. `hidden md:block` removes it from
 * mobile layout rather than shrinking it.
 */
export function Ticker({ items }: { items: TickerItem[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        'hidden overflow-hidden whitespace-nowrap border-y border-[var(--v2-line)] py-[var(--v2-space-3)]',
        'font-[family-name:var(--font-suse-mono)] text-[12px] text-[var(--v2-ink-3)]',
        'md:block',
      )}
    >
      <div className="sx-marquee inline-flex">
        <TickerPass items={items} />
        <TickerPass items={items} duplicate />
      </div>
    </div>
  );
}
