/**
 * Reading `GET /v1/submissions/:id`, and deciding what a screen may say about it.
 *
 * A review is minutes, not seconds — a model reads the source twice, and four
 * times when the two readings disagree. The submit page used to show "queued"
 * and then nothing for those minutes, which is the state a screen is most likely
 * to fill with something it does not know. So everything the loader renders is
 * derived here, from the payload, by functions that can be tested without a
 * browser — and every one of them has a way to say *nothing was reported*.
 *
 * Three rules this file exists to keep:
 *
 *  1. **An absent field renders as absent.** No `??  'pending'`, no placeholder
 *     blob id, no invented model name. `null` travels all the way to the DOM and
 *     the component prints the absence.
 *  2. **A derived number says it is derived.** `progressFraction()` returns
 *     `from: 'reported'` when the API sent `done/total` and `from: 'stage'` when
 *     the density is just how far through the named stages the reported stage
 *     sits. The screen labels the two differently.
 *  3. **The disagreement panel is evidence, not decoration.** It mounts only on
 *     something the backend actually said — see `disagreementReported()`.
 *
 * No `@surex/core` import: this module is loaded by a client component, and core
 * reaches `node:crypto`. The link builders below are therefore a deliberate
 * second copy of `apps/api/src/links.mjs`, and `test/submission.test.mjs` reads
 * that file as text to prove the two have not drifted.
 */

import { apiBase } from './api-base.ts';
import { COPY } from './copy.ts';

/* --------------------------------------------------------------- the dots --*/

/**
 * The ordered-dither thresholds, 4 rows × 12 columns, copied verbatim from the
 * motion system. Each `<i>` in `.sx-halftone` takes one as `--t` and its column
 * index as `--c`; the CSS lights a dot when `--sx-p` crosses its threshold, so
 * density IS the progress number and there is no bar to fill.
 *
 * Fixed on purpose. Generating or shuffling these would make the dot pattern
 * change between renders, and a pattern that moves reads as noise rather than as
 * a quantity.
 */
export const SX_T = [
  0.010, 0.552, 0.177, 0.656, 0.031, 0.510, 0.135, 0.635, 0.052, 0.531, 0.156, 0.677,
  0.760, 0.281, 0.927, 0.385, 0.781, 0.260, 0.885, 0.406, 0.802, 0.302, 0.906, 0.427,
  0.198, 0.740, 0.094, 0.573, 0.240, 0.719, 0.115, 0.615, 0.219, 0.698, 0.073, 0.594,
  0.948, 0.469, 0.844, 0.365, 0.990, 0.490, 0.865, 0.344, 0.969, 0.448, 0.823, 0.323,
] as const;

/** Columns in the halftone grid — `grid-template-columns: repeat(12, 9px)`. */
export const SX_COLUMNS = 12;

/* ------------------------------------------------------------- the shapes --*/

/**
 * The pipeline, in the order it runs. This is the ONLY place the order is
 * written down, and it is what a stage-derived density is derived from.
 */
export const SUBMISSION_STAGES = [
  'resolving',
  'licence',
  'fetching',
  'starting',
  'reviewing',
  'walrus',
  'arkiv',
  'done',
] as const;

export type SubmissionStage = (typeof SUBMISSION_STAGES)[number];

/** Queue states. Distinct from a verdict state — a run in flight has no verdict. */
export type SubmissionState = 'queued' | 'running' | 'done' | 'failed';

export interface SubmissionProgress {
  stage: SubmissionStage;
  label?: string;
  done?: number;
  total?: number;
  detail?: Record<string, unknown>;
}

export interface SubmissionStatus {
  id: string;
  status: SubmissionState;
  queuePosition?: number;
  startedAt?: string;
  durationMs?: number;
  reviewer?: { model?: string; promptVersion?: string; readings?: string };
  /** The failing stage on a `failed` run, or the coarse stage on an older API. */
  stage?: string;
  detail?: string;
  interrupted?: boolean;
  error?: string;
  result?: Record<string, unknown>;
  progress?: SubmissionProgress;
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

function asStage(v: unknown): SubmissionStage | null {
  return typeof v === 'string' && (SUBMISSION_STAGES as readonly string[]).includes(v)
    ? (v as SubmissionStage)
    : null;
}

/**
 * Read the payload without assuming the API sent all of it.
 *
 * `progress` is the newer half of the agreed shape and an older deployment does
 * not send it; `stage`/`detail` are the older half and a newer one may only send
 * the nested form. Both are read, neither is required, and an unrecognised
 * `status` degrades to `queued` — the state that claims the least.
 */
export function parseSubmissionStatus(raw: unknown): SubmissionStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  const id = str(b.id);
  if (!id) return null;

  const state = str(b.status);
  const status: SubmissionState =
    state === 'running' || state === 'done' || state === 'failed' ? state : 'queued';

  const reviewerRaw = (b.reviewer ?? {}) as Record<string, unknown>;
  const reviewer = {
    model: str(reviewerRaw.model),
    promptVersion: str(reviewerRaw.promptVersion),
    readings: str(reviewerRaw.readings),
  };

  const progressRaw = (b.progress ?? null) as Record<string, unknown> | null;
  const progressStage = asStage(progressRaw?.stage);
  const progress: SubmissionProgress | undefined = progressStage
    ? {
        stage: progressStage,
        label: str(progressRaw?.label),
        done: num(progressRaw?.done),
        total: num(progressRaw?.total),
        detail:
          progressRaw?.detail && typeof progressRaw.detail === 'object'
            ? (progressRaw.detail as Record<string, unknown>)
            : undefined,
      }
    : undefined;

  return {
    id,
    status,
    queuePosition: num(b.queuePosition),
    startedAt: str(b.startedAt),
    durationMs: num(b.durationMs),
    reviewer:
      reviewer.model || reviewer.promptVersion || reviewer.readings ? reviewer : undefined,
    stage: str(b.stage),
    detail: str(b.detail),
    interrupted: b.interrupted === true,
    error: str(b.error) ?? str((b.error as Record<string, unknown> | undefined)?.message),
    result:
      b.result && typeof b.result === 'object' ? (b.result as Record<string, unknown>) : undefined,
    progress,
  };
}

/* ----------------------------------------------------------- what it says --*/

/** The stage the API named, nested form first. `null` when it named none. */
export function stageOf(status: SubmissionStatus | null): SubmissionStage | null {
  if (!status) return null;
  return status.progress?.stage ?? asStage(status.stage);
}

/**
 * The label for a stage. The API may send its own `progress.label`, and if it
 * does that one wins — it knows what it is doing and this table does not.
 */
export function stageLabel(status: SubmissionStatus | null): string | null {
  const own = status?.progress?.label;
  if (own) return own;
  const stage = stageOf(status);
  return stage ? COPY.pipeline.stage[stage] : null;
}

export interface ProgressFraction {
  /** 0..1, for `--sx-p`. */
  value: number;
  /**
   * `reported` — the API sent `done` and `total`, and this is their ratio.
   * `stage`    — it did not, and this is how far through the named stages the
   *              stage it DID report sits. The screen must label these
   *              differently; they are not the same claim.
   */
  from: 'reported' | 'stage';
  /** Present only when `from === 'reported'`. */
  done?: number;
  total?: number;
  /** Present only when `from === 'stage'`. 1-based, for "step 5 of 8". */
  step?: number;
  steps?: number;
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * How full the halftone is. `null` when the API reported neither a count nor a
 * stage — in which case the dots stay at zero and the screen says the run has
 * not reported anything yet, rather than showing a number nobody sent.
 */
export function progressFraction(status: SubmissionStatus | null): ProgressFraction | null {
  if (!status) return null;

  const { done, total } = status.progress ?? {};
  if (typeof done === 'number' && typeof total === 'number' && total > 0) {
    return { value: clamp01(done / total), from: 'reported', done, total };
  }

  // A finished run is full whatever it reported on the way: `done` is the last
  // stage, and the terminal state is itself the count.
  if (status.status === 'done') {
    return { value: 1, from: 'stage', step: SUBMISSION_STAGES.length, steps: SUBMISSION_STAGES.length };
  }

  const stage = stageOf(status);
  if (!stage) return null;
  const step = SUBMISSION_STAGES.indexOf(stage) + 1;
  return { value: clamp01(step / SUBMISSION_STAGES.length), from: 'stage', step, steps: SUBMISSION_STAGES.length };
}

/**
 * Which halftone state class the dots wear.
 *
 * `failed` is deliberately NOT `is-idle`: the idle class breathes, and a
 * breathing field of dots on a run that has stopped reads as still working. The
 * bare class is the static, settled render — the density it reached, held.
 */
export type HalftoneState = 'idle' | 'working' | 'done' | 'static';

export function halftoneState(status: SubmissionStatus | null): HalftoneState {
  if (!status) return 'idle';
  if (status.status === 'done') return 'done';
  if (status.status === 'failed') return 'static';
  if (status.status === 'running') return 'working';
  return 'idle';
}

export function halftoneClass(state: HalftoneState): string {
  switch (state) {
    case 'working':
      return 'sx-halftone is-working';
    case 'done':
      return 'sx-halftone is-done';
    case 'idle':
      return 'sx-halftone is-idle';
    default:
      return 'sx-halftone';
  }
}

/** The DGX has the source open. Only true while the model is actually reading. */
export function readingSource(status: SubmissionStatus | null): boolean {
  return status?.status === 'running' && stageOf(status) === 'reviewing';
}

/**
 * Did the backend say the two readings disagree?
 *
 * Two signals, both of them things the pipeline reports rather than things this
 * screen infers:
 *
 *  1. `progress.detail.disagreement === true` — said outright.
 *  2. A third reading is running. The reviewer takes two paraphrased readings and
 *     goes to four ONLY when those two split (AGENTS.md §7, `reviewerIdentity`:
 *     "2 paraphrased readings, 4 when they disagree"). So `run >= 3` is not a
 *     guess about disagreement, it is the tie-break pair being under way.
 *
 * Anything else is false. This panel is the loudest thing on the screen and it
 * carries the one hue reserved for a flag; it does not get to appear on a hunch.
 */
export function disagreementReported(status: SubmissionStatus | null): boolean {
  const detail = status?.progress?.detail;
  if (!detail) return false;
  if (detail.disagreement === true) return true;
  const run = num(detail.run);
  return stageOf(status) === 'reviewing' && typeof run === 'number' && run >= 3;
}

/**
 * The two readings, when the pipeline sends them. Almost always it does not —
 * the agreed `reviewing` detail is `{model, promptVersion, run}` — so the cards
 * render their absence rather than a number. Never derived from anything.
 */
export function readingsReported(status: SubmissionStatus | null): [string | null, string | null] {
  const raw = status?.progress?.detail?.readings;
  if (!Array.isArray(raw)) return [null, null];
  return [str(raw[0]) ?? null, str(raw[1]) ?? null];
}

/* ------------------------------------------------------------- the writes --*/

/**
 * What has landed so far.
 *
 * `progress.detail` describes the CURRENT stage only, so the Walrus blob id is
 * gone from the payload by the time Arkiv is being written. The loader has to
 * remember, and this is the reducer that remembers — pure, so the accumulation
 * rule is testable rather than tangled in a `useEffect`.
 *
 * It only ever ADDS. A later poll that omits a field it once carried does not
 * erase it: the write happened, and the screen having seen it is not undone by a
 * payload that has moved on.
 */
export interface PipelineTrace {
  walrus?: { blobId?: string; contentSha256?: string; registeredBy?: string };
  arkiv?: { entityKey?: string; txHash?: string };
  reviewing?: { model?: string; promptVersion?: string; run?: number };
  /** The fingerprint of the entry this run produced — the link to its own page. */
  fingerprint?: string;
}

const FINGERPRINT_RE = /^sxf1_[0-9a-f]{64}$/;

function merge<T extends object>(prev: T | undefined, next: Partial<T>): T | undefined {
  const cleaned = Object.fromEntries(
    Object.entries(next).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
  if (!prev && !Object.keys(cleaned).length) return prev;
  return { ...(prev ?? ({} as T)), ...cleaned };
}

export function traceFrom(prev: PipelineTrace, status: SubmissionStatus | null): PipelineTrace {
  if (!status) return prev;
  const next: PipelineTrace = { ...prev };
  const stage = stageOf(status);
  const detail = status.progress?.detail ?? {};

  if (stage === 'walrus') {
    next.walrus = merge(prev.walrus, {
      blobId: str(detail.blobId),
      contentSha256: str(detail.contentSha256),
      registeredBy: str(detail.registeredBy),
    });
  }
  if (stage === 'arkiv') {
    next.arkiv = merge(prev.arkiv, {
      entityKey: str(detail.entityKey),
      txHash: str(detail.txHash),
    });
  }
  if (stage === 'reviewing') {
    next.reviewing = merge(prev.reviewing, {
      model: str(detail.model),
      promptVersion: str(detail.promptVersion),
      run: num(detail.run),
    });
  }

  // The final result carries the same pointers, and on a fast run it is the only
  // place they ever appear — the poll can easily miss a stage that lasted less
  // than one interval.
  const result = status.result ?? {};
  const resultBlob = str(result.blobId);
  if (resultBlob) next.walrus = merge(next.walrus, { blobId: resultBlob });
  const resultEntity = str(result.reviewKey) ?? str(result.arkivEntityKey);
  if (resultEntity) next.arkiv = merge(next.arkiv, { entityKey: resultEntity });

  const fp = str(result.fingerprint);
  if (fp && FINGERPRINT_RE.test(fp)) next.fingerprint = fp;

  return next;
}

export interface WriteReceipt {
  /** Stable across polls, so the one-shot animation plays on arrival and never replays. */
  key: string;
  kind: 'walrus' | 'arkiv';
  stamp: string;
  /** The id itself. Always real — a receipt with no id is not built at all. */
  id: string;
  idLabel: string;
  href: string | null;
  /** The second line: a hash or a digest, and `null` when none was reported. */
  second: string | null;
}

/**
 * One receipt per write that actually landed, in pipeline order.
 *
 * A receipt is built ONLY from an identifier the pipeline reported. There is no
 * "pending" receipt and no greyed-out placeholder: the `.sx-write` mount is the
 * animation, and mounting one for a write that has not happened would animate a
 * lie.
 */
export function writeReceipts(trace: PipelineTrace): WriteReceipt[] {
  const out: WriteReceipt[] = [];

  const blobId = trace.walrus?.blobId;
  if (blobId) {
    const sha = trace.walrus?.contentSha256;
    out.push({
      key: `walrus:${blobId}`,
      kind: 'walrus',
      stamp: COPY.pipeline.stampWalrus,
      id: blobId,
      idLabel: COPY.pipeline.blobLabel,
      href: walrusBlobUrl(blobId),
      second: sha ? `${COPY.pipeline.sha256Label} ${sha}` : null,
    });
  }

  const entityKey = trace.arkiv?.entityKey;
  if (entityKey) {
    const tx = trace.arkiv?.txHash;
    out.push({
      key: `arkiv:${entityKey}`,
      kind: 'arkiv',
      stamp: COPY.pipeline.stampArkiv,
      id: entityKey,
      idLabel: COPY.pipeline.entityLabel,
      href: arkivEntityUrl(entityKey),
      second: tx ? `${COPY.pipeline.txLabel} ${tx}` : null,
    });
  }

  return out;
}

/* -------------------------------------------------------------- the links --*/

/**
 * Bases, and the rule they follow: anything the record does not carry is
 * OMITTED rather than guessed — a dead link that looks alive is worse than no
 * link. That rule and these defaults are `apps/api/src/links.mjs`; the copy
 * exists because this module is bundled for the browser and that one imports
 * `@surex/core`. `test/submission.test.mjs` reads the API file as text and fails
 * if the two ever disagree.
 */
export const DEFAULT_WALRUS_AGGREGATOR = 'https://aggregator.walrus-testnet.walrus.space';
export const DEFAULT_ARKIV_EXPLORER = 'https://explorer.braga.hoodi.arkiv.network';
export const DEFAULT_SUI_EXPLORER = 'https://suiscan.xyz/testnet';

const trimEnd = (s: string) => s.replace(/\/+$/, '');

function base(
  override: string | undefined,
  fallback: string,
): string {
  const raw = override?.trim();
  return trimEnd(raw && raw.length ? raw : fallback);
}

export function walrusBlobUrl(blobId: string | undefined | null): string | null {
  if (!blobId) return null;
  const b = base(process.env.NEXT_PUBLIC_SUREX_WALRUS_AGGREGATOR, DEFAULT_WALRUS_AGGREGATOR);
  return `${b}/v1/blobs/${encodeURIComponent(blobId)}`;
}

export function arkivEntityUrl(entityKey: string | undefined | null): string | null {
  if (!entityKey) return null;
  const b = base(process.env.NEXT_PUBLIC_SUREX_ARKIV_EXPLORER, DEFAULT_ARKIV_EXPLORER);
  return `${b}/entity/${encodeURIComponent(entityKey)}`;
}

export function suiTxUrl(digest: string | undefined | null): string | null {
  if (!digest) return null;
  const b = base(process.env.NEXT_PUBLIC_SUREX_SUI_EXPLORER, DEFAULT_SUI_EXPLORER);
  return `${b}/tx/${encodeURIComponent(digest)}`;
}

/** The entry's own page, once the run has produced a fingerprint. */
export function entryHref(fingerprint: string | undefined | null): string | null {
  if (!fingerprint || !FINGERPRINT_RE.test(fingerprint)) return null;
  return `/r/${fingerprint}`;
}

/* --------------------------------------------------------------- the poll --*/

/**
 * 1800 ms. The pipeline's stages are seconds to minutes apart — `createEntity()`
 * alone awaits a receipt for ~4.6 s (AGENTS.md §7, A4) — so a faster poll buys
 * nothing and a slower one lets a short stage pass unseen between two requests.
 */
export const POLL_INTERVAL_MS = 1800;

/** After this many consecutive network failures the watch gives up and says so. */
export const POLL_FAILURE_LIMIT = 5;

export function shouldPoll(status: SubmissionStatus | null): boolean {
  if (!status) return true;
  return status.status !== 'done' && status.status !== 'failed';
}

export function submissionStatusUrl(id: string): string {
  return `${apiBase()}/v1/submissions/${encodeURIComponent(id)}`;
}

export type StatusFetch =
  | { kind: 'ok'; status: SubmissionStatus }
  /** The registry has no record of this id. Different from a request that failed. */
  | { kind: 'unknown' }
  /** The deployment has no writer, so it has nothing to report on. HTTP 501. */
  | { kind: 'notBuilt'; detail?: string }
  | { kind: 'unreachable'; detail: string };

/**
 * One poll. Never throws — every outcome is a value, because the difference
 * between "the registry says it does not know this id" and "we could not ask"
 * is exactly what the screen has to keep distinct.
 */
export async function fetchSubmissionStatus(id: string, signal?: AbortSignal): Promise<StatusFetch> {
  try {
    const res = await fetch(submissionStatusUrl(id), {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal,
    });
    if (res.status === 404) return { kind: 'unknown' };
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.status === 501) {
      const err = (body?.error ?? {}) as Record<string, unknown>;
      return { kind: 'notBuilt', detail: str(err.message) };
    }
    if (!res.ok) return { kind: 'unreachable', detail: `HTTP ${res.status}` };

    const parsed = parseSubmissionStatus(body);
    if (!parsed) return { kind: 'unreachable', detail: 'the registry answered in a shape this page cannot read' };
    return { kind: 'ok', status: parsed };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { kind: 'unreachable', detail: 'cancelled' };
    }
    return { kind: 'unreachable', detail: err instanceof Error ? err.message : 'network error' };
  }
}
