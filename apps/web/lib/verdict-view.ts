/**
 * Head → what the stamp and the chain show. The decisions are `@surex/core`'s
 * (`confidenceOf()`, `tierSentence()`); this file only picks which locked
 * components render them, so the site and the gate can't drift.
 */

import { confidenceOf, tierSentence } from '@surex/core';

import { COPY } from './copy.ts';
import { isoDate } from './format.ts';
import type { Entry, RowStatus, Tier, VerdictHead } from './types.ts';

export type CounterTone = 'clean' | 'flagged' | 'disputed' | 'stale' | 'neutral' | 'muted';

export interface StampView {
  state: RowStatus;
  tier: Tier | '—';
  impression: string;
  counter?: string;
  counterTone: CounterTone;
  dashed?: boolean;
  superseded?: string;
}

const REASONS = COPY.reasons as Record<string, string>;

function impressionOf(head: VerdictHead, evidenceExpired: boolean): string {
  if (head.state === 'unknown') return COPY.stamp.notInRegistry;
  if (evidenceExpired) return COPY.stamp.counterEvidenceExpired;
  if (head.state === 'unreviewable') {
    const reason = REASONS[head.reason ?? ''] ?? 'the source could not be read';
    return reason.toUpperCase();
  }
  switch (head.tier) {
    case 'A':
      return COPY.stamp.tierA;
    case 'B':
      return COPY.stamp.tierB;
    case 'MISMATCH':
      return COPY.stamp.tierMismatch;
    default:
      return COPY.stamp.tierC;
  }
}

/**
 * The banner above a verdict, when the state needs one. Reason-aware: `unreviewable`
 * covers two unrelated situations — could not read this, vs. read it and not
 * publishing what was found — and one sentence can't honestly describe both.
 */
export function stateBanner(head: VerdictHead): { label: string; body: string } | null {
  if (head.state === 'stale') return { label: 'STALE', body: COPY.stateMeaning.stale };
  if (head.state !== 'unreviewable') return null;
  if (head.reason === 'withheld') {
    return { label: COPY.banners.withheldLabel, body: COPY.banners.withheldBody };
  }
  // One body per reason (see copy.ts); an unrecognised reason admits it doesn't know.
  const body = COPY.banners.unreviewableBody[head.reason ?? ''] ?? COPY.banners.unreviewableUnknownReason;
  return { label: COPY.banners.unreviewableLabel, body };
}

/**
 * The twenty-second sentence. Prefers what the reviewer actually said (rv-7's
 * `assessment`) over a sentence about what the state means — the assessment is
 * a fact about this server, the one a developer came for.
 */
export function summarySentence(head: VerdictHead, entry?: Entry | null): string {
  if (entry?.summary) return entry.summary;
  // Short form — the banner above already carries the full disclosure.
  if (head.reason === 'withheld') return COPY.banners.withheldShort;
  if (head.assessment) return head.assessment;
  // Reason-specific, short form: `COPY.reasons` is the one-clause version (the
  // banner above carries the full wording; repeating it here would duplicate it).
  if (head.state === 'unreviewable') {
    const clause = REASONS[head.reason ?? ''];
    return clause ? `No verdict: ${clause}.` : COPY.banners.unreviewableUnknownReason;
  }
  const meaning = (COPY.stateMeaning as Record<string, string | undefined>)[head.state];
  return meaning ?? COPY.stateMeaning.unknown;
}

/**
 * rv-7's `concern`, in words. Absent means "not stated", never "nothing found".
 * Suppressed for `none` (the label above reads WHAT KIND OF PROBLEM — showing it
 * for the common clean case would be noise) and for withheld entries (`concern`
 * names precisely the thing being withheld; this is the last line of defence
 * even though the writer already strips it).
 */
export function concernSentence(head: VerdictHead): string | null {
  if (!head.concern || head.concern === 'none') return null;
  if (head.reason === 'withheld') return null;
  return COPY.verdict.concerns[head.concern] ?? null;
}

export function evidenceExpiredOf(entry: Entry | null | undefined): boolean {
  const blob = entry?.source?.blob ?? entry?.head?.evidence;
  return blob?.retrievable === false;
}

export function stampView(head: VerdictHead, entry?: Entry | null): StampView {
  const expired = evidenceExpiredOf(entry);
  const confidence = confidenceOf(head) as 'disputed' | 'confirmed' | 'unconfirmed';

  let counter: string | undefined;
  let counterTone: CounterTone = 'muted';

  if (expired) {
    counter = COPY.stamp.counterEvidenceExpired;
    counterTone = 'stale';
  } else if (confidence === 'disputed') {
    counter = COPY.stamp.counterContested;
    counterTone = 'disputed';
  } else if (confidence === 'confirmed') {
    const since = isoDate(head.enforceAfter);
    counter = since
      ? `${COPY.stamp.counterUncontested} SINCE ${since}`
      : COPY.stamp.counterUncontested;
    counterTone = head.state === 'clean' ? 'clean' : 'neutral';
  }
  // The unconfirmed case deliberately sets no counter: the required disclosure
  // (AGENTS.md §4, automated/no human audit) already lives in the Provenance
  // panel as part of the record, and repeating it here would say it twice.

  return {
    state: head.state as RowStatus,
    tier: expired ? 'C' : ((head.tier ?? 'C') as Tier),
    impression: impressionOf(head, expired),
    counter,
    counterTone,
    dashed: expired || head.tier === 'C' || head.state === 'unknown',
    superseded: entry?.supersededBy ? COPY.stamp.superseded : undefined,
  };
}

/** The one sentence about what the tier promises. Straight from core. */
export function tierNote(head: VerdictHead, entry?: Entry | null): string {
  return entry?.tierNote ?? (tierSentence(head.tier) as string);
}
