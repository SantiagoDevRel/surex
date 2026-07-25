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
 *
 * The impression is a halftone screen in the state hue, on its own aria-hidden
 * layer BEHIND the words — a stamp is ink pressed through a screen, and this is
 * the one element in the system where that reads as meaning rather than
 * decoration.
 *
 * ⚠️ 14% IS A MEASURED CEILING, not a taste call. Text over a pattern has to
 * clear AA against the pattern's WORST pixel, not its average, and the worst
 * pixel here is the centre of a dot in the brightest state hue (stale, on the
 * dark theme). At 14% that pixel gives the sub-line 6.2:1 and the state word
 * far more; at 20% the sub-line falls under 4.5:1. Raising it needs the same
 * arithmetic done again. The sub-line is `ink-2` rather than `ink-3` for the
 * same reason — it is the smallest type in the system and it sits on texture.
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
          'relative overflow-hidden border-2 bg-glass px-6 py-4 backdrop-blur-[3px]',
          s.stampBorder,
          isDashed && 'border-dashed',
          doubleStruck && s.stampDouble,
          superseded ? 'rotate-[-2deg] opacity-40' : 'animate-stamp-in',
        )}
      >
        <span
          aria-hidden="true"
          className={cn('halftone pointer-events-none absolute inset-0 opacity-[0.14]', s.text)}
        />
        <div className={cn('relative text-stamp font-semibold tracking-[0.24em]', s.text)}>
          {state.toUpperCase()}
        </div>
        <div className="relative mt-1.5 text-nano uppercase text-ink-2">{impression}</div>
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
