'use client';

import { useEffect, useState } from 'react';

import { COPY } from '@/lib/copy.ts';
import { humanDuration, isoMinute } from '@/lib/format.ts';
import {
  POLL_FAILURE_LIMIT,
  POLL_INTERVAL_MS,
  disagreementReported,
  entryHref,
  fetchSubmissionStatus,
  halftoneState,
  progressFraction,
  readingSource,
  readingsReported,
  shouldPoll,
  stageLabel,
  traceFrom,
  writeReceipts,
  type PipelineTrace,
  type SubmissionStatus,
} from '@/lib/submission.ts';

import { Banner, type BannerTone } from './Banner.tsx';
import { Panel, PanelHeader, SectionLabel } from './Panel.tsx';
import { Disagreement, Halftone, ReadingPulse, WriteLanded } from './PipelineMotion.tsx';

/**
 * The live loader: polls `GET /v1/submissions/:id` and renders the stage,
 * model, and identifiers the API named — nothing invented. Every value that
 * can be absent has a rendering for being absent.
 *
 * The watch itself (`useSubmissionWatch`) lives one level up in `SubmitForm`,
 * since the flow it feeds starts at the World step, before a submission
 * exists. This component only renders what the watch found.
 *
 * Motion is CSS (`app/globals.css`); this component only chooses what to
 * mount — halftone always, reading pulse while the model has the source
 * open, disagree only on a reported split, write once per landed write.
 */

export type Gap =
  | { kind: 'unknown' }
  | { kind: 'notBuilt'; detail?: string }
  | { kind: 'lost'; detail: string };

export interface SubmissionWatch {
  status: SubmissionStatus | null;
  trace: PipelineTrace;
  gap: Gap | null;
}

/** Poll one submission, or none. `id === null` is a first-class state, not an
 *  edge case — it reports no status/trace/gap rather than inventing a run. */
export function useSubmissionWatch(id: string | null): SubmissionWatch {
  const [status, setStatus] = useState<SubmissionStatus | null>(null);
  const [trace, setTrace] = useState<PipelineTrace>({});
  const [gap, setGap] = useState<Gap | null>(null);

  useEffect(() => {
    // A second submission starts a fresh watch — otherwise one run's trace
    // would show under another's id.
    setStatus(null);
    setTrace({});
    setGap(null);
    if (!id) return;
    const watching = id;

    // A timeout chain, not an interval — an interval fires whether or not the
    // previous request came back, producing overlapping polls out of order.
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let failures = 0;

    async function tick(): Promise<void> {
      const res = await fetchSubmissionStatus(watching, controller.signal);
      // Unmounted while the request was in flight: touch no state, set no timer.
      if (stopped) return;

      if (res.kind === 'ok') {
        failures = 0;
        setStatus(res.status);
        setTrace((prev) => traceFrom(prev, res.status));
        // Terminal — stop asking, or a done submission gets polled forever.
        if (!shouldPoll(res.status)) return;
      } else if (res.kind === 'unknown' || res.kind === 'notBuilt') {
        setGap(res.kind === 'unknown' ? { kind: 'unknown' } : { kind: 'notBuilt', detail: res.detail });
        return;
      } else {
        // A blip is not news, so the watch retries — but not forever: after
        // five consecutive failures it stops and says so.
        failures += 1;
        if (failures >= POLL_FAILURE_LIMIT) {
          setGap({ kind: 'lost', detail: res.detail });
          return;
        }
      }

      timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
    }

    void tick();

    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  return { status, trace, gap };
}

export function SubmissionMonitor({ id, status, trace, gap }: { id: string } & SubmissionWatch) {
  const fraction = progressFraction(status);
  const label = stageLabel(status);
  const receipts = writeReceipts(trace);
  const [readingA, readingB] = readingsReported(status);
  const href = entryHref(trace.fingerprint);

  const model = status?.reviewer?.model ?? trace.reviewing?.model ?? null;
  const promptVersion = status?.reviewer?.promptVersion ?? trace.reviewing?.promptVersion ?? null;
  const passes = status?.reviewer?.readings ?? null;
  const elapsed = humanDuration(status?.durationMs);
  const started = isoMinute(status?.startedAt);

  return (
    <Panel className="mt-3.5">
      <PanelHeader>
        <SectionLabel>{COPY.pipeline.label}</SectionLabel>
        <span className="text-mini text-faint">{id}</span>
      </PanelHeader>

      <div className="grid gap-4 px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <Halftone state={halftoneState(status)} fraction={fraction?.value ?? 0} />

          {/* Live region — the dots are aria-hidden, so this carries the state in words. */}
          <div role="status" aria-live="polite" className="min-w-0 grid gap-1">
            <span className="text-subject text-ink">
              {label ?? COPY.pipeline.nothingReported}
            </span>
            <span className="text-mini text-faint">
              {fraction?.from === 'reported'
                ? `${fraction.done} ${COPY.pipeline.unitsOf} ${fraction.total}`
                : fraction?.from === 'stage'
                  ? `${COPY.pipeline.stepOf} ${fraction.step} ${COPY.pipeline.unitsOf} ${fraction.steps}`
                  : null}
              {status?.status === 'queued' && typeof status.queuePosition === 'number'
                ? ` · ${COPY.pipeline.queuePosition} ${status.queuePosition}`
                : null}
            </span>
            {status?.detail ? (
              <span className="text-mini text-ink-3">{status.detail}</span>
            ) : null}
          </div>
        </div>

        {/* On screen exactly as long as the DGX is reading. */}
        {readingSource(status) ? (
          <ReadingPulse source={COPY.pipeline.readingSource} />
        ) : null}

        {disagreementReported(status) ? (
          <div className="grid gap-2.5">
            <Disagreement a={readingA} b={readingB} />
            <p className="max-w-[70ch] text-mini leading-relaxed text-ink-3">
              {COPY.pipeline.disagreeBody}
            </p>
          </div>
        ) : null}

        {/* One per write that landed. Keyed on the id, so each plays once. */}
        {receipts.length ? (
          <div className="grid gap-2.5">
            {receipts.map((receipt) => (
              <WriteLanded key={receipt.key} receipt={receipt} />
            ))}
          </div>
        ) : null}

        <RunProvenance
          model={model}
          promptVersion={promptVersion}
          passes={passes}
          elapsed={elapsed}
          started={started ? `${started.date} ${started.time}` : null}
        />

        {status?.status === 'done' ? (
          <div className="grid gap-2.5">
            <Banner tone="clean" label={COPY.pipeline.doneLabel}>
              {COPY.pipeline.doneBody}
            </Banner>
            {href ? (
              <a
                href={href}
                className="justify-self-start rounded-input border border-accent bg-accent-t px-3.5 py-2 text-row font-semibold text-accent"
              >
                {COPY.pipeline.entryAction}
              </a>
            ) : null}
          </div>
        ) : null}

        {status?.status === 'failed' ? (
          <Banner tone="flagged" label={COPY.pipeline.failedLabel}>
            {[COPY.pipeline.failedBody, status.error].filter(Boolean).join(' — ')}
          </Banner>
        ) : null}

        {status?.interrupted ? (
          <Banner tone="stale" label={COPY.pipeline.interruptedLabel}>
            {COPY.pipeline.interruptedBody}
          </Banner>
        ) : null}

        {gap ? <GapBanner gap={gap} /> : null}
      </div>
    </Panel>
  );
}

/** Who is doing the reading, named while it happens. An unset model is a real
 *  fact about the deployment, so it's reported as unset, not hidden. */
function RunProvenance({
  model,
  promptVersion,
  passes,
  elapsed,
  started,
}: {
  model: string | null;
  promptVersion: string | null;
  passes: string | null;
  elapsed: string | null;
  started: string | null;
}) {
  const fields: { label: string; value: string | null; absent?: string }[] = [
    { label: COPY.pipeline.modelLabel, value: model, absent: COPY.pipeline.modelAbsent },
    { label: COPY.pipeline.promptLabel, value: promptVersion },
    { label: COPY.pipeline.passesLabel, value: passes },
    elapsed
      ? { label: COPY.pipeline.elapsedLabel, value: elapsed }
      : { label: COPY.pipeline.startedLabel, value: started },
  ];

  return (
    <dl className="grid gap-x-8 gap-y-1 border-t border-line-2 pt-3 sm:grid-cols-2">
      {fields.map((field) => (
        <div key={field.label} className="flex items-baseline gap-3">
          <dt className="w-[68px] shrink-0 text-label uppercase tracking-[0.12em] text-faint">
            {field.label}
          </dt>
          {/* An absent field prints its absence, never falls back to something plausible. */}
          <dd className="min-w-0 break-all text-data text-ink-2">
            {field.value ?? (
              <span className="text-faint">
                {field.absent ?? COPY.verdict.provenanceUnknown}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The three ways the watch ends without the run ending. Kept distinct. */
function GapBanner({ gap }: { gap: Gap }) {
  const view: { tone: BannerTone; label: string; body: string } =
    gap.kind === 'unknown'
      ? { tone: 'stale', label: COPY.pipeline.unknownIdLabel, body: COPY.pipeline.unknownIdBody }
      : gap.kind === 'notBuilt'
        ? {
            tone: 'stale',
            label: COPY.pipeline.notBuiltLabel,
            body: [COPY.pipeline.notBuiltBody, gap.detail].filter(Boolean).join(' — '),
          }
        : {
            tone: 'neutral',
            label: COPY.pipeline.lostLabel,
            body: `${COPY.pipeline.lostBody} (${gap.detail})`,
          };

  return (
    <Banner tone={view.tone} label={view.label}>
      {view.body}
    </Banner>
  );
}
