import { cn } from '@/lib/cn.ts';
import { COPY } from '@/lib/copy.ts';
import type { DisputeStatus } from '@/lib/types.ts';

// open → under_review → upheld | overturned. The terminal step keeps
// whichever label the outcome earned; the rebuttal stays on the page either way.
const ORDER: DisputeStatus[] = ['open', 'under_review', 'upheld'];

const LABEL: Record<DisputeStatus, string> = {
  open: COPY.dispute.stageOpen,
  under_review: COPY.dispute.stageReview,
  upheld: COPY.dispute.stageUpheld,
  overturned: COPY.dispute.stageOverturned,
};

export function DisputeTimeline({ status, note }: { status: DisputeStatus; note?: string }) {
  const terminal: DisputeStatus = status === 'overturned' ? 'overturned' : 'upheld';
  const steps: DisputeStatus[] = [ORDER[0], ORDER[1], terminal];
  const reachedIndex =
    status === 'open' ? 0 : status === 'under_review' ? 1 : 2;

  return (
    <div className="mt-5 flex flex-wrap items-center gap-y-2">
      {steps.map((step, i) => {
        const current = i === reachedIndex;
        const past = i < reachedIndex;
        return (
          <span key={step} className="flex items-center">
            <span
              className={cn(
                'rounded-chip border px-2.5 py-1 text-label uppercase tracking-[0.12em]',
                current
                  ? 'border-disputed-l bg-disputed-t text-disputed'
                  : past
                    ? 'border-line text-ink-2'
                    : 'border-line-2 text-faint',
              )}
            >
              {LABEL[step]}
            </span>
            {i < steps.length - 1 ? (
              <span className={cn('h-px w-[34px]', past ? 'bg-line' : 'bg-line-2')} />
            ) : null}
          </span>
        );
      })}
      {note ? <span className="ml-3 text-mini text-ink-3">{note}</span> : null}
    </div>
  );
}
