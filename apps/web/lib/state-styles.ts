/**
 * State → Tailwind classes. A lookup table of literal class strings, not
 * template interpolation: Tailwind only generates what it can see in the
 * source, so `text-${state}` would compile to nothing.
 *
 * State owns hue; tier and confirmation own form. accent never appears in a
 * verdict. unknown/unreviewable use ink-3 — grey is the honest colour of
 * ignorance.
 */

import type { RowStatus } from './types.ts';

export interface StateStyle {
  /** the state word itself */
  text: string;
  /** 1px hairline in the state hue */
  border: string;
  /** the 55%-alpha line, for panel edges and chips */
  borderSoft: string;
  /** 13% tint fill */
  tint: string;
  /** solid fill, for connected chain segments and severity-high chips */
  fill: string;
  /** chips — 1.5px border, tint fill */
  chip: string;
  /** stamp — the 2px impression */
  stampBorder: string;
  /** stamp — tier A is double-struck: an inset ring inside the border */
  stampDouble: string;
  /** chain — asserted but unchecked: outlined, not filled */
  segmentOutline: string;
  /** chain — nothing to check: flowing dashes */
  segmentDash: string;
}

const style = (
  hue: string,
  classes: Omit<StateStyle, 'segmentDash'> & { segmentDash?: string },
): StateStyle => ({
  ...classes,
  segmentDash:
    classes.segmentDash ??
    `bg-[image:repeating-linear-gradient(90deg,var(${hue})_0_6px,transparent_6px_12px)]`,
});

export const STATE_STYLE: Record<RowStatus, StateStyle> = {
  clean: style('--sx-clean-l', {
    text: 'text-clean',
    border: 'border-clean',
    borderSoft: 'border-clean-l',
    tint: 'bg-clean-t',
    fill: 'bg-clean',
    chip: 'border-clean-l bg-clean-t text-clean',
    stampBorder: 'border-clean',
    stampDouble: 'shadow-[inset_0_0_0_3px_var(--sx-bg),inset_0_0_0_4px_var(--sx-clean)]',
    segmentOutline: 'border-clean-l',
  }),
  flagged: style('--sx-flagged-l', {
    text: 'text-flagged',
    border: 'border-flagged',
    borderSoft: 'border-flagged-l',
    tint: 'bg-flagged-t',
    fill: 'bg-flagged',
    chip: 'border-flagged-l bg-flagged-t text-flagged',
    stampBorder: 'border-flagged',
    stampDouble: 'shadow-[inset_0_0_0_3px_var(--sx-bg),inset_0_0_0_4px_var(--sx-flagged)]',
    segmentOutline: 'border-flagged-l',
  }),
  disputed: style('--sx-disputed-l', {
    text: 'text-disputed',
    border: 'border-disputed',
    borderSoft: 'border-disputed-l',
    tint: 'bg-disputed-t',
    fill: 'bg-disputed',
    chip: 'border-disputed-l bg-disputed-t text-disputed',
    stampBorder: 'border-disputed',
    stampDouble: 'shadow-[inset_0_0_0_3px_var(--sx-bg),inset_0_0_0_4px_var(--sx-disputed)]',
    segmentOutline: 'border-disputed-l',
  }),
  stale: style('--sx-stale-l', {
    text: 'text-stale',
    border: 'border-stale',
    borderSoft: 'border-stale-l',
    tint: 'bg-stale-t',
    fill: 'bg-stale',
    chip: 'border-stale-l bg-stale-t text-stale',
    stampBorder: 'border-stale',
    stampDouble: 'shadow-[inset_0_0_0_3px_var(--sx-bg),inset_0_0_0_4px_var(--sx-stale)]',
    segmentOutline: 'border-stale-l',
  }),
  // no reserved hue on purpose
  unreviewable: style('--sx-ink-3', {
    text: 'text-ink-3',
    border: 'border-ink-3',
    borderSoft: 'border-line',
    tint: 'bg-panel-2',
    fill: 'bg-ink-3',
    chip: 'border-line bg-transparent text-ink-3',
    stampBorder: 'border-ink-3',
    stampDouble: 'shadow-[inset_0_0_0_3px_var(--sx-bg),inset_0_0_0_4px_var(--sx-ink-3)]',
    segmentOutline: 'border-line',
  }),
  unknown: style('--sx-faint', {
    text: 'text-ink-3',
    border: 'border-faint',
    borderSoft: 'border-line-2',
    tint: 'bg-panel-2',
    fill: 'bg-faint',
    chip: 'border-faint bg-transparent text-ink-3',
    stampBorder: 'border-faint',
    stampDouble: '',
    segmentOutline: 'border-line-2',
  }),
  running: style('--sx-ink-3', {
    text: 'text-ink-2',
    border: 'border-line',
    borderSoft: 'border-line',
    tint: 'bg-panel-2',
    fill: 'bg-ink-3',
    chip: 'border-line bg-transparent text-ink-2',
    stampBorder: 'border-line',
    stampDouble: '',
    segmentOutline: 'border-line',
  }),
};

export function stateStyle(state: string | undefined): StateStyle {
  return STATE_STYLE[(state ?? 'unknown') as RowStatus] ?? STATE_STYLE.unknown;
}

/** severity — one hue family, weight steps. */
export const SEVERITY_CHIP: Record<string, string> = {
  critical: 'bg-flagged text-bg border-transparent',
  high: 'bg-flagged text-bg border-transparent',
  moderate: 'border-stale-l bg-stale-t text-stale',
  medium: 'border-stale-l bg-stale-t text-stale',
  low: 'border-line bg-transparent text-ink-2',
  none: 'border-line-2 bg-transparent text-faint',
};

/** The tone the standing column takes. Meaning, not decoration. */
export const STANDING_TONE: Record<string, string> = {
  neutral: 'text-ink-2',
  stale: 'text-stale',
  disputed: 'text-disputed',
};
