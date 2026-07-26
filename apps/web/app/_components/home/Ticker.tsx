import { cn } from '@/lib/cn.ts';
import { COPY } from '@/lib/copy.ts';
import type { TickerItem } from '@/lib/home-data.ts';
import type { RowStatus } from '@/lib/types.ts';

/**
 * The homepage ticker — design/website-kit screen 08: "the registry, live, as
 * atmosphere." State owns hue here exactly as it does everywhere else in the
 * v2 system; everything after the state word is muted ink-3, which is why
 * `TickerItem` keeps `state` as its own field instead of a pre-joined string.
 *
 * `running` has no entry: the design system is explicit that motion carries
 * that state, not colour, so an in-flight review reads in the same muted ink
 * as the rest of the line. Literal class strings, not template interpolation
 * — Tailwind only generates what it can see in the source.
 */
const STATE_HUE: Partial<Record<RowStatus, string>> = {
  clean: 'text-[var(--v2-clean)]',
  flagged: 'text-[var(--v2-flagged)]',
  disputed: 'text-[var(--v2-disputed)]',
  stale: 'text-[var(--v2-stale)]',
  unknown: 'text-[var(--v2-unknown)]',
  unreviewable: 'text-[var(--v2-unreviewable-ink)]',
};

/**
 * One ticker line. Tier is only printed when the row has one — `'—'` is the
 * contract's way of saying "no tier assigned," and printing "tier —" would
 * read as a typo instead of the absence it is (the same call `CustodyRow`
 * makes for a missing version).
 */
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

/**
 * One full pass of the ticker's content. Rendered twice by `Ticker` so the
 * `translateX(-50%)` loop is seamless; the second copy is `aria-hidden` so a
 * screen reader gets the list once, not twice. `hidden` here means
 * accessibility-hidden, not CSS-hidden — both copies are visible motion.
 */
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
 * The scrolling strip beneath the hero. Real rows only — the design system
 * calls a ticker of invented entries "the loudest lie on the page" — so an
 * empty registry renders nothing here rather than an empty bordered strip
 * pretending content is coming. The animation itself is `.sx-marquee` from
 * `globals.css` (36s linear, disabled under `prefers-reduced-motion`); this
 * component only supplies the content and the duplication.
 *
 * Dropped below `md` per screen 07 ("DROPPED ON MOBILE: the ticker · the
 * stat band") — `hidden md:block` removes it from layout rather than
 * shrinking it, so there is no reserved space and no hydration mismatch.
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
