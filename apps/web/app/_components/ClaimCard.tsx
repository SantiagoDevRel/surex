import { cn } from '@/lib/cn.ts';
import { COPY } from '@/lib/copy.ts';
import type { Claim } from '@/lib/types.ts';

import { SeverityChip } from './Chip.tsx';
import { Panel, SectionLabel } from './Panel.tsx';

/** The accusation and the rebuttal, rendered by the same component — same
 *  size, same typeface, side by side. A rebuttal in smaller type would be
 *  the product quietly taking its own side. */
export function ClaimCard({
  claim,
  kind,
  badge,
}: {
  claim: Claim;
  kind: 'accusation' | 'rebuttal';
  badge?: string;
}) {
  const isRebuttal = kind === 'rebuttal';
  return (
    <Panel tone={isRebuttal ? 'border-disputed-l' : 'border-flagged-l'} className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <SectionLabel className={isRebuttal ? 'text-disputed' : undefined}>
          {isRebuttal ? COPY.verdict.rebuttalLabel : COPY.verdict.accusationLabel}
        </SectionLabel>
        {isRebuttal ? (
          badge ? (
            <span className="border border-disputed-l bg-disputed-t px-2 py-px text-micro font-semibold uppercase text-disputed">
              {badge}
            </span>
          ) : null
        ) : (
          <SeverityChip severity={claim.severity} />
        )}
        <span className="ml-auto text-micro text-faint">
          {isRebuttal ? 'contested' : 'automated'} · {claim.filedAt}
        </span>
      </div>

      <h3 className="mt-2.5 text-subject-lg font-semibold text-ink">{claim.title}</h3>
      <p className="mt-2 font-serif text-prose text-ink-2">{claim.body}</p>

      <div
        className={cn(
          'mt-3 grid gap-1 border-t border-line-2 pt-2.5 text-mini text-ink-3',
        )}
      >
        <span>
          {COPY.dispute.filedBy} · {claim.filedBy}
        </span>
        {claim.file ? (
          <span>
            {COPY.dispute.evidence} · {claim.file}
            {claim.evidence ? ` · blob ${claim.evidence}` : ''}
          </span>
        ) : null}
        {claim.standing ? (
          <span>
            {COPY.dispute.standing} · {claim.standing}
          </span>
        ) : null}
        {claim.onChain ? (
          <span>
            {COPY.dispute.onChain} · <span className="text-accent">{claim.onChain}</span>
          </span>
        ) : null}
      </div>
    </Panel>
  );
}
