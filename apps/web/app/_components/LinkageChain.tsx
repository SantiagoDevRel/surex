import { cn } from '@/lib/cn.ts';
import { stateStyle } from '@/lib/state-styles.ts';
import type { RowStatus, Tier } from '@/lib/types.ts';

/**
 * The linkage chain. LOCKED as the PRIMARY tier display — design/tokens.html
 * §05, option 2c. Not decoration: this is how the tier is read.
 *
 * The tier is drawn as the bridge between the reviewed blob and the local
 * install, and **the missing segments are drawn as gaps**:
 *
 *   filled          → checked
 *   outlined        → asserted but unchecked
 *   flowing dashes  → nothing to check
 *
 * Hue is the state. The right-hand well tells the truth about the local side —
 * and the truth is often "we cannot see your machine", which is exactly what it
 * has to say.
 */

const SEGMENT = 'h-[9px] w-[46px] rounded-input mx-1 origin-left shrink-0';

/**
 * §03 — the chain draws with a ~250ms stagger. Expressed as three DURATIONS
 * rather than three delays: all segments start at t=0 and finish in sequence,
 * so none of them is ever held invisible by a delay + `both` fill-mode. The
 * chain is the tier display, and it has to be legible in a screenshot.
 */
const DRAW = [
  '[animation-duration:400ms]',
  '[animation-duration:650ms]',
  '[animation-duration:900ms]',
];

function Well({
  label,
  value,
  tone,
  dashed,
}: {
  label: string;
  value: string;
  tone: string;
  dashed?: boolean;
}) {
  return (
    <span
      className={cn(
        'shrink-0 border bg-panel-2 px-3 py-1.5 text-micro leading-relaxed text-ink-2',
        dashed ? 'border-dashed border-line' : 'border-line',
      )}
    >
      {label}
      <br />
      <span className={tone}>{value}</span>
    </span>
  );
}

const LOCAL_TONE = {
  clean: 'text-clean',
  stale: 'text-stale',
  unknown: 'text-faint',
} as const;

export function LinkageChain({
  state,
  tier,
  blobId,
  localText,
  localTone = 'unknown',
  note,
}: {
  state: RowStatus;
  tier: Tier | '—';
  blobId?: string;
  /** What the gate compared locally. Never a claim about the machine itself. */
  localText: string;
  localTone?: keyof typeof LOCAL_TONE;
  note?: string;
}) {
  const s = stateStyle(state);
  const connected = tier === 'A' ? 3 : tier === 'B' ? 2 : tier === 'C' ? 1 : 0;

  const segments = [0, 1, 2].map((i) => {
    // Tier A: three filled. Tier B: two filled, the third asserted only.
    if (i < connected && tier !== 'C') {
      return <span key={i} className={cn(SEGMENT, s.fill, 'animate-bar-draw', DRAW[i])} />;
    }
    if (tier === 'B' && i === 2) {
      return (
        <span
          key={i}
          className={cn(
            SEGMENT,
            'animate-bar-draw border-[1.5px] opacity-60',
            s.segmentOutline,
            DRAW[i],
          )}
        />
      );
    }
    if (tier === 'C') {
      // Nothing was checked: two flowing dashes, then an explicit break.
      if (i < 2) {
        return (
          <span
            key={i}
            className={cn(
              SEGMENT,
              s.segmentDash,
              'animate-dash-flow',
              i === 0 ? 'opacity-55' : 'opacity-30',
            )}
          />
        );
      }
      return (
        <span key={i} className={cn(SEGMENT, 'grid place-items-center text-mini text-faint')}>
          ✕
        </span>
      );
    }
    // MISMATCH, or a state with no chain at all: an open gap, drawn as one.
    return <span key={i} className={cn(SEGMENT, 'border border-dashed border-line-2')} />;
  });

  return (
    <div className="flex flex-wrap items-center gap-y-3">
      <Well label="REVIEWED BLOB" value={blobId ?? 'not recorded'} tone="text-faint" />
      {segments}
      <Well
        label="YOUR INSTALL"
        value={localText}
        tone={LOCAL_TONE[localTone]}
        dashed={localTone === 'unknown'}
      />
      <span className={cn('ml-4 text-subject font-semibold', s.text)}>{tier}</span>
      {note ? <span className="ml-3 max-w-[320px] text-mini text-ink-3">{note}</span> : null}
    </div>
  );
}
