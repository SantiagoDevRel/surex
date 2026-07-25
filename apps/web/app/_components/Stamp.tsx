import { cn } from '@/lib/cn.ts';
import { stateStyle } from '@/lib/state-styles.ts';
import type { RowStatus, Tier } from '@/lib/types.ts';

/**
 * The verdict stamp. LOCKED — design/tokens.html §04, option 2b.
 *
 *   hero, one per page · tier is the impression:
 *     A double-struck (an inset ring inside the border)
 *     B single 2px
 *     C dashed
 *   rotation −2° · counter-stamp at +2°, overlapping bottom-right
 *   radius 0 — the only square-cornered thing in the system
 *
 * It slams in once on arrival and is a document from then on. The counter-stamp
 * carries confirmation, which is the part most products bury: an automated flag
 * says so on its face.
 */

export type CounterTone = 'clean' | 'flagged' | 'disputed' | 'stale' | 'neutral' | 'muted';

const COUNTER_TONE: Record<CounterTone, string> = {
  clean: 'border-solid border-clean text-clean',
  flagged: 'border-solid border-flagged text-flagged',
  disputed: 'border-solid border-disputed text-disputed',
  stale: 'border-dashed border-stale-l text-stale',
  neutral: 'border-solid border-ink-2 text-ink',
  // the automated-no-human-audit counter-stamp: dashed, deliberately unpretty
  muted: 'border-dashed border-ink-3 text-ink-2',
};

export function Stamp({
  state,
  tier,
  /** The line under the state word: what the tier means, in five words. */
  impression,
  /** The counter-stamp. Omit only when there is genuinely nothing to add. */
  counter,
  counterTone = 'muted',
  /** A superseded record: faded, with a diagonal overstamp. */
  superseded,
  /** Evidence lapsed → the impression is dashed regardless of tier. */
  dashed,
}: {
  state: RowStatus;
  tier?: Tier | '—';
  impression: string;
  counter?: string;
  counterTone?: CounterTone;
  superseded?: string;
  dashed?: boolean;
}) {
  const s = stateStyle(state);
  const doubleStruck = tier === 'A' && !dashed && s.stampDouble !== '';
  const isDashed = dashed || tier === 'C' || tier === '—' || tier === 'MISMATCH';

  return (
    <div className="relative inline-block">
      <div
        className={cn(
          'border-2 px-6 py-4',
          s.stampBorder,
          isDashed && 'border-dashed',
          doubleStruck && s.stampDouble,
          superseded ? 'rotate-[-2deg] opacity-40' : 'animate-stamp-in',
        )}
      >
        <div className={cn('text-stamp font-semibold tracking-[0.24em]', s.text)}>
          {state.toUpperCase()}
        </div>
        <div className="mt-1.5 text-nano uppercase text-ink-3">{impression}</div>
      </div>

      {counter ? (
        <div
          className={cn(
            'absolute -bottom-3 -right-4 animate-counter-in border bg-bg px-2 py-[3px] text-nano uppercase',
            COUNTER_TONE[counterTone],
          )}
        >
          {counter}
        </div>
      ) : null}

      {superseded ? (
        <div className="absolute left-[-12px] top-[36%] animate-counter-in border-2 border-ink-2 bg-bg px-3 py-1 text-row font-semibold uppercase tracking-[0.18em] text-ink rotate-[-8deg]">
          {superseded}
        </div>
      ) : null}
    </div>
  );
}
