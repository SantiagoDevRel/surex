import type { ReactNode } from 'react';

import { cn } from '@/lib/cn.ts';

/**
 * design/tokens.html §09 — awkward-state banners. Full-width, above the
 * content, never modal.
 *
 * A modal would make the reader dismiss the thing that explains what they are
 * looking at. These states are not interruptions; they are part of the record.
 */

export type BannerTone = 'stale' | 'neutral' | 'clean' | 'flagged' | 'disputed';

const TONE: Record<BannerTone, { box: string; label: string }> = {
  stale: { box: 'border-stale-l bg-stale-t', label: 'text-stale' },
  neutral: { box: 'border-line bg-panel-2', label: 'text-ink' },
  clean: { box: 'border-clean-l bg-clean-t', label: 'text-clean' },
  flagged: { box: 'border-flagged-l bg-flagged-t', label: 'text-flagged' },
  disputed: { box: 'border-disputed-l bg-disputed-t', label: 'text-disputed' },
};

export function Banner({
  tone = 'neutral',
  label,
  children,
  className,
}: {
  tone?: BannerTone;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const t = TONE[tone];
  return (
    <div
      className={cn(
        'animate-fade-up rounded-input border px-3.5 py-2.5 text-row text-ink-2',
        t.box,
        className,
      )}
    >
      <b className={cn('font-semibold', t.label)}>{label}</b> · {children}
    </div>
  );
}
