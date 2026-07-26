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

/**
 * The banner above a verdict, when the state needs one.
 *
 * Reason-aware, because `unreviewable` covers two situations that have nothing in
 * common: *we could not read this* and *we read it and are not publishing what we
 * found*. One sentence cannot honestly describe both, and the page was using the
 * first for both.
 */
export function stateBanner(head: VerdictHead): { label: string; body: string } | null {
  if (head.state === 'stale') return { label: 'STALE', body: COPY.stateMeaning.stale };
  if (head.state !== 'unreviewable') return null;
  if (head.reason === 'withheld') {
    return { label: COPY.banners.withheldLabel, body: COPY.banners.withheldBody };
  }
  // One body per reason. Composing a generic lede with a specific reason produced
  // banners whose two sentences contradicted each other — see the note in copy.ts.
  // An unrecognised reason gets a body that admits it does not know, rather than
  // the old default, which asserted the source could not be read.
  const body = COPY.banners.unreviewableBody[head.reason ?? ''] ?? COPY.banners.unreviewableUnknownReason;
  return { label: COPY.banners.unreviewableLabel, body };
}

/**
 * The twenty-second sentence.
 *
 * Prefers what the reviewer actually SAID (rv-7's `assessment`) over a sentence
 * about what the state means. A state sentence is a fact about the registry; an
 * assessment is a fact about this server, and it is the one a developer came for.
 */
export function summarySentence(head: VerdictHead, entry?: Entry | null): string {
  if (entry?.summary) return entry.summary;
  // The SHORT form. The banner directly above already carries the full disclosure,
  // and printing the same forty words twice on one screen turns a fact into
  // nagging — which is how a reader learns to skip it.
  if (head.reason === 'withheld') return COPY.banners.withheldShort;
  if (head.assessment) return head.assessment;
  // A reason-specific sentence beats a sentence about the state, for the same
  // reason the banner needed one: `unreviewable` covers "never read" and "read
  // twice, no agreement", and one sentence cannot honestly describe both.
  //
  // The SHORT form of it, though. The banner directly above carries the full
  // wording, and the first attempt at this returned the identical paragraph to
  // both surfaces — the duplication bug this page already had for `withheld`,
  // reintroduced for the other five reasons. `COPY.reasons` is the one-clause
  // version and already exists, because the stamp impression uses it.
  if (head.state === 'unreviewable') {
    const clause = REASONS[head.reason ?? ''];
    return clause ? `No verdict: ${clause}.` : COPY.banners.unreviewableUnknownReason;
  }
  const meaning = (COPY.stateMeaning as Record<string, string | undefined>)[head.state];
  return meaning ?? COPY.stateMeaning.unknown;
}

/**
 * rv-7's `concern`, in words. Absent means "not stated", never "nothing found".
 *
 * Two suppressions, both because the label above it reads WHAT KIND OF PROBLEM:
 *
 *   · `none` is what every clean verdict carries, so the line rendered
 *     "WHAT KIND OF PROBLEM — nothing found beyond what it says it does" on the
 *     most common good outcome. A label announcing a problem over a statement that
 *     there is none is not information, it is noise with a scary heading.
 *   · a withheld entry must not carry one at all. `concern` is one word naming
 *     what is wrong with somebody's server — precisely the thing being withheld —
 *     and while the writer strips it today, the view is the last line of defence
 *     and should not depend on the writer being correct.
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
  /**
   * The unconfirmed case deliberately sets NO counter.
   *
   * It used to stamp `AUTOMATED · NO HUMAN AUDIT` across the hero, and the
   * provenance panel said the same thing again in full a screen below. The
   * disclosure is required — AGENTS.md §4, every verdict states that it was
   * automated with no human audit — but it is required ONCE, and saying it twice
   * on one page turns a fact into nagging, which is how a reader learns to skip
   * it.
   *
   * It stays where `Provenance` puts it, for the reason that component gives:
   * it is part of the RECORD, not a disclaimer bolted to the top, so it belongs
   * in the panel carrying the commit, the blob, the model and the prompt version
   * that produced it. The other two counters survive because they say something
   * the provenance panel does not — that a window closed uncontested, or that a
   * rebuttal is on file.
   */

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
