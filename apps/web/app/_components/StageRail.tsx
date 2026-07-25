import { Fragment } from 'react';

import { cn } from '@/lib/cn.ts';
import { COPY } from '@/lib/copy.ts';
import {
  FLOW_STAGES,
  FLOW_STEPS,
  FLOW_TECH,
  flowFacts,
  flowFocusStage,
  flowGatePassed,
  flowPhase,
  flowProvisional,
  flowSubStages,
  shownStep,
  stagePhase,
  type FlowStep,
  type PipelineTrace,
  type StageFact,
  type StagePhase,
  type StageTech,
  type SubmissionStage,
  type SubmissionStatus,
  type WorldCredential,
  type WorldPhase,
} from '@/lib/submission.ts';

import { SectionLabel, Well } from './Panel.tsx';

/**
 * THE FLOW. Six steps, in order, ticking as each one actually reports.
 *
 * This started as a rail of the pipeline's eight stages, mounted underneath the
 * form once a submission had been accepted — so the page read as a form and then,
 * separately, a progress log. It is one sequence: a person is checked, a release
 * is resolved, a model reads it, two records land, a name answers. So the World
 * step is step one of the same flow, before submission, and the whole thing is
 * the page rather than an appendix to it.
 *
 * ── what is folded, and what is not ────────────────────────────────────────
 * The four source stages (`resolving`, `licence`, `fetching`, `starting`) are one
 * step here, because they answer one question. The fold is presentational: the
 * panel names whichever of the four the run is on, `flowFacts` merges the facts
 * each stage reported rather than inventing any, and a stage this pipeline never
 * emits is still never drawn. See `lib/submission.ts`, "the flow".
 *
 * ── the encoding ───────────────────────────────────────────────────────────
 * Colour in this product means VERDICT (`globals.css`: the three loud hues are
 * accents on state chips and the stamp, never decoration), so kind is carried by
 * the BORDER — the grammar `Chip.tsx` established: solid for something measured,
 * dashed for something we did not measure ourselves, dotted for absence.
 *
 *   dotted        the flow has not reached this step
 *   solid accent  the step it is on now
 *   solid line    it is past it
 *   dashed        reported, with something provisional about it — today that is
 *                 exactly one case: a Walrus blob a public publisher registered,
 *                 where the Sui object and any digest belong to them
 *   clean hue     a gate that answered and let the run through. The licence gate
 *                 is the one thing that can END a run, and when it refuses the
 *                 entry publishes as unreviewable — so the hue is a verdict here
 *                 rather than decoration, which is what makes it allowed
 *   flagged hue   the flow stopped on this step
 *
 * The tick is a word as well as a glyph. The version of this screen the owner
 * threw out had a column of `◌` characters with no state behind them; a marker
 * that never changes is decoration, and decoration on a progress screen reads as
 * a claim. Every step here says where it is in words, and every word comes from
 * something reported.
 */

const DETAIL_ID = 'sx-step-detail';

/** Tile face. Phase first; the two overrides below can replace it. */
const TILE: Record<StagePhase, string> = {
  pending: 'border-dotted border-line text-faint',
  active: 'border-accent bg-accent-t text-accent ring-2 ring-accent-t',
  done: 'border-line bg-panel-2 text-ink-2',
  stopped: 'border-flagged-l bg-flagged-t text-flagged',
};

/** The detail panel, tinted in the phase of the step it is describing. */
const TONE: Record<StagePhase, { box: string; ink: string }> = {
  pending: { box: 'border-line bg-panel-2', ink: 'text-ink-3' },
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

/** The World step has no run to be "past", so it gets its own four words. */
const WORLD_WORD: Record<StagePhase, string> = {
  pending: COPY.pipeline.rail.flow.worldPhase.pending,
  active: COPY.pipeline.rail.flow.worldPhase.active,
  done: COPY.pipeline.rail.flow.worldPhase.done,
  stopped: COPY.pipeline.rail.flow.worldPhase.stopped,
};

function phaseWord(step: FlowStep, phase: StagePhase): string {
  return step === 'world' ? WORLD_WORD[phase] : PHASE_WORD[phase];
}

/* ---------------------------------------------------------------- the marks */

/**
 * The real mark of each technology, inlined.
 *
 * Inlined and not linked: a page that hotlinks someone's CDN for a logo makes a
 * request to them on every render, from every reader, and leaks who is looking at
 * a verdict. Every path below was taken from the project's own asset or from a
 * published brand collection, never drawn by hand — a wrong logo is worse than a
 * word, so anything unobtainable would have been a text chip instead. None was.
 *
 *   world   world.org/icons/worldcoin-orb-world-logo.svg — the orb, first path of
 *           the lockup; the wordmark beside it is dropped and the mark kept
 *   source  the GitHub mark (simple-icons `github`, CC0)
 *   dgx     the NVIDIA eye (simple-icons `nvidia`, CC0)
 *   walrus  docs.wal.app/img/logo.svg — Walrus's own mark
 *   arkiv   golem-project/brand/guidelines/assets/official/logo-pack/[ A ]/SVG —
 *           the official `[ A ]` mark, one of the three approved sources
 *   ens     the ENS mark (simple-icons `ens`, CC0)
 *
 * `currentColor` throughout, because these sit inside a tile whose colour is the
 * phase. Recolouring an official mark is normally a brand violation; a monochrome
 * rendition is the one form every one of these brands publishes itself.
 */
const MARK_BOX: Record<StageTech, string> = {
  world: 'h-[22px] w-[22px]',
  source: 'h-[22px] w-[22px]',
  dgx: 'h-[22px] w-[22px]',
  walrus: 'h-[18px] w-[27px]',
  arkiv: 'h-[16px] w-[28px]',
  ens: 'h-[22px] w-[22px]',
};

function TechMark({ tech }: { tech: StageTech }) {
  const shared = { fill: 'currentColor', 'aria-hidden': true as const, focusable: 'false' as const };
  const cls = MARK_BOX[tech];

  switch (tech) {
    case 'world':
      return (
        <svg {...shared} className={cls} viewBox="0 0 24 24">
          <path d="M12 24C9.83092 24 7.82536 23.4627 5.98665 22.3849C4.14794 21.3103 2.68966 19.8521 1.61513 18.0133C0.537264 16.1713 0 14.1691 0 12C0 9.83092 0.537264 7.82536 1.61513 5.98665C2.68966 4.14794 4.14794 2.68966 5.98665 1.61513C7.82536 0.537264 9.83092 0 12 0C14.1691 0 16.1746 0.537264 18.0133 1.61513C19.8521 2.69299 21.3103 4.14794 22.3849 5.98665C23.4594 7.82536 24 9.83092 24 12C24 14.1691 23.4627 16.1746 22.3849 18.0133C21.3103 19.8521 19.8521 21.3103 18.0133 22.3849C16.1746 23.4594 14.1691 24 12 24ZM1.01446 13.2747V10.7753H23.0089V13.2747H1.01446ZM12 21.4472C13.7019 21.4472 15.267 21.0267 16.6986 20.1858C18.1301 19.3448 19.2581 18.2002 20.0823 16.7486C20.9066 15.3003 21.317 13.7152 21.317 11.9967C21.317 10.2781 20.9032 8.69633 20.0823 7.24805C19.2581 5.79978 18.1301 4.65517 16.6986 3.8109C15.267 2.96997 13.7019 2.5495 12 2.5495C10.2981 2.5495 8.73304 2.96997 7.30145 3.8109C5.86985 4.65184 4.74194 5.79644 3.91769 7.24805C3.09344 8.69633 2.67964 10.2814 2.67964 11.9967C2.67964 13.7119 3.0901 15.297 3.91769 16.7486C4.74194 18.1969 5.86985 19.3415 7.30145 20.1858C8.73304 21.0267 10.2981 21.4472 12 21.4472ZM5.59622 12.1802V11.8665C5.59622 10.6352 5.88988 9.52058 6.48053 8.5228C7.07119 7.52503 7.89878 6.74082 8.96663 6.16685C10.0345 5.59288 11.2525 5.30923 12.624 5.30923H20.6663L21.7075 7.75528H12.6741C11.356 7.75528 10.2914 8.14238 9.48721 8.91324C8.67964 9.68409 8.27586 10.6685 8.27586 11.8665V12.1802C8.27586 13.3949 8.67964 14.3826 9.48721 15.1468C10.2948 15.911 11.356 16.2914 12.6741 16.2914H21.7075L20.6663 18.7375H12.624C11.2525 18.7375 10.0345 18.4505 8.96663 17.8799C7.89878 17.3059 7.07119 16.5217 6.48053 15.5239C5.88988 14.5261 5.59622 13.4116 5.59622 12.1802Z" />
        </svg>
      );
    case 'source':
      return (
        <svg {...shared} className={cls} viewBox="0 0 24 24">
          <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
        </svg>
      );
    case 'dgx':
      return (
        <svg {...shared} className={cls} viewBox="0 0 24 24">
          <path d="M8.948 8.798v-1.43a6.7 6.7 0 0 1 .424-.018c3.922-.124 6.493 3.374 6.493 3.374s-2.774 3.851-5.75 3.851c-.398 0-.787-.062-1.158-.185v-4.346c1.528.185 1.837.857 2.747 2.385l2.04-1.714s-1.492-1.952-4-1.952a6.016 6.016 0 0 0-.796.035m0-4.735v2.138l.424-.027c5.45-.185 9.01 4.47 9.01 4.47s-4.08 4.964-8.33 4.964c-.37 0-.733-.035-1.095-.097v1.325c.3.035.61.062.91.062 3.957 0 6.82-2.023 9.593-4.408.459.371 2.34 1.263 2.73 1.652-2.633 2.208-8.772 3.984-12.253 3.984-.335 0-.653-.018-.971-.053v1.864H24V4.063zm0 10.326v1.131c-3.657-.654-4.673-4.46-4.673-4.46s1.758-1.944 4.673-2.262v1.237H8.94c-1.528-.186-2.73 1.245-2.73 1.245s.68 2.412 2.739 3.11M2.456 10.9s2.164-3.197 6.5-3.533V6.201C4.153 6.59 0 10.653 0 10.653s2.35 6.802 8.948 7.42v-1.237c-4.84-.6-6.492-5.936-6.492-5.936z" />
        </svg>
      );
    case 'walrus':
      return (
        <svg {...shared} className={cls} viewBox="0 0 1417.32 931.26">
          <path d="M508.5,719.56L573.8,0h269.72s65.28,719.56,65.28,719.56l36.69,7.04C980.57,644.61,1077.41,355.64,1101.56,0h315.76s-243.49,931.26-243.49,931.26h-382.1s-64.22-465.63-64.22-465.63h-37.69s-64.22,465.63-64.22,465.63H243.49L0,0h315.76c24.16,355.64,120.99,644.61,156.07,726.61l36.67-7.04Z" />
        </svg>
      );
    case 'arkiv':
      return (
        <svg {...shared} className={cls} viewBox="0 0 388 218">
          <path d="M0 218V0H49.1603V32.9884H32.6204V185.012H49.1603V218H0Z" />
          <path d="M230.877 181.09L219.62 146.256H168.622L157.136 181.09H122.219V168.171L175.514 19.6085H214.337L267.862 168.171V181.09H230.877ZM194.351 68.9757L179.649 113.037H208.594L194.351 68.9757Z" />
          <path d="M387.701 0V218H338.54V185.012H355.08V32.9884H338.54V0H387.701Z" />
        </svg>
      );
    case 'ens':
      return (
        <svg {...shared} className={cls} viewBox="0 0 24 24">
          <path d="M11.725.223 5.107 11.13a.146.146 0 0 1-.237.018c-.583-.692-2.753-3.64-.067-6.327 2.45-2.452 5.572-4.2 6.73-4.804.13-.068.269.08.192.206m-.366 23.747c.132.093.295-.064.206-.2-1.478-2.251-6.392-9.744-7.07-10.869-.67-1.11-1.987-2.953-2.097-4.53-.011-.158-.228-.19-.283-.042a10 10 0 0 0-.27.85c-1.105 4.11.5 8.472 3.985 10.916zm.909-.193 6.618-10.907a.146.146 0 0 1 .237-.018c.582.692 2.753 3.64.067 6.327-2.45 2.452-5.572 4.2-6.73 4.804-.13.068-.269-.08-.192-.206M12.641.028c-.132-.093-.295.065-.206.2 1.478 2.252 6.392 9.745 7.07 10.87.67 1.109 1.987 2.952 2.097 4.53.011.157.228.19.283.041.088-.239.182-.524.27-.85 1.105-4.11-.5-8.472-3.985-10.915z" />
        </svg>
      );
  }
}

/* ----------------------------------------------------------------- the flow */

export function StageRail({
  status,
  trace,
  world,
  credential,
  picked,
  onPick,
}: {
  status: SubmissionStatus | null;
  trace: PipelineTrace;
  /** Where the World step is. It happens in this browser, so it cannot be polled. */
  world: WorldPhase;
  /** Known only once the server has answered with the request it signed. */
  credential: WorldCredential | null;
  /** A step the reader chose. `null` means the panel follows the flow. */
  picked: FlowStep | null;
  onPick: (step: FlowStep) => void;
}) {
  const shown = shownStep(picked, status);

  return (
    <section aria-label={COPY.pipeline.rail.label} className="grid gap-2.5">
      {/* The label alone, centred over the rail it names. The sentence that used
          to sit beside it described what the reader is about to watch happen —
          which the rail then does, one tile at a time. */}
      <div className="flex justify-center">
        <SectionLabel className="text-faint">{COPY.pipeline.rail.label}</SectionLabel>
      </div>

      <Well className="px-3 py-3">
        <ol className="flex flex-col gap-1 md:flex-row md:items-start md:gap-0">
          {FLOW_STEPS.map((step, i) => (
            <Fragment key={step}>
              {/* A rule, not an arrow: the steps are ordered, and an arrowhead per
                  gap would be five arrowheads saying one thing. */}
              {i > 0 ? (
                <li
                  aria-hidden="true"
                  className="hidden shrink-0 border-t border-line md:mt-7 md:block md:w-3"
                />
              ) : null}
              <li className="md:min-w-0 md:flex-1">
                <StepTile
                  step={step}
                  status={status}
                  trace={trace}
                  world={world}
                  selected={step === shown}
                  onPick={onPick}
                />
              </li>
            </Fragment>
          ))}
        </ol>
      </Well>

      <StepDetail
        step={shown}
        status={status}
        trace={trace}
        world={world}
        credential={credential}
        following={picked === null}
      />
    </section>
  );
}

function StepTile({
  step,
  status,
  trace,
  world,
  selected,
  onPick,
}: {
  step: FlowStep;
  status: SubmissionStatus | null;
  trace: PipelineTrace;
  world: WorldPhase;
  selected: boolean;
  onPick: (step: FlowStep) => void;
}) {
  const phase = flowPhase(step, status, world);
  const face = flowGatePassed(step, trace, status)
    ? 'border-clean-l bg-clean-t text-clean'
    : flowProvisional(step, trace)
      ? cn(TILE[phase], 'border-dashed')
      : TILE[phase];

  return (
    <button
      type="button"
      onClick={() => onPick(step)}
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
        className={cn(
          'grid h-14 w-14 shrink-0 place-items-center rounded-input border',
          face,
        )}
      >
        <TechMark tech={FLOW_TECH[step]} />
      </span>

      <span className="min-w-0 md:w-full">
        <span className="flex items-baseline justify-start gap-1 md:justify-center">
          <span
            /* `ink-3`, not `faint`, for a step that has not started.
               `faint` measured 4.32:1 on the dark surface — under AA for text —
               and the design system is explicit that faint is for borders and
               outlines, never type. A step nobody has reached still has to be
               readable; that is the whole point of showing six of them before
               anything happens. */
            className={cn('text-row font-semibold', phase === 'pending' ? 'text-ink-3' : 'text-ink')}
          >
            {COPY.pipeline.rail.flow.name[step]}
          </span>
          {/* The one moving thing in the flow, and it moves only on the step the
              run is actually on. */}
          {phase === 'active' ? (
            <span aria-hidden="true" className="animate-blink text-accent">
              ▍
            </span>
          ) : null}
        </span>
        {/* Same correction as the name above: this caption is type, at 4.32:1
            on dark under `faint`. It says what the step is for, which is the
            one line a first-time reader actually needs. */}
        <span className="mt-0.5 block text-mini leading-snug text-ink-3">
          {COPY.pipeline.rail.flow.caption[step]}
        </span>
        {/* The tick, in words. The border already carries the phase, but a border
            is not a statement — and this is the line the whole screen exists to
            move. */}
        <span className="mt-1 flex items-baseline justify-start gap-1 md:justify-center">
          {phase === 'done' ? (
            <span aria-hidden="true" className="text-mini text-clean">
              ✓
            </span>
          ) : null}
          <span
            className={cn(
              'text-label uppercase tracking-[0.1em]',
              phase === 'active'
                ? 'text-accent'
                : phase === 'stopped'
                  ? 'text-flagged'
                  : phase === 'done'
                    ? 'text-ink-3'
                    : 'text-faint',
            )}
          >
            {phaseWord(step, phase)}
          </span>
        </span>
      </span>
    </button>
  );
}

/** ✓ / ▍ / · / ✗ for a folded sub-stage. Same grammar as the tile, one line down. */
const SUB_GLYPH: Record<StagePhase, string> = {
  pending: '·',
  active: '▍',
  done: '✓',
  stopped: '✗',
};

const SUB_INK: Record<StagePhase, string> = {
  // `ink-3` rather than `faint`: this is the phase IN WORDS, and the comment on
  // the tick below says it exists because a border is not a statement. A
  // statement nobody can read is not one either — `faint` is 4.32:1 on dark.
  pending: 'text-ink-3',
  active: 'text-accent',
  done: 'text-ink-2',
  stopped: 'text-flagged',
};

function StepDetail({
  step,
  status,
  trace,
  world,
  credential,
  following,
}: {
  step: FlowStep;
  status: SubmissionStatus | null;
  trace: PipelineTrace;
  world: WorldPhase;
  credential: WorldCredential | null;
  following: boolean;
}) {
  const phase = flowPhase(step, status, world);
  const tone = TONE[phase];
  const tech = FLOW_TECH[step];
  const facts = flowFacts(step, trace, status);

  /**
   * What the panel says. The World step has copy of its own; every other step
   * borrows the copy of the STAGE the run is on inside it, so there is one
   * description per thing rather than a second vocabulary for the fold.
   */
  const focus = flowFocusStage(step, status, trace);
  const copy =
    step === 'world'
      ? COPY.pipeline.rail.flow.world
      : COPY.pipeline.rail.stage[focus ?? FLOW_STAGES[step][0]];

  /* Only worth listing when there is more than one — otherwise it restates the
     tile. Today that means the source step, and only the source step. */
  const subStages = flowSubStages(step, trace);

  return (
    <div id={DETAIL_ID} className={cn('rounded-input border px-4 py-3.5', tone.box)}>
      <div
        className={cn(
          'grid gap-x-7 gap-y-3',
          // The World step has no identifiers to put in a second column, and an
          // empty one would read as a column of things that failed to arrive.
          step === 'world' ? null : 'md:grid-cols-[minmax(0,55fr)_minmax(0,45fr)]',
        )}
      >
        <div>
          <p className="text-label uppercase tracking-[0.12em]">
            <span className={tone.ink}>{COPY.pipeline.rail.flow.name[step]}</span>
            <span className="text-faint"> · {COPY.pipeline.rail.tech[tech]}</span>
          </p>
          {/*
            The World step shows its TITLE and its claim, and no prose.

            It is the first thing on the page and it was spending two paragraphs
            on how the request is signed before the reader had seen the six
            steps — so the flow and the section under it did not fit on one
            screen, which is the whole reason the flow replaced an essay.

            `WorldClaim` below is not prose and does not go: it is the one line
            §5 requires, naming what the configured credential actually proves,
            with the long form behind its own disclosure. A step that asks for a
            biometric while saying nothing about what it establishes is the
            failure that rule exists to prevent.
          */}
          {step === 'world' ? null : (
            <>
              <p className="mt-1.5 text-data font-semibold text-ink">{copy.lede}</p>
              <p className="mt-1.5 max-w-[64ch] text-mini leading-relaxed text-ink-2">{copy.body}</p>
            </>
          )}

          {step === 'world' ? (
            <WorldClaim credential={credential} />
          ) : subStages.length > 1 ? (
            <SubStages stages={subStages} status={status} />
          ) : null}
        </div>

        {step === 'world' ? null : (
          <div className="min-w-0">
            {facts.length ? (
              <ul className="grid gap-1.5">
                {facts.map((item) => (
                  <FactRow key={item.label} fact={item} ink={tone.ink} />
                ))}
              </ul>
            ) : (
              /* No placeholder row and no ellipsis. A step that reported nothing
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
        )}
      </div>

      <p className="mt-3 border-t border-line-2 pt-2 text-mini text-faint">
        <span className={tone.ink}>{phaseWord(step, phase)}</span>
        {' · '}
        {following ? COPY.pipeline.rail.following : COPY.pipeline.rail.picked}
      </p>
    </div>
  );
}

/**
 * WHAT THE CREDENTIAL ACTUALLY PROVES — one line, always, with the rest one
 * disclosure away.
 *
 * AGENTS.md §5: the three credentials this app can request do not prove the same
 * thing, and the default (Selfie Check) is liveness whose sybil resistance World
 * itself rates "some". A screen that says nothing here is a screen where the
 * reader supplies the strongest bar they can imagine, so the claim is compressed
 * and never dropped. Before the server has answered, no credential is known — and
 * that is what it says, rather than naming the likely one.
 */
export function WorldClaim({ credential }: { credential: WorldCredential | null }) {
  if (!credential) {
    return <p className="mt-2.5 text-mini text-ink-3">{COPY.world.credentialUnknown}</p>;
  }
  const copy = COPY.world.credential[credential];
  return (
    <div className="mt-2.5">
      <p className="text-mini font-semibold text-ink-2">{copy.short}</p>
      <details className="mt-1">
        <summary className="cursor-pointer text-mini text-faint underline decoration-line underline-offset-2 hover:text-ink-3">
          {COPY.world.credentialWhy}
        </summary>
        <p className="mt-1.5 max-w-[64ch] text-mini leading-relaxed text-ink-3">{copy.body}</p>
      </details>
    </div>
  );
}

/** The stages folded into this step, each with the phase the run put it in. */
function SubStages({
  stages,
  status,
}: {
  stages: SubmissionStage[];
  status: SubmissionStatus | null;
}) {
  return (
    <p className="mt-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="text-label uppercase tracking-[0.12em] text-faint">
        {COPY.pipeline.rail.flow.subStagesLabel}
      </span>
      {stages.map((stage) => {
        const phase = stagePhase(stage, status);
        return (
          <span key={stage} className={cn('text-mini', SUB_INK[phase])}>
            <span aria-hidden="true">{SUB_GLYPH[phase]} </span>
            {COPY.pipeline.rail.name[stage]}
            <span className="sr-only"> — {PHASE_WORD[phase]}</span>
          </span>
        );
      })}
    </p>
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
