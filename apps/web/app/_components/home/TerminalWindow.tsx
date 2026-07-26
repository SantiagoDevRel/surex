'use client';

/**
 * The gate's own output, quoted — one real block, walked end to end. Design
 * system screen 10 ("Terminal window") is explicit that this is a
 * transcript, not a live terminal: chrome bar, line roles, one caret, no
 * interactivity, no typing animation.
 *
 * One window, two surfaces: the `plugin` that asks before a call, and the
 * `ens` text records that hold the same verdict with no pixels. A tab strip
 * above the window switches which surface is shown. The design system's own markup auto-cycles the three —
 * that is dropped here on purpose, matching `Roadmap`: this system's motion
 * budget is "marquee 36s · nothing else moves" (screen 03), and content that
 * rotates itself under a reader with no pause control fails WCAG 2.2.2.
 * Three tabs, switchable by clicking or by arrow key, no timer.
 *
 * `<pre><code>` marks the transcript as a code sample rather than prose, and
 * the caret and status square — decoration that carries no text of their
 * own — are `aria-hidden`. The accessible name on `<pre>` reuses
 * `COPY.home.terminal.label` verbatim rather than inventing a new label
 * string with no key in `lib/copy.ts`.
 */
import { useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

import { COPY } from '@/lib/copy.ts';
import { cn } from '@/lib/cn.ts';
import type { VerdictState } from '@/lib/types.ts';

const terminal = COPY.home.terminal;

type SurfaceKey = keyof typeof terminal.tabs;

/** Render order — also the tab order. Matches the order `COPY` declares. */
const SURFACE_KEYS: readonly SurfaceKey[] = ['plugin', 'ens'];

/**
 * State owns hue everywhere in this system, and the terminal is no
 * exception — see `Pipeline`'s `OUTCOME_DOT` and `Ticker`'s `STATE_HUE` for
 * the same map shape. Each surface carries its own `state` field precisely
 * so the chrome square and the one coloured line can read it independently
 * rather than the window hardcoding a single verdict colour.
 */
const STATE_DOT: Record<VerdictState, string> = {
  clean: 'bg-[var(--v2-clean)]',
  flagged: 'bg-[var(--v2-flagged)]',
  disputed: 'bg-[var(--v2-disputed)]',
  stale: 'bg-[var(--v2-stale)]',
  unknown: 'bg-[var(--v2-unknown)]',
  unreviewable: 'bg-[var(--v2-unreviewable)]',
};

const STATE_TEXT: Record<VerdictState, string> = {
  clean: 'text-[var(--v2-clean)]',
  flagged: 'text-[var(--v2-flagged)]',
  disputed: 'text-[var(--v2-disputed)]',
  stale: 'text-[var(--v2-stale)]',
  unknown: 'text-[var(--v2-unknown)]',
  unreviewable: 'text-[var(--v2-unreviewable-ink)]',
};

/** The blinking block cursor — one per window, on the transcript's last line. */
function Cursor({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('sx-blink inline-block h-[15px] w-[8px] bg-[var(--v2-ink)] align-text-bottom', className)}
    />
  );
}

/**
 * The chrome bar. "Never a traffic light, never a round dot" — a 7px square
 * in the state hue of what the gate did, the source label, then elapsed
 * time right-aligned.
 */
function ChromeBar({ source, elapsed, state }: { source: string; elapsed: string; state: VerdictState }) {
  return (
    <div className="flex items-center gap-[10px] border-b border-[var(--v2-line-2)] px-[18px] py-[12px] text-[11px] text-[var(--v2-ink-3)]">
      <span aria-hidden="true" className={cn('h-[7px] w-[7px] shrink-0', STATE_DOT[state])} />
      <span>{source}</span>
      <span className="ml-auto">{elapsed}</span>
    </div>
  );
}

/**
 * The plugin transcript — six blocks: question · recommendation · finding
 * and capability · provenance and linkage · the way out · the command. One
 * blank line between blocks, never two — `mt-[13px]` on the first line of
 * each new block, nothing between lines that share one. It never says
 * blocked: the plugin asks, and an answer the reader did not give is not a
 * decision, so there is no choice UI here — no y/n, no arrow menu, no
 * default answer.
 */
function PluginTranscript() {
  const { state, lines } = terminal.plugin;
  return (
    <>
      <span className="block text-[var(--v2-ink)]">{lines.question}</span>
      <span className={cn('mt-[13px] block', STATE_TEXT[state])}>{lines.recommendation}</span>
      <span className="mt-[13px] block text-[var(--v2-ink)]">{lines.finding}</span>
      <span className="block text-[var(--v2-ink-2)]">{lines.capability}</span>
      <span className="mt-[13px] block text-[var(--v2-ink-3)]">{lines.provenance}</span>
      <span className="block text-[var(--v2-ink-3)]">{lines.linkage}</span>
      <span className="block text-[var(--v2-ink-3)]">{lines.evidence}</span>
      <span className="mt-[13px] block text-[var(--v2-ink-2)]">{lines.wayOut}</span>
      <span className="block pl-[2ch] text-[var(--v2-ink)]">
        {lines.command}
        <Cursor className="ml-[6px]" />
      </span>
    </>
  );
}

/**
 * The ENS transcript — the fully-qualified name, never abbreviated (the
 * fingerprint is the identity of the record, so it wraps rather than
 * eliding), then five text records as a two-column table with no rule: key
 * column ink-3 with a two-space indent, values left-aligned on one column.
 * The record flagged `isState` keeps the state hue on its value — "the
 * state word keeps its hue wherever it is rendered, including here." The
 * `url` record reads ink-2 rather than ink: it is only a way back to this
 * page, not part of the verdict.
 */
const ENS_URL_KEY = 'url';

function EnsTranscript() {
  const { name, records } = terminal.ens;
  return (
    <>
      <span className="block break-all text-[var(--v2-ink)]">{name}</span>
      <span className="mt-[9px] grid grid-cols-[150px_minmax(0,1fr)] gap-x-[12px]">
        {records.map((record) => (
          <span key={record.key} className="contents">
            <span className="pl-[2ch] text-[var(--v2-ink-3)]">{record.key}</span>
            <span
              className={cn(
                'break-all',
                'isState' in record && record.isState
                  ? STATE_TEXT[record.value as VerdictState]
                  : record.key === ENS_URL_KEY
                    ? 'text-[var(--v2-ink-2)]'
                    : 'text-[var(--v2-ink)]',
              )}
            >
              {record.value}
            </span>
          </span>
        ))}
      </span>
    </>
  );
}

const SURFACE: Record<SurfaceKey, ReactNode> = {
  plugin: <PluginTranscript />,
  ens: <EnsTranscript />,
};

/**
 * The tab strip is the registry's filter chip, reused — screen 10 and
 * screen 09 both say so, and `Roadmap` already renders that treatment in v2
 * tokens. Real tab semantics: `role="tablist"`/`"tab"` with `aria-selected`
 * + `aria-controls`, arrow keys move focus AND selection (a roving
 * tabindex), Home/End jump to the ends. Buttons, not links — switching a
 * surface is not navigation.
 *
 * One stable panel id, not `terminal-panel-${key}`: only the active panel
 * is in the DOM, so a per-surface id would leave two of the three tabs
 * pointing `aria-controls` at an element that does not exist.
 */
const PANEL_ID = 'terminal-panel';

export function TerminalWindow({ className }: { className?: string } = {}) {
  const [active, setActive] = useState<SurfaceKey>('plugin');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const instanceId = useId();

  function selectTab(index: number, focus: boolean) {
    const key = SURFACE_KEYS[index];
    if (!key) return;
    setActive(key);
    if (focus) tabRefs.current[index]?.focus();
  }

  function onTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = SURFACE_KEYS.length - 1;
    if (e.key === 'ArrowRight') selectTab(index === last ? 0 : index + 1, true);
    else if (e.key === 'ArrowLeft') selectTab(index === 0 ? last : index - 1, true);
    else if (e.key === 'Home') selectTab(0, true);
    else if (e.key === 'End') selectTab(last, true);
    else return;
    e.preventDefault();
  }

  const { source, elapsed, state } = terminal[active];

  return (
    /*
      This is the one section that bleeds past the page gutter — every sibling
      is inset 20px on mobile and this runs 0 to 390. That is deliberate: the
      design system says panels "go full-bleed to the gutter", and the extra
      width is what lets the longest transcript line wrap instead of scroll.
      But a panel touching both edges while five neighbours do not reads as
      mis-padding unless something states the intent, so the rules above and
      below make it a band — the same device the ticker already uses. Its own
      content keeps the gutter as inner padding.
    */
    <section
      aria-label={terminal.label}
      className={cn(
        'border-y border-[var(--v2-line)] px-[var(--v2-gutter-mobile)] py-[var(--v2-rhythm-mobile)] md:px-[var(--v2-gutter)] md:py-[var(--v2-rhythm)]',
        className,
      )}
    >
      <div
        role="tablist"
        aria-label={terminal.tabsLabel}
        className="flex flex-wrap items-center gap-[8px] border-b border-[var(--v2-line-2)] pb-[16px]"
      >
        {SURFACE_KEYS.map((key, i) => {
          const tab = terminal.tabs[key];
          const isActive = key === active;
          return (
            <button
              key={key}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`terminal-tab-${instanceId}-${key}`}
              aria-selected={isActive}
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
              {tab.tab}
            </button>
          );
        })}
      </div>

      <div
        key={active}
        role="tabpanel"
        id={PANEL_ID}
        aria-labelledby={`terminal-tab-${instanceId}-${active}`}
        tabIndex={0}
        className="border border-t-0 border-[var(--v2-line-2)] bg-[var(--v2-panel)] font-[family-name:var(--font-suse-mono)]"
      >
        <ChromeBar source={source} elapsed={elapsed} state={state} />

        <pre
          aria-label={terminal.label}
          className={cn(
            'overflow-x-hidden px-[24px] py-[22px] text-[13px] whitespace-pre-wrap break-words',
            active === 'plugin' ? 'leading-[1.95]' : 'leading-[2]',
          )}
        >
          <code>{SURFACE[active]}</code>
        </pre>
      </div>
    </section>
  );
}
