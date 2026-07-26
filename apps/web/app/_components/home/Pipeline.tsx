import { COPY } from '@/lib/copy.ts';
import { cn } from '@/lib/cn.ts';

import { DISPUTES_ID, HOW_IT_WORKS_ID } from './SiteHeader.tsx';

/**
 * The pipeline — design system screen 12, "How it works". Six sealed steps,
 * in order, plus the dispute branch off step 05. This section owns the two
 * anchors `SiteHeader`'s nav points at: `how-it-works` (the section itself,
 * importable so the two never drift apart) and `disputes` (the branch block
 * below, exported by SiteHeader as `DISPUTES_ID`).
 */
const pipeline = COPY.home.pipeline;

type Step = (typeof pipeline.steps)[number];
type StepWithOutcomes = Extract<Step, { outcomes: readonly unknown[] }>;
type Outcome = StepWithOutcomes['outcomes'][number];

/**
 * The three gate outcomes are the one place this section uses a state hue —
 * they ARE the gate's three verdicts. Everything else in the grid (ordinals,
 * labels, the tier meter) stays ink and form only; see the note on `TierMeter`
 * and on step 04's chip below for why those two are not exceptions to that.
 */
const OUTCOME_DOT: Record<Outcome['state'], string> = {
  clean: 'bg-[var(--v2-clean)]',
  unknown: 'bg-[var(--v2-unknown)]',
  flagged: 'bg-[var(--v2-flagged)]',
};

/**
 * The dispute markers, styled by position rather than by content — the three
 * strings in `COPY.home.pipeline.dispute.markers` carry no style metadata of
 * their own, and the design draws them in a fixed order: standing checked
 * (plain), disputed with standing open (dashed, plum), superseded (plain).
 * That order is the content itself, not a rule this component invents.
 */
const DISPUTE_MARKER_STYLE = [
  'border-solid border-[var(--v2-border)] text-[var(--v2-ink-3)]',
  'border-dashed border-[var(--v2-border)] text-[var(--v2-disputed)]',
  'border-solid border-[var(--v2-border)] text-[var(--v2-ink-3)]',
] as const;


/**
 * The 3-cell tier meter (design system screen 03: 7×10px cells, 2px gaps,
 * never tinted by state — tier is a fact about linkage, not about the code).
 * `filled` is passed in rather than parsed from the tier label: the only tier
 * this section ever shows today is step 05's "TIER B" (two filled cells, one
 * outlined), and hand-parsing "TIER B" into a count for a value that never
 * varies would be complexity with nothing behind it. The label text already
 * says "TIER B" out loud, so the meter itself is decoration.
 */
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

/**
 * The content under a step's body — the one place the six steps genuinely
 * differ in shape (see the type note on `Step`). Narrowed with `in` checks
 * rather than coerced into one shape, per the brief: the asymmetry is the
 * data, not a gap to fill in.
 */
function StepChip({ step }: { step: Step }) {
  if ('outcomes' in step) {
    return (
      <div className="mt-[16px] flex flex-col gap-[10px] border border-[var(--v2-line)] bg-[var(--v2-well)] px-[13px] py-[12px] font-[family-name:var(--font-suse-mono)]">
        {step.outcomes.map((outcome) => (
          <div key={outcome.state} className="flex items-baseline gap-[8px]">
            <span aria-hidden="true" className={cn('h-[7px] w-[7px] shrink-0', OUTCOME_DOT[outcome.state])} />
            {/* The dot alone carries the verdict in the source design — color
                alone is not an accessible channel, so the verdict word rides
                along for anyone not reading it visually. */}
            <span className="sr-only">{COPY.states[outcome.state]}: </span>
            <span className="text-[13px] text-[var(--v2-ink)] md:text-[11.5px]">{outcome.gate}</span>
            <span className="text-[11px] text-[var(--v2-ink-3)]">{outcome.because}</span>
          </div>
        ))}
      </div>
    );
  }

  // Step 04's chip is the illustrative verdict itself — the one chip in this
  // grid that is a verdict rather than a fact about the pipeline, so it is
  // the one chip whose text takes a state hue. The box around it is the same
  // box every other step gets — same border, same fill, same padding, same
  // font size — because "state owns hue" means the ink changes, not the
  // frame. Keyed off the step's fixed index rather than its chip text, since
  // nothing in the COPY shape marks it and the six-step order is otherwise
  // constant.
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

/**
 * The six bodies run different lengths, so the chip below them lands at a
 * different height per step unless something pushes it back down to a
 * common edge. `h-full` lets the card take the grid row's full height (grid
 * items stretch to the tallest row member by default), and wrapping the
 * ghost/label/body in a `flex-1` block — rather than putting `mt-auto` on
 * the chip itself — means the 16px gap above the chip stays a real 16px on
 * every card, including whichever one is tallest: only the block above it
 * grows or shrinks to soak up the leftover space, so the chip's bottom edge
 * still lands on the same line across the row without ever touching the
 * paragraph above it.
 */
function StepCard({ step }: { step: Step }) {
  return (
    <div className="flex h-full flex-col bg-[var(--v2-panel)] px-[18px] pt-[20px] pb-[22px]">
      <div className="flex-1">
        {/* Decoration only — --v2-ghost is deliberately near-invisible against
            the page, and the step's own label two lines down is the accessible
            name. A screen reader has no reason to announce "zero one". */}
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

/**
 * `id` defaults to the same constant `SiteHeader` links `#how-it-works` to,
 * so the two can never quietly drift apart — mirrors how the section this
 * replaced (`Steps`) took its anchor id as a prop.
 */
export function Pipeline({ id = HOW_IT_WORKS_ID }: { id?: string }) {
  return (
    <section
      id={id}
      className="px-[var(--v2-gutter-mobile)] py-[var(--v2-rhythm-mobile)] md:px-[var(--v2-gutter)] md:py-[var(--v2-rhythm)]"
    >
      {/* Wider than the page's shared 860px column on purpose — this is the
          one section built as a row, and six steps read cramped inside the
          prose-width column the rest of the page uses. 1400px is a cap, not
          a target: it lets the row breathe up to a roomy desktop viewport
          without the cells stretching absurdly thin-content-in-wide-box at
          2560px and beyond. The heading and lede keep their own
          `--v2-prose` cap below, so widening the row doesn't widen them. */}
      <div className="mx-auto max-w-[1400px]">
        <div className="flex flex-wrap items-baseline gap-[20px]">
          <h2 className="text-[clamp(32px,6vw,44px)] font-extrabold tracking-[-0.04em] text-[var(--v2-ink)]">
            {pipeline.title}
          </h2>
        </div>

        {/* `repeat(auto-fit,minmax(210px,1fr))` is what makes this reflow to
            one column at 390px without a manual breakpoint: two 210px cells
            plus the 20px mobile gutters do not fit a 390pt viewport, so
            auto-fit drops to one column on its own. At 1440 the same rule
            resolves to six across, matching the design as drawn. Either way
            the grid never exceeds its container, so the page never scrolls
            sideways. The 1px gap on a `--v2-line` background is the seam
            between cells — a border, per "depth is a border, or nothing". */}
        <div className="mt-[2px] grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-px border border-[var(--v2-line)] bg-[var(--v2-line)]">
          {pipeline.steps.map((step) => (
            <StepCard key={step.index} step={step} />
          ))}
        </div>

        {/* The dispute branch. `repeat(auto-fit,minmax(260px,1fr))` gives the
            same guarantee as the grid above: two columns when there is room,
            one when there is not, never a horizontal scrollbar. This block
            carries `id={DISPUTES_ID}` — the second nav target `SiteHeader`
            points at. */}
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
