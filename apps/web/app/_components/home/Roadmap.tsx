'use client';

import { Fragment, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { cn } from '@/lib/cn.ts';
import { COPY } from '@/lib/copy.ts';

/**
 * The roadmap — design system screen 09.
 *
 * "progress is form · no state hue, because none of this is a verdict" is
 * said twice in the design system, and it is the whole reason this file
 * never reaches for any of the registry's state-hue tokens: a milestone
 * tinted sage would read as a clean verdict on something that does not
 * exist. Progress is carried by form alone, borrowed from the linkage
 * chain (screen 03) — filled is done, outlined is committed and not done,
 * dashes mean there is nothing to check yet — and `Marker` below derives
 * that form from `phase` so the two can never disagree.
 *
 * The design system's own markup auto-cycles the three views every 7s. That
 * is dropped here on purpose: this whole system's motion budget is "marquee
 * 36s · nothing else moves" (screen 03), and content that rotates itself
 * under a reader with no pause control fails WCAG 2.2.2. Three tabs,
 * switchable by clicking or by arrow key, no timer.
 */
const ROADMAP = COPY.home.roadmap;

type ViewKey = keyof typeof ROADMAP.views;
type ViewCopy = (typeof ROADMAP.views)[ViewKey];
type Milestone = ViewCopy['milestones'][number];

/**
 * Stated explicitly rather than derived as `Milestone['phase']`. COPY holds
 * no SHIPPED milestone right now — the two shipped items were retired — so
 * the derived type would narrow to `'BUILDING' | 'NEXT' | 'LATER'` and turn
 * `Marker`'s SHIPPED case below into dead code that no longer type-checks.
 * The four phases are a fact about the design system's marker legend
 * (screen 09), not about what COPY happens to hold today, so the type
 * names all four and keeps compiling whichever ones the data currently uses.
 */
type Phase = 'SHIPPED' | 'BUILDING' | 'NEXT' | 'LATER';

/** Render order — also the tab order. Matches the order `COPY` declares. */
const VIEW_KEYS: readonly ViewKey[] = ['timeline', 'adoption', 'scaling'];

/**
 * The marker. `filled` = SHIPPED, `outlined` = BUILDING/NEXT, the
 * dotted-circle glyph = LATER — the design system's own stand-in for
 * "dashes" (◌, U+25CC, reads as a dashed ring at this size). BUILDING's
 * outline is full ink and NEXT's is faint: both are still ink, never a hue,
 * so "closest to now" is legible without becoming a highlight — the design
 * system is explicit that the plan is not a progress bar.
 *
 * `aria-hidden`: the glyph is decoration. What actually tells a screen
 * reader "nothing to check yet" is the phase label rendered next to every
 * milestone ("LATER · NO DATE"), not this character — a dotted circle read
 * aloud as content would be noise, not information.
 */
function Marker({ phase }: { phase: Phase }) {
  switch (phase) {
    case 'SHIPPED':
      return <span aria-hidden="true" className="h-[7px] w-[7px] shrink-0 bg-[var(--v2-ink)]" />;
    case 'BUILDING':
      return (
        <span aria-hidden="true" className="h-[7px] w-[7px] shrink-0 border border-[var(--v2-ink)]" />
      );
    case 'NEXT':
      return (
        <span aria-hidden="true" className="h-[7px] w-[7px] shrink-0 border border-[var(--v2-faint)]" />
      );
    case 'LATER':
      return (
        <span
          aria-hidden="true"
          className="w-[7px] shrink-0 text-center font-[family-name:var(--font-suse-mono)] text-[11px] leading-none text-[var(--v2-faint)]"
        >
          ◌
        </span>
      );
  }
}

/**
 * The rail behind the mobile markers. It stops at the last milestone rather
 * than trailing into empty space — `null` for the final row means no
 * connector is rendered at all — and it turns to dashes the moment it is
 * heading into LATER, the same transition the marker itself makes.
 */
function railClass(milestones: readonly Milestone[], index: number): string | null {
  const next = milestones[index + 1];
  if (!next) return null;
  return next.phase === 'LATER'
    ? 'bg-[repeating-linear-gradient(to_bottom,var(--v2-faint)_0_3px,transparent_3px_7px)]'
    : 'bg-[var(--v2-line-2)]';
}

/**
 * One milestone, one component for both breakpoints — the two are the same
 * record read two ways, not two different layouts to keep in sync. Mobile:
 * one column, the rail runs behind the marker, title first then the mono
 * meta label under it ("a mono caps label never introduces a heading").
 * Desktop: a 132px meta column carries the date beside the marker instead,
 * and a row-top hairline replaces the rail as the separator.
 *
 * Nothing here is tappable — "a roadmap is a record, not a control" — so
 * there is no hover state, no cursor change, no handler.
 */
function MilestoneRow({ milestone, rail }: { milestone: Milestone; rail: string | null }) {
  return (
    <div className="grid grid-cols-[7px_minmax(0,1fr)] items-stretch gap-[17px] md:grid-cols-[132px_minmax(0,1fr)] md:items-start md:gap-[32px] md:border-t md:border-[var(--v2-line)] md:py-[22px]">
      <div className="flex flex-col items-center md:flex-row md:items-center md:gap-[11px]">
        <div className="pt-[7px] md:pt-0">
          <Marker phase={milestone.phase} />
        </div>
        {rail ? <span aria-hidden="true" className={cn('mt-[7px] w-px flex-1 md:hidden', rail)} /> : null}
        <span className="hidden font-[family-name:var(--font-suse-mono)] text-[10.5px] uppercase tracking-[0.12em] text-[var(--v2-ink-3)] md:inline">
          {milestone.when}
        </span>
      </div>

      <div className={cn('md:pb-0', rail ? 'pb-[26px]' : 'pb-0')}>
        <div className="text-[17px] leading-[1.25] font-semibold tracking-[-0.01em] text-[var(--v2-ink)] md:text-[24px] md:tracking-[-0.025em]">
          {milestone.title}
        </div>
        <div className="mt-[5px] font-[family-name:var(--font-suse-mono)] text-[10.5px] uppercase tracking-[0.12em] text-[var(--v2-ink-3)] md:hidden">
          {milestone.phase} · {milestone.when}
        </div>
        <p className="mt-[9px] text-[14.5px] leading-[1.55] text-[var(--v2-ink-2)] md:max-w-[52ch] md:text-[16px] md:leading-[1.6]">
          {milestone.body}
        </p>
      </div>
    </div>
  );
}


/**
 * One view's content: its own heading + one-line meta (never a count of
 * items — "which would read as a score"), the phase rail on `timeline`
 * only, then the milestones in the order `COPY` declares. Regrouping by tab
 * changes order and nothing else — no milestone gains, loses, or swaps a
 * marker by being read under a different view.
 */
function RoadmapView({ viewKey }: { viewKey: ViewKey }) {
  const view = ROADMAP.views[viewKey];

  return (
    <div>
      <div className="hidden items-baseline gap-[14px] md:flex">
        <h3 className="text-[28px] font-bold tracking-[-0.03em] text-[var(--v2-ink)]">{view.heading}</h3>
      </div>

      <div className="mt-[24px] flex flex-col md:mt-[22px] md:border-b md:border-[var(--v2-line)]">
        {view.milestones.map((m, i) => (
          <MilestoneRow key={m.title} milestone={m} rail={railClass(view.milestones, i)} />
        ))}
      </div>
    </div>
  );
}

/**
 * The tab strip is the registry's filter chip, reused verbatim — "a roadmap
 * view is a filter, so it looks like one" — rendered in v2 tokens rather
 * than imported, since `FilterChip` (`RegistryFilters.tsx`) is a v1
 * component on v1 tokens. Real tab semantics: `role="tablist"`/`"tab"` with
 * `aria-selected` + `aria-controls`, arrow keys move focus AND selection
 * (a roving tabindex), Home/End jump to the ends. Buttons, not links —
 * switching a view is not navigation.
 */
const PANEL_ID = 'roadmap-panel';

export function Roadmap() {
  const [active, setActive] = useState<ViewKey>('timeline');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const headingId = useId();

  function selectTab(index: number, focus: boolean) {
    const key = VIEW_KEYS[index];
    if (!key) return;
    setActive(key);
    if (focus) tabRefs.current[index]?.focus();
  }

  function onTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = VIEW_KEYS.length - 1;
    if (e.key === 'ArrowRight') selectTab(index === last ? 0 : index + 1, true);
    else if (e.key === 'ArrowLeft') selectTab(index === 0 ? last : index - 1, true);
    else if (e.key === 'Home') selectTab(0, true);
    else if (e.key === 'End') selectTab(last, true);
    else return;
    e.preventDefault();
  }

  return (
    <section className="px-[var(--v2-gutter-mobile)] py-[var(--v2-rhythm-mobile)] md:px-[var(--v2-gutter)] md:py-[var(--v2-space-9)]">
      {/*
        Centres the block, not the text. `Pipeline` — this section's neighbour
        immediately above — already caps at the site column and centres it
        this same way; without it, `Roadmap` was the one section on the page
        that stretched edge to edge at wide viewports while everything above
        it sat centred. Milestone titles, meta, and bodies stay left-aligned
        inside this wrapper: the design system calls the mono caps label a
        label, never a heading, and centring ~200-character prose bodies
        would fight the 52ch measure the system caps prose at for
        readability. The rail also runs behind markers assuming one
        consistent left edge, which a centred block preserves and a
        per-line text-centre would not.
      */}
      <div className="mx-auto max-w-[var(--v2-column)]">
        <h2 id={headingId} className="text-[32px] font-extrabold tracking-[-0.04em] text-[var(--v2-ink)] md:text-[44px]">
          {ROADMAP.title}
        </h2>
        {/* `flex-wrap` is the structural guarantee against horizontal scroll:
            three chips fit 390pt as measured (see the report handed back with
            this change), but a wrap is the backstop if that ever changes
            rather than an overflowing row. */}
        <div
          role="tablist"
          aria-labelledby={headingId}
          className="mt-[var(--v2-space-6)] flex flex-wrap items-stretch gap-[var(--v2-space-2)] border-b border-[var(--v2-line)] pb-[var(--v2-space-4)]"
        >
          {VIEW_KEYS.map((key, i) => {
            const view = ROADMAP.views[key];
            const isActive = key === active;
            return (
              <Fragment key={key}>
                <button
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`roadmap-tab-${key}`}
                  aria-selected={isActive}
                  /*
                    One stable id, not `roadmap-panel-${key}`. Only the active
                    panel is in the DOM, so a per-view id left two of the three
                    tabs pointing `aria-controls` at an element that does not
                    exist — assistive tech following that reference finds nothing.
                    A single panel whose content swaps is one element, so all three
                    tabs reference the one id that is always present.
                  */
                  aria-controls={PANEL_ID}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => selectTab(i, false)}
                  onKeyDown={(e) => onTabKeyDown(e, i)}
                  className={cn(
                    'border px-[15px] py-[14px] font-[family-name:var(--font-suse-mono)] text-[11.5px] tracking-[0.05em]',
                    isActive
                      ? 'border-[var(--v2-ink)] text-[var(--v2-ink)]'
                      : 'border-[var(--v2-border)] text-[var(--v2-ink-3)] hover:text-[var(--v2-ink-2)]',
                  )}
                >
                  {view.tab}
                </button>
                {/*
                  Screen 09 draws a pipe after the first tab only: `timeline` is
                  the whole plan ordered by commitment, `adoption` and `scaling`
                  are thematic slices of it, and the pipe marks that split. It is
                  a sibling of the mapped buttons, not one of them, so it never
                  lands in `tabRefs` and can't offset the roving-tabindex index
                  `i` that the click/keydown handlers above close over.
                  `aria-hidden` and unfocusable — a screen reader must not hear
                  "pipe" between two tabs — and outside anything with
                  `role="tab"`. Ink, not `--v2-faint`: that token is reserved for
                  borders and outlines, and a visible glyph is text.
                */}
                {i === 0 ? (
                  /*
                    A 1px rule spanning the row's full height, not a typed "|".
                    A glyph is sized by its font and sits on the text baseline,
                    so it never matched the chips it divides; a self-stretching
                    border does, at any tab height. `self-stretch` is what makes
                    it track the tallest chip in the row.
                  */
                  <span
                    aria-hidden="true"
                    className="mx-[var(--v2-space-2)] w-px self-stretch bg-[var(--v2-line-2)]"
                  />
                ) : null}
              </Fragment>
            );
          })}
        </div>

        <div
          key={active}
          role="tabpanel"
          id={PANEL_ID}
          aria-labelledby={`roadmap-tab-${active}`}
          tabIndex={0}
          className="mt-[var(--v2-space-6)] md:mt-[var(--v2-space-7)]"
        >
          <RoadmapView viewKey={active} />
        </div>
      </div>
    </section>
  );
}
