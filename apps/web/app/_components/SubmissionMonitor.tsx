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
 * The live loader: what the registry is actually doing with a submission, while
 * it does it.
 *
 * A review is minutes — the source is fetched, an open-source model reads it
 * twice (four times when the two readings split), a record goes to Walrus and an
 * entity goes to Arkiv. Before this the screen said "queued" and then nothing for
 * those minutes, which is the exact gap a UI fills with invention: a fake
 * percentage, a spinner that implies work nobody can see, a "processing…" that is
 * true of every state including failure.
 *
 * So: it polls `GET /v1/submissions/:id` and renders the stage the API named, the
 * model the API named, and the identifiers the API sent. Nothing else. Every
 * value that can be absent has a rendering for being absent, and none of those
 * renderings looks like a value.
 *
 * The motion is CSS (`app/globals.css`, SUREX MOTION v1) and this component only
 * chooses what to mount:
 *
 *   halftone   always — density is `done/total`, or how far through the named
 *              stages the reported stage sits, and the text says which
 *   reading    while the model has the source open
 *   disagree   only when the backend REPORTED a split (see disagreementReported)
 *   write      once per write that landed, keyed on the id it carries
 */

type Gap =
  | { kind: 'unknown' }
  | { kind: 'notBuilt'; detail?: string }
  | { kind: 'lost'; detail: string };

export function SubmissionMonitor({ id }: { id: string }) {
  const [status, setStatus] = useState<SubmissionStatus | null>(null);
  const [trace, setTrace] = useState<PipelineTrace>({});
  const [gap, setGap] = useState<Gap | null>(null);

  useEffect(() => {
    /**
     * A timeout chain rather than an interval: an interval fires whether or not
     * the previous request came back, so a slow registry produces overlapping
     * polls that arrive out of order. This one cannot.
     */
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let failures = 0;

    async function tick(): Promise<void> {
      const res = await fetchSubmissionStatus(id, controller.signal);
      // Unmounted while the request was in flight: touch no state, set no timer.
      if (stopped) return;

      if (res.kind === 'ok') {
        failures = 0;
        setStatus(res.status);
        setTrace((prev) => traceFrom(prev, res.status));
        // Terminal. Stop asking — a finished run does not change, and a page left
        // polling a done submission is a request every 1.8s forever.
        if (!shouldPoll(res.status)) return;
      } else if (res.kind === 'unknown' || res.kind === 'notBuilt') {
        setGap(res.kind === 'unknown' ? { kind: 'unknown' } : { kind: 'notBuilt', detail: res.detail });
        return;
      } else {
        /**
         * A blip is not news. A review runs for minutes and one failed request
         * says nothing about it, so the watch retries — but it does not retry
         * forever pretending everything is fine: after five consecutive failures
         * it stops and says the page no longer knows.
         */
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

          {/*
            The live region. The dots are aria-hidden and this is what a screen
            reader hears, so it has to carry the whole state in words — the stage,
            and where the number came from.
          */}
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

        {/*
          Mounted while the source is open and unmounted when it closes, which is
          the only thing that makes it honest: it is on screen exactly as long as
          the DGX is reading.
        */}
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

/**
 * Who is doing the reading, named while it happens.
 *
 * The verdict will carry the model id forever; someone watching it be produced
 * should see the same name rather than a spinner that could be hiding anything.
 * An unset model is a real fact about the deployment (`reviewerIdentity()` reads
 * the same env var the reviewer reads), so it is reported as unset.
 */
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
          {/*
            An absent field prints its absence. It never falls back to something
            plausible — the same rule the provenance panel on a verdict follows.
          */}
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
