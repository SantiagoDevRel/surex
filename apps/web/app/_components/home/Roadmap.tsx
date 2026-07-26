'use client';

import { Fragment, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { cn } from '@/lib/cn.ts';
import { COPY } from '@/lib/copy.ts';

/**
 * The roadmap. Progress is carried by form alone (filled/outlined/dashed),
 * never a state hue — this isn't a verdict. `Marker` derives that form from
 * `phase` so the two can't disagree. Three tabs, switchable by click or
 * arrow key, no auto-rotation (a self-rotating tab with no pause fails
 * WCAG 2.2.2).
 */
const ROADMAP = COPY.home.roadmap;

type ViewKey = keyof typeof ROADMAP.views;
type ViewCopy = (typeof ROADMAP.views)[ViewKey];
type Milestone = ViewCopy['milestones'][number];

// Stated explicitly, not derived as `Milestone['phase']` — COPY currently
// holds no SHIPPED milestone, so a derived type would drop it and turn
// `Marker`'s SHIPPED case into dead code that no longer type-checks.
type Phase = 'SHIPPED' | 'BUILDING' | 'NEXT' | 'LATER';

/** Render order — also the tab order. Matches the order `COPY` declares. */
const VIEW_KEYS: readonly ViewKey[] = ['timeline', 'adoption', 'scaling'];

/**
 * `filled` = SHIPPED, `outlined` = BUILDING/NEXT, dotted-circle = LATER.
 * `aria-hidden`: the glyph is decoration — the phase label rendered next to
 * every milestone is what tells a screen reader the actual state.
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

/** The rail behind mobile markers; `null` on the final row renders no connector. */
function railClass(milestones: readonly Milestone[], index: number): string | null {
  const next = milestones[index + 1];
  if (!next) return null;
  return next.phase === 'LATER'
    ? 'bg-[repeating-linear-gradient(to_bottom,var(--v2-faint)_0_3px,transparent_3px_7px)]'
    : 'bg-[var(--v2-line-2)]';
}

/** One milestone, one component for both breakpoints. Nothing here is
 *  tappable — a roadmap is a record, not a control. */
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


/** One view's content, in the order `COPY` declares. Regrouping by tab
 *  changes order only — no milestone gains or loses a marker per view. */
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

// Real tab semantics: role="tablist"/"tab" with aria-selected + aria-controls,
// arrow keys move focus and selection together (roving tabindex), Home/End jump to ends.
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
      {/* Centres the block, not the text — titles/meta/bodies stay left-aligned. */}
      <div className="mx-auto max-w-[var(--v2-column)]">
        <h2 id={headingId} className="text-[32px] font-extrabold tracking-[-0.04em] text-[var(--v2-ink)] md:text-[44px]">
          {ROADMAP.title}
        </h2>
        {/* `flex-wrap` is the backstop against horizontal scroll if chips ever overflow. */}
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
                  // One stable id, not `roadmap-panel-${key}` — only the active
                  // panel is ever in the DOM, so a per-view id would leave two
                  // of three tabs pointing aria-controls at nothing.
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
                {/* Pipe after the first tab only, marking the split between
                    `timeline` and the two thematic views. It's a sibling of
                    the mapped buttons, not one of them, so it never lands in
                    `tabRefs` and can't offset the roving-tabindex index `i`. */}
                {i === 0 ? (
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
