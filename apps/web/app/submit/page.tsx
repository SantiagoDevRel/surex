import { COPY } from '@/lib/copy.ts';

import { Footer } from '../_components/Footer.tsx';
import { Panel, PanelHeader, SectionLabel } from '../_components/Panel.tsx';
import { SubmitForm } from '../_components/SubmitForm.tsx';

export const metadata = { title: COPY.submit.title };

/**
 * The maintainer path. Four gates down the left, the form and the consequences
 * on the right.
 *
 * The wording carries the whole deal, so it is on the page rather than in a
 * terms link: submission is consent to a public record, and the maintainer is
 * told first so a rebuttal can ship with the verdict from hour zero.
 */

const STEPS: { label: string; note: string; done: boolean }[] = [
  { label: COPY.submit.stepHuman, note: COPY.submit.stepHumanNote, done: false },
  { label: COPY.submit.stepRepo, note: COPY.submit.stepRepoNote, done: false },
  { label: COPY.submit.stepRelease, note: COPY.submit.stepReleaseNote, done: false },
  { label: COPY.submit.stepReview, note: COPY.submit.stepReviewNote, done: false },
];

const HAPPENS = [
  COPY.submit.whatHappens1,
  COPY.submit.whatHappens2,
  COPY.submit.whatHappens3,
  COPY.submit.whatHappens4,
];

const OUTCOMES = [
  { title: COPY.submit.answerTitle, body: COPY.submit.answerBody, lead: true },
  { title: COPY.submit.fixTitle, body: COPY.submit.fixBody, lead: false },
  { title: COPY.submit.leaveTitle, body: COPY.submit.leaveBody, lead: false },
];

export default function SubmitPage() {
  return (
    <main className="mx-auto max-w-[1020px] px-7 pb-20 pt-9">
      <h1 className="text-title font-semibold">{COPY.submit.title}</h1>
      <p className="mt-2 max-w-[80ch] font-serif text-prose-lg text-ink-2">{COPY.submit.lede}</p>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[250px_1fr]">
        <Panel className="py-1.5">
          {STEPS.map((step) => (
            <div
              key={step.label}
              className="flex items-baseline gap-3 border-b border-line-2 px-4 py-2.5 last:border-b-0"
            >
              <span
                className={step.done ? 'text-mini text-clean' : 'text-mini text-faint'}
                aria-hidden="true"
              >
                {step.done ? '✓' : '◌'}
              </span>
              <span>
                <span className="block text-row text-ink-2">{step.label}</span>
                <span className="mt-0.5 block text-label text-faint">{step.note}</span>
              </span>
            </div>
          ))}
        </Panel>

        <div className="grid gap-5">
          <SubmitForm />

          <Panel>
            <PanelHeader>
              <SectionLabel>{COPY.submit.whatHappensLabel}</SectionLabel>
            </PanelHeader>
            <ol className="grid gap-2.5 px-5 py-4">
              {HAPPENS.map((line, i) => (
                <li key={line} className="flex items-baseline gap-3.5">
                  <span className="w-4 shrink-0 text-mini text-faint">{i + 1}</span>
                  <span className="font-serif text-prose text-ink-2">{line}</span>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel>
            <PanelHeader>
              <SectionLabel>{COPY.submit.outcomeLabel}</SectionLabel>
            </PanelHeader>
            <div className="px-5 py-4">
              <p className="font-serif text-prose text-ink-2">{COPY.submit.outcomeBody}</p>

              <div className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <div className="text-row leading-relaxed text-ink-2">
                  <b className="text-ink">{COPY.submit.outcomeIsLabel}</b>
                  <br />
                  {COPY.submit.outcomeIs}
                </div>
                <div className="text-row leading-relaxed text-ink-2">
                  <b className="text-ink">{COPY.submit.outcomeIsNotLabel}</b>
                  <br />
                  {COPY.submit.outcomeIsNot}
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {OUTCOMES.map((outcome) => (
                  <div
                    key={outcome.title}
                    className={
                      outcome.lead
                        ? 'rounded-panel border border-accent bg-accent-t px-4 py-3.5'
                        : 'rounded-panel border border-line bg-panel px-4 py-3.5'
                    }
                  >
                    <div
                      className={
                        outcome.lead
                          ? 'text-data font-semibold text-accent'
                          : 'text-data font-semibold text-ink'
                      }
                    >
                      {outcome.title}
                    </div>
                    <p className="mt-1.5 text-mini leading-relaxed text-ink-3">{outcome.body}</p>
                  </div>
                ))}
              </div>

              <p className="mt-3.5 text-mini text-faint">{COPY.submit.windowNote}</p>
            </div>
          </Panel>
        </div>
      </div>

      <Footer />
    </main>
  );
}
