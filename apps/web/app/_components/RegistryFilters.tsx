import type { ReactNode } from 'react';

import { cn } from '@/lib/cn.ts';
import { COPY } from '@/lib/copy.ts';
import type { RegistryRow, RowStatus } from '@/lib/types.ts';

import { FilterChip } from './Chip.tsx';

/**
 * Filters as links and a plain GET form. No client JavaScript: the registry is
 * a table of facts, and a table of facts should survive with scripting off.
 */

export interface RegistryQuery {
  q: string;
  state: string;
  tier: string;
  sort: string;
}

const STATE_TONE: Partial<Record<RowStatus, string>> = {
  clean: 'border-clean-l text-clean',
  flagged: 'border-flagged-l text-flagged',
  disputed: 'border-disputed-l text-disputed',
  stale: 'border-stale-l text-stale',
  unreviewable: 'border-line text-ink-3',
  running: 'border-line text-ink-2',
};

const STATES: RowStatus[] = [
  'clean',
  'flagged',
  'disputed',
  'stale',
  'unreviewable',
  'running',
];

function href(query: RegistryQuery, patch: Partial<RegistryQuery>): string {
  const next = { ...query, ...patch };
  const params = new URLSearchParams();
  if (next.q) params.set('q', next.q);
  if (next.state !== 'all') params.set('state', next.state);
  if (next.tier !== 'all') params.set('tier', next.tier);
  if (next.sort !== 'state') params.set('sort', next.sort);
  const s = params.toString();
  return s ? `/?${s}` : '/';
}

/**
 * A filter group: its label and its own chips, and nothing else.
 *
 * One flex container per group, because the alternative — one long wrapping row
 * — lets the wrap fall between a label and the chips it names, which is how
 * `TIER` ended up stranded at the end of the STATE row with `all A B C` on the
 * line below. A label can no longer be separated from what it labels.
 *
 * `w-[44px]` on a leading label is the width of the longest of them at this
 * size, so the chips of STATE and TIER start at the same x.
 */
function FilterGroup({
  label,
  lead,
  children,
}: {
  label: string;
  /** True when this group starts a row, and its label sets the chip column. */
  lead?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <span
        className={cn('text-label tracking-[0.1em] text-faint', lead && 'w-[44px] shrink-0')}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

export function RegistryFilters({
  query,
  rows,
}: {
  query: RegistryQuery;
  /** Counts come from the rows on screen. Never a hardcoded total. */
  rows: RegistryRow[];
}) {
  const count = (status: RowStatus) => rows.filter((r) => r.status === status).length;

  return (
    <div className="mt-4 flex flex-col gap-2.5">
      <form action="/" method="get" className="flex flex-wrap items-center gap-2">
        <label htmlFor="q" className="sr-only">
          {COPY.browse.searchLabel}
        </label>
        <input
          id="q"
          name="q"
          defaultValue={query.q}
          placeholder={COPY.browse.searchPlaceholder}
          className="w-[280px] rounded-input border border-line bg-panel-2 px-3 py-2 text-data text-ink placeholder:text-faint"
        />
        {query.state !== 'all' ? <input type="hidden" name="state" value={query.state} /> : null}
        {query.tier !== 'all' ? <input type="hidden" name="tier" value={query.tier} /> : null}
        {query.sort !== 'state' ? <input type="hidden" name="sort" value={query.sort} /> : null}
        <button
          type="submit"
          className="rounded-input border border-accent bg-accent-t px-3 py-2 text-row font-semibold text-accent"
        >
          {COPY.browse.searchSubmit}
        </button>
      </form>

      <FilterGroup label={COPY.browse.filterState} lead>
        <FilterChip href={href(query, { state: 'all' })} active={query.state === 'all'}>
          {COPY.browse.all} {rows.length}
        </FilterChip>
        {STATES.map((state) => (
          <FilterChip
            key={state}
            href={href(query, { state })}
            active={query.state === state}
            tone={STATE_TONE[state]}
          >
            {state} {count(state)}
          </FilterChip>
        ))}
      </FilterGroup>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5">
        <FilterGroup label={COPY.browse.filterTier} lead>
          {['all', 'A', 'B', 'C'].map((tier) => (
            <FilterChip key={tier} href={href(query, { tier })} active={query.tier === tier}>
              {tier}
            </FilterChip>
          ))}
        </FilterGroup>

        <FilterGroup label={COPY.browse.filterSort}>
          <FilterChip href={href(query, { sort: 'state' })} active={query.sort === 'state'}>
            {COPY.browse.sortByState}
          </FilterChip>
          <FilterChip href={href(query, { sort: 'name' })} active={query.sort === 'name'}>
            {COPY.browse.sortByName}
          </FilterChip>
          <FilterChip href={href(query, { sort: 'recent' })} active={query.sort === 'recent'}>
            {COPY.browse.sortByRecent}
          </FilterChip>
        </FilterGroup>
      </div>
    </div>
  );
}
