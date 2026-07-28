import { SEVERITY_LABEL } from '@surex/core';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn.ts';
import { SEVERITY_CHIP, stateStyle } from '@/lib/state-styles.ts';
import type { RowStatus } from '@/lib/types.ts';

// Border style carries certainty independently of hue: solid for a state we
// measured, dashed for one we inferred, dotted for the absence of an entry.
const BORDER: Partial<Record<RowStatus, string>> = {
  stale: 'border-dashed',
  unreviewable: 'border-dashed',
  unknown: 'border-dotted border',
  running: 'border-dashed',
};

export function StateChip({
  state,
  children,
  className,
}: {
  state: RowStatus;
  children?: ReactNode;
  className?: string;
}) {
  const s = stateStyle(state);
  return (
    <span
      className={cn(
        'inline-block border-[1.5px] px-2 py-0.5 text-mini font-semibold uppercase tracking-[0.08em]',
        s.chip,
        BORDER[state],
        className,
      )}
    >
      {children ?? state}
    </span>
  );
}

/** The 0-4 → word map is the gate's, so a chip and a block message agree. */
const SEVERITY_WORD = SEVERITY_LABEL as Record<number, string>;

/** §07 severity — one hue family, weight steps. Never a colour of its own. */
export function SeverityChip({ severity, className }: { severity?: number; className?: string }) {
  const label = SEVERITY_WORD[severity ?? 0] ?? 'unknown';
  return (
    <span
      className={cn(
        'inline-block border px-2 py-0.5 text-mini font-semibold uppercase tracking-[0.08em]',
        SEVERITY_CHIP[label] ?? SEVERITY_CHIP.none,
        className,
      )}
    >
      {label}
    </span>
  );
}

/** A filter — accent, the one hue that never appears inside a verdict. */
export function FilterChip({
  href,
  active,
  children,
  tone,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
  /** Optional state hue, so `flagged` reads as flagged even in the filter bar. */
  tone?: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'rounded-chip border px-2.5 py-1 text-mini tracking-[0.05em] transition-colors duration-[140ms] ease-out',
        active
          ? cn('bg-accent-t', tone ?? 'border-accent text-accent')
          : 'border-line text-ink-3 hover:text-ink-2',
      )}
    >
      {children}
    </Link>
  );
}
