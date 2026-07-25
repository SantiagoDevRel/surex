/**
 * Head → what the stamp and the chain show.
 *
 * The decisions are `@surex/core`'s: `confidenceOf()` picks which of the three
 * tones a verdict is delivered in, `tierSentence()` writes the one sentence
 * about what the tier promises. This file only chooses which of the locked
 * components render them, so the site and the gate cannot drift apart on the
 * question of what a verdict means.
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
  } else if (head.state !== 'unknown') {
    // Unconfirmed: an automated flag says so on its face.
    counter = COPY.stamp.counterAutomated;
    counterTone = 'muted';
  }

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
