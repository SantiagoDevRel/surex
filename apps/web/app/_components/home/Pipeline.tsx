import { COPY } from '@/lib/copy.ts';
import { cn } from '@/lib/cn.ts';

import { DISPUTES_ID, HOW_IT_WORKS_ID } from './SiteHeader.tsx';

/** Six sealed steps, in order, plus the dispute branch off step 05. Owns the
 *  two anchors `SiteHeader`'s nav points at. */
const pipeline = COPY.home.pipeline;

type Step = (typeof pipeline.steps)[number];
type StepWithOutcomes = Extract<Step, { outcomes: readonly unknown[] }>;
type Outcome = StepWithOutcomes['outcomes'][number];

// The one place this section uses a state hue — these dots ARE the gate's
// three verdicts. Everything else in the grid stays ink and form only.
const OUTCOME_DOT: Record<Outcome['state'], string> = {
  clean: 'bg-[var(--v2-clean)]',
  unknown: 'bg-[var(--v2-unknown)]',
  flagged: 'bg-[var(--v2-flagged)]',
};

// Styled by position, not content — the three markers are always in a fixed
// order: standing checked, disputed (dashed), superseded.
const DISPUTE_MARKER_STYLE = [
  'border-solid border-[var(--v2-border)] text-[var(--v2-ink-3)]',
  'border-dashed border-[var(--v2-border)] text-[var(--v2-disputed)]',
  'border-solid border-[var(--v2-border)] text-[var(--v2-ink-3)]',
] as const;


// 3-cell tier meter, never tinted by state — tier is a fact about linkage,
// not the code. `filled` is passed in rather than parsed from the label.
function TierMeter({ filled }: { filled: number }) {
  return (
    <span aria-hidden="true" className="flex items-center gap-[2px]">
      {[0, 1, 2].map((cell) =>
        cell < filled ? (
          <span key={cell} className="h-[10px] w-[7px] bg-[var(--v2-ink)]" />
        ) : (
          <span key={cell} className="h-[10px] w-[7px] border border-[var(--v2-faint)]" />
        ),
      )}
    </span>
  );
}

// The one place the six steps genuinely differ in shape; narrowed with `in`
// checks rather than coerced into one shape.
function StepChip({ step }: { step: Step }) {
  if ('outcomes' in step) {
    return (
      <div className="mt-[16px] flex flex-col gap-[10px] border border-[var(--v2-line)] bg-[var(--v2-well)] px-[13px] py-[12px] font-[family-name:var(--font-suse-mono)]">
        {step.outcomes.map((outcome) => (
          <div key={outcome.state} className="flex items-baseline gap-[8px]">
            <span aria-hidden="true" className={cn('h-[7px] w-[7px] shrink-0', OUTCOME_DOT[outcome.state])} />
            {/* Colour alone isn't an accessible channel — the verdict word rides along. */}
            <span className="sr-only">{COPY.states[outcome.state]}: </span>
            <span className="text-[13px] text-[var(--v2-ink)] md:text-[11.5px]">{outcome.gate}</span>
            <span className="text-[11px] text-[var(--v2-ink-3)]">{outcome.because}</span>
          </div>
        ))}
      </div>
    );
  }

  // Step 04's chip is the one whose text takes a state hue — everything else
  // about its box is identical to every other step's.
  return (
    <div className="mt-[16px] flex flex-col gap-[7px] border border-[var(--v2-line)] bg-[var(--v2-well)] px-[13px] py-[12px] font-[family-name:var(--font-suse-mono)]">
      {'chipLabel' in step ? (
        <div className="text-[9px] font-semibold tracking-[0.2em] text-[var(--v2-ink-3)]">{step.chipLabel}</div>
      ) : null}
      <div
        className={cn(
          'text-[13px] md:text-[11.5px]',
          step.index === '04' ? 'text-[var(--v2-clean)]' : 'text-[var(--v2-ink)]',
        )}
      >
        {step.chip}
      </div>
      {'tier' in step ? (
        <div className="mt-[3px] flex items-center gap-[9px]">
          <span className="text-[11px] tracking-[0.12em] text-[var(--v2-ink-3)]">{step.tier}</span>
          <TierMeter filled={2} />
        </div>
      ) : null}
    </div>
  );
}

// `h-full` + a `flex-1` wrapper around ghost/label/body lands every step's
// chip on a common bottom edge regardless of body length.
function StepCard({ step }: { step: Step }) {
  return (
    <div className="flex h-full flex-col bg-[var(--v2-panel)] px-[18px] pt-[20px] pb-[22px]">
      <div className="flex-1">
        {/* Decoration only — the step's label two lines down is the accessible name. */}
        <div
          aria-hidden="true"
          className="text-[32px] leading-none font-extrabold tracking-[-0.05em] text-[var(--v2-ghost)] md:text-[44px]"
        >
          {step.index}
        </div>
        <div className="mt-[10px] font-[family-name:var(--font-suse-mono)] text-[11.5px] font-semibold tracking-[0.16em] text-[var(--v2-ink)]">
          {step.label}
        </div>
        <p className="mt-[10px] text-[15px] leading-[1.55] text-[var(--v2-ink-2)]">{step.body}</p>
      </div>
      <StepChip step={step} />
    </div>
  );
}

/** `id` defaults to the same constant `SiteHeader` links `#how-it-works` to. */
export function Pipeline({ id = HOW_IT_WORKS_ID }: { id?: string }) {
  return (
    <section
      id={id}
      className="px-[var(--v2-gutter-mobile)] py-[var(--v2-rhythm-mobile)] md:px-[var(--v2-gutter)] md:py-[var(--v2-rhythm)]"
    >
      {/* Wider than the page's shared column on purpose — six steps read
          cramped in the prose-width column the rest of the page uses. */}
      <div className="mx-auto max-w-[1400px]">
        <div className="flex flex-wrap items-baseline gap-[20px]">
          <h2 className="text-[clamp(32px,6vw,44px)] font-extrabold tracking-[-0.04em] text-[var(--v2-ink)]">
            {pipeline.title}
          </h2>
        </div>

        {/* `auto-fit,minmax(210px,1fr)` reflows to one column on mobile and
            six across on desktop without a manual breakpoint. */}
        <div className="mt-[2px] grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-px border border-[var(--v2-line)] bg-[var(--v2-line)]">
          {pipeline.steps.map((step) => (
            <StepCard key={step.index} step={step} />
          ))}
        </div>

        {/* The dispute branch — carries `id={DISPUTES_ID}`, the second nav
            target `SiteHeader` points at. */}
        <div
          id={DISPUTES_ID}
          className="mt-[2px] grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] items-start gap-x-[32px] gap-y-[20px] border border-dashed border-[var(--v2-border)] px-[18px] py-[20px]"
        >
          <div>
            <div className="flex flex-wrap items-baseline gap-[12px]">
              <span className="font-[family-name:var(--font-suse-mono)] text-[11.5px] font-semibold tracking-[0.16em] text-[var(--v2-ink)]">
                {pipeline.dispute.label}
              </span>
              <span className="font-[family-name:var(--font-suse-mono)] text-[9px] font-semibold tracking-[0.2em] text-[var(--v2-ink-3)]">
                {pipeline.dispute.branch}
              </span>
            </div>
            <p className="mt-[10px] max-w-[var(--v2-prose)] text-[15px] leading-[1.55] text-[var(--v2-ink-2)]">
              {pipeline.dispute.body}
            </p>
          </div>
          <div className="flex flex-wrap gap-[8px] font-[family-name:var(--font-suse-mono)] text-[10.5px] tracking-[0.06em]">
            {pipeline.dispute.markers.map((marker, i) => (
              <span key={marker} className={cn('border px-[11px] py-[7px]', DISPUTE_MARKER_STYLE[i])}>
                {marker}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
