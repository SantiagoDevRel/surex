import { Fragment } from 'react';

import { cn } from '@/lib/cn.ts';
import { COPY } from '@/lib/copy.ts';
import {
  STAGE_TECH,
  railStages,
  shownStage,
  stageFacts,
  stageGatePassed,
  stagePhase,
  stageProvisional,
  type PipelineTrace,
  type StageFact,
  type StagePhase,
  type SubmissionStage,
  type SubmissionStatus,
} from '@/lib/submission.ts';

import { SectionLabel, Well } from './Panel.tsx';

/**
 * WHERE the run is, and what it is touching while it is there.
 *
 * The halftone beside this answers *how far*: density is `done / total`. It
 * cannot answer the question somebody watching their own submission is actually
 * asking — whose machine has my source open right now, what just got written,
 * and can I go and look at it. So this is one tile per stage, each naming the
 * technology that stage touches, and a link the moment the run reports an
 * identifier for it.
 *
 * ── the encoding ───────────────────────────────────────────────────────────
 * Colour in this product means VERDICT (`globals.css`: the three loud hues are
 * accents on state chips and the stamp, never decoration), so the reference this
 * layout follows — which colours tiles by kind — is adapted rather than copied.
 * Kind is carried by the BORDER, which is the grammar `Chip.tsx` already
 * established: solid for something measured, dashed for something we did not
 * measure ourselves, dotted for absence.
 *
 *   dotted        the run has not reached this stage
 *   solid accent  the stage the run is on now
 *   solid line    the run is past it
 *   dashed        reported, with something provisional about it — today that is
 *                 exactly one case: a Walrus blob a public publisher registered,
 *                 where the Sui object and any digest belong to them
 *   clean hue     a gate that answered and let the run through. The licence gate
 *                 is the one stage that can END a run, and when it refuses the
 *                 entry publishes as unreviewable — so the hue is a verdict here
 *                 rather than decoration, which is what makes it allowed
 *   flagged hue   the run stopped on this stage
 *
 * There is no "waiting on a human" tile, because there is no human step in this
 * pipeline. The human decision in SureX is the gate's `ask` on somebody else's
 * machine, and this screen has no knowledge of that.
 */

const DETAIL_ID = 'sx-stage-detail';

/** Tile face. Phase first; the two overrides below can replace it. */
const TILE: Record<StagePhase, string> = {
  pending: 'border-dotted border-line text-faint',
  active: 'border-accent bg-accent-t text-accent ring-2 ring-accent-t',
  done: 'border-line bg-panel-2 text-ink-2',
  stopped: 'border-flagged-l bg-flagged-t text-flagged',
};

/** The detail panel, tinted in the phase of the stage it is describing. */
const TONE: Record<StagePhase, { box: string; ink: string }> = {
  pending: { box: 'border-line bg-panel-2', ink: 'text-faint' },
  active: { box: 'border-accent bg-accent-t', ink: 'text-accent' },
  done: { box: 'border-line bg-panel-2', ink: 'text-ink-3' },
  stopped: { box: 'border-flagged-l bg-flagged-t', ink: 'text-flagged' },
};

const PHASE_WORD: Record<StagePhase, string> = {
  pending: COPY.pipeline.rail.phasePending,
  active: COPY.pipeline.rail.phaseActive,
  done: COPY.pipeline.rail.phaseDone,
  stopped: COPY.pipeline.rail.phaseStopped,
};

export function StageRail({
  status,
  trace,
  picked,
  onPick,
}: {
  status: SubmissionStatus | null;
  trace: PipelineTrace;
  /** A stage the reader chose. `null` means the panel follows the run. */
  picked: SubmissionStage | null;
  onPick: (stage: SubmissionStage) => void;
}) {
  const stages = railStages(trace);
  /**
   * The panel follows the run unless somebody picked a stage. With nothing
   * reported yet it describes the first stage — which is a true statement about
   * what will happen, and the phase line under it says "not reached" rather than
   * letting the panel imply the run has started. `shownStage` is in `lib` and
   * tested, because the first version of this line keyed on the ACTIVE stage and
   * a finished run has none.
   */
  const shown = shownStage(stages, picked, status);

  return (
    <section aria-label={COPY.pipeline.rail.label} className="grid gap-2.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <SectionLabel className="text-faint">{COPY.pipeline.rail.label}</SectionLabel>
        <span className="max-w-[80ch] text-mini text-faint">{COPY.pipeline.rail.legend}</span>
      </div>

      <Well className="px-3 py-3">
        <ol className="flex flex-col gap-1 md:flex-row md:items-start md:gap-0">
          {stages.map((stage, i) => (
            <Fragment key={stage}>
              {/* A rule, not an arrow: the stages are ordered, and an arrowhead
                  per gap would be seven arrowheads saying one thing. */}
              {i > 0 ? (
                <li
                  aria-hidden="true"
                  className="hidden shrink-0 border-t border-line md:mt-7 md:block md:w-3"
                />
              ) : null}
              <li className="md:min-w-0 md:flex-1">
                <StageTile
                  stage={stage}
                  index={i}
                  status={status}
                  trace={trace}
                  selected={stage === shown}
                  onPick={onPick}
                />
              </li>
            </Fragment>
          ))}
        </ol>
      </Well>

      {shown ? (
        <StageDetail stage={shown} status={status} trace={trace} following={picked === null} />
      ) : null}
    </section>
  );
}

function StageTile({
  stage,
  index,
  status,
  trace,
  selected,
  onPick,
}: {
  stage: SubmissionStage;
  index: number;
  status: SubmissionStatus | null;
  trace: PipelineTrace;
  selected: boolean;
  onPick: (stage: SubmissionStage) => void;
}) {
  const phase = stagePhase(stage, status);
  const tech = STAGE_TECH[stage];
  const face = stageGatePassed(stage, trace, status)
    ? 'border-clean-l bg-clean-t text-clean'
    : stageProvisional(stage, trace)
      ? cn(TILE[phase], 'border-dashed')
      : TILE[phase];

  return (
    <button
      type="button"
      onClick={() => onPick(stage)}
      aria-controls={DETAIL_ID}
      // `step` and not `true`: this is a position in an ordered process, which is
      // what the attribute's `step` token exists for.
      aria-current={phase === 'active' ? 'step' : undefined}
      className={cn(
        'flex w-full items-center gap-3 rounded-input px-2 py-1.5 text-left transition-colors duration-[140ms] ease-out',
        'md:flex-col md:items-center md:gap-1.5 md:px-1 md:text-center',
        selected ? 'bg-accent-t' : 'hover:bg-accent-t',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'grid h-14 w-14 shrink-0 place-items-center rounded-input border text-subject font-semibold',
          face,
        )}
      >
        {index + 1}
      </span>

      <span className="min-w-0 md:w-full">
        <span className="flex items-baseline justify-start gap-1 md:justify-center">
          <span className={cn('text-row font-semibold', phase === 'pending' ? 'text-faint' : 'text-ink')}>
            {COPY.pipeline.rail.name[stage]}
          </span>
          {/* The one moving thing in the rail, and it moves only on the stage the
              run is actually on. */}
          {phase === 'active' ? (
            <span aria-hidden="true" className="animate-blink text-accent">
              ▍
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-mini leading-snug text-faint">
          {COPY.pipeline.stage[stage]}
        </span>
        {tech ? (
          <span className="mt-1 block text-label uppercase tracking-[0.12em] text-ink-3">
            {COPY.pipeline.rail.tech[tech]}
          </span>
        ) : null}
        {/* The phase is styling everywhere else, so it is words here or it is
            nothing at all for a reader who cannot see the border. */}
        <span className="sr-only">{PHASE_WORD[phase]}</span>
      </span>
    </button>
  );
}

function StageDetail({
  stage,
  status,
  trace,
  following,
}: {
  stage: SubmissionStage;
  status: SubmissionStatus | null;
  trace: PipelineTrace;
  following: boolean;
}) {
  const phase = stagePhase(stage, status);
  const tone = TONE[phase];
  const tech = STAGE_TECH[stage];
  const facts = stageFacts(stage, trace, status);
  const copy = COPY.pipeline.rail.stage[stage];

  return (
    <div id={DETAIL_ID} className={cn('rounded-input border px-4 py-3.5', tone.box)}>
      <div className="grid gap-x-7 gap-y-3 md:grid-cols-[minmax(0,55fr)_minmax(0,45fr)]">
        <div>
          <p className="text-label uppercase tracking-[0.12em]">
            <span className={tone.ink}>{COPY.pipeline.rail.name[stage]}</span>
            {tech ? <span className="text-faint"> · {COPY.pipeline.rail.tech[tech]}</span> : null}
          </p>
          <p className="mt-1.5 text-data font-semibold text-ink">{copy.lede}</p>
          <p className="mt-1.5 max-w-[64ch] text-mini leading-relaxed text-ink-2">{copy.body}</p>
        </div>

        <div className="min-w-0">
          {facts.length ? (
            <ul className="grid gap-1.5">
              {facts.map((item) => (
                <FactRow key={item.label} fact={item} ink={tone.ink} />
              ))}
            </ul>
          ) : (
            /* No placeholder row and no ellipsis. A stage that reported nothing
               says so in words — the same rule the receipts follow. */
            <p className="max-w-[52ch] text-mini leading-relaxed text-faint">
              {COPY.pipeline.rail.nothingReported}
            </p>
          )}

          {/* Only when a name was actually rendered. The note explains why THAT
              row is not a link, so with no row it explains nothing and is one
              more sentence between a reader and the ids. */}
          {facts.some((f) => f.label === COPY.pipeline.rail.fact.ensName) ? (
            <p className="mt-2 text-mini text-faint">{COPY.pipeline.rail.ensAppNote}</p>
          ) : null}
        </div>
      </div>

      <p className="mt-3 border-t border-line-2 pt-2 text-mini text-faint">
        <span className={tone.ink}>{PHASE_WORD[phase]}</span>
        {' · '}
        {following ? COPY.pipeline.rail.following : COPY.pipeline.rail.picked}
      </p>
    </div>
  );
}

function FactRow({ fact, ink }: { fact: StageFact; ink: string }) {
  return (
    <li className="flex items-baseline gap-2">
      <span aria-hidden="true" className={cn('shrink-0 text-mini', ink)}>
        ▸
      </span>
      {/*
        `break-words` and not `break-all`, which is what ids elsewhere on the site
        use. These rows carry BOTH: a 44-character blob id that has to break
        somewhere, and a sentence about custody that must not. `break-all` split
        "object" across two lines the first time this rendered; `break-words`
        breaks a run only when it cannot fit, which is right for both.
      */}
      <span className="min-w-0 text-mini">
        <span className="text-faint">{fact.label} </span>
        {fact.href ? (
          <a
            href={fact.href}
            target="_blank"
            rel="noreferrer"
            className="break-words text-ink-2 underline decoration-line underline-offset-2 hover:text-ink"
          >
            {fact.value}
          </a>
        ) : (
          <span className="break-words text-ink-2">{fact.value}</span>
        )}
      </span>
    </li>
  );
}
