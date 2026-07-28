import type { ReactNode } from 'react';

import { cn } from '@/lib/cn.ts';

// Panel colour at 80% opacity — measured to move every ink/panel pair by
// under 0.3:1, so the AA floor still holds. Wells stay opaque.
export function Panel({
  children,
  className,
  tone,
}: {
  children: ReactNode;
  className?: string;
  /** A panel edge in a state hue, when the panel *is* the claim. */
  tone?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-panel border bg-glass backdrop-blur-md',
        tone ?? 'border-line',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The hairline-separated head of a panel. */
export function PanelHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-5 py-3',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** §02 mono-label — 9px, +.16em, caps, ink-3. The eye scans these. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('text-label uppercase text-ink-3', className)}>{children}</span>
  );
}

/** A recessed surface: wells, code, terminals. panel-2, radius 4. */
export function Well({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-input border border-line bg-panel-2', className)}>{children}</div>
  );
}
