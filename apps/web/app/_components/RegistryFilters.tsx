import Link from 'next/link';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn.ts';
import { COPY } from '@/lib/copy.ts';
import { DEFAULT_STATE, hiddenFromDefault, isDecided } from '@/lib/format.ts';
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

/**
 * A URL for the query, with the defaults left out.
 *
/**
 * The registry's own route. Every control on this screen is a link back to it
 * with different query parameters, so the path is written once — it used to be
 * `/`, and when the homepage took that route each of these controls silently
 * became a link off the registry entirely.
 */
const REGISTRY_PATH = '/registry';

/**
 * `state` is omitted at `DEFAULT_STATE`, not at `all` — the bare path is the
 * default view, so `?state=all` has to be written down. Getting this backwards
 * would make "show all" produce a link back to the filtered list.
 */
function href(query: RegistryQuery, patch: Partial<RegistryQuery>): string {
  const next = { ...query, ...patch };
  const params = new URLSearchParams();
  if (next.q) params.set('q', next.q);
  if (next.state !== DEFAULT_STATE) params.set('state', next.state);
  if (next.tier !== 'all') params.set('tier', next.tier);
  if (next.sort !== 'state') params.set('sort', next.sort);
  const s = params.toString();
  return s ? `${REGISTRY_PATH}?${s}` : REGISTRY_PATH;
}

/**
 * What the default view is not showing, said out loud, with the way back.
 *
 * Renders ONLY while the default view is the active one. Every other state
 * filter is something the reader clicked, and its chip is already lit — a second
 * announcement there would be noise. This one exists because the default filters
 * without being asked, and a filter nobody asked for has to declare itself or it
 * is just a shorter list with no explanation.
 *
 * The breakdown is per state (`25 unreviewable`, and `· 3 unknown` beside it if
 * there are any) rather than one lump, because "held back" covers three
 * different facts and the reader deserves to know which one applies.
 */
function HiddenNotice({ query, rows }: { query: RegistryQuery; rows: RegistryRow[] }) {
  const groups = hiddenFromDefault(rows);
  if (query.state !== DEFAULT_STATE || groups.length === 0) return null;

  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-mini text-faint">
      <span className="border border-dashed border-line px-1.5 text-nano uppercase text-ink-3">
        {COPY.browse.hiddenTag}
      </span>
      <span className="text-ink-2">
        {groups.map((g) => `${g.count} ${g.status}`).join(' · ')} {COPY.browse.hiddenSuffix}
      </span>
      <span aria-hidden="true">·</span>
      <Link
        href={href(query, { state: 'all' })}
        className="text-accent underline underline-offset-2"
      >
        {COPY.browse.hiddenShowAll} {rows.length}
      </Link>
      <p className="basis-full">{COPY.browse.hiddenWhy}</p>
    </div>
  );
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
      <form action={REGISTRY_PATH} method="get" className="flex flex-wrap items-center gap-2">
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
        {/* The active view has to survive a search, so it rides along as a hidden
            field whenever it is not the default one — including `all`, which is
            now a choice rather than the absence of one. */}
        {query.state !== DEFAULT_STATE ? (
          <input type="hidden" name="state" value={query.state} />
        ) : null}
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
        {/* The default view and the whole registry, adjacent and both counted, so
            the difference between them is arithmetic the reader can do at a
            glance rather than a claim they have to take. */}
        <FilterChip
          href={href(query, { state: DEFAULT_STATE })}
          active={query.state === DEFAULT_STATE}
        >
          {COPY.browse.viewDecided} {rows.filter((r) => isDecided(r.status)).length}
        </FilterChip>
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

      <HiddenNotice query={query} rows={rows} />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5">
        {/* The tier chips are gone with the tier column — filtering a list by a
            value every row shares is a control that can only ever return the
            list. `query.tier` is still parsed and still round-trips through the
            URL, so a bookmarked ?tier=A keeps working and nothing 404s. */}
        <FilterGroup label={COPY.browse.filterSort} lead>
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
