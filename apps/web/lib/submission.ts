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
  /**
   * Every stage the watch has actually SEEN reported, in first-seen order.
   *
   * Not the same thing as "every stage that ran", and the difference is the whole
   * reason it is recorded: the poll is 1800 ms and a short stage passes between
   * two requests. So this is only ever used to decide whether to DRAW a tile that
   * the pipeline does not always emit (`starting`), never to claim that a stage
   * did or did not happen.
   */
  seen?: SubmissionStage[];
  resolving?: {
    repo?: string;
    commit?: string;
    release?: string;
    package?: string;
    version?: string;
    tier?: string;
  };
  licence?: { spdx?: string };
  fetching?: { artifact?: string; integrity?: string };
  starting?: { artifact?: string };
  walrus?: {
    blobId?: string;
    contentSha256?: string;
    registeredBy?: string;
    /**
     * Absent on the publisher path, and that absence is a fact rather than a gap
     * — a public publisher's wallet registers the blob, so there is no object of
     * ours to link. Read as "not stated", never as "ours".
     */
    suiObjectId?: string;
    registerTx?: string;
    certifyTx?: string;
  };
  arkiv?: { entityKey?: string; txHash?: string };
  reviewing?: { model?: string; promptVersion?: string; run?: number; files?: number; runs?: number };
  done?: { state?: string; reason?: string };
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

  // Seen, in first-seen order. Append-only, like everything else here.
  if (stage && !(prev.seen ?? []).includes(stage)) {
    next.seen = [...(prev.seen ?? []), stage];
  }

  if (stage === 'resolving') {
    next.resolving = merge(prev.resolving, {
      repo: str(detail.repo),
      commit: str(detail.commit),
      release: str(detail.release),
      package: str(detail.package),
      version: str(detail.version),
      tier: str(detail.tier),
    });
    // The pipeline says the fingerprint here, minutes before the run finishes,
    // precisely so a watcher can open the entry page under the name they were
    // already given. Same shape check as the result path — a value that is not a
    // fingerprint is not recorded as one.
    const early = str(detail.fingerprint);
    if (early && FINGERPRINT_RE.test(early)) next.fingerprint = early;
  }
  if (stage === 'licence') {
    next.licence = merge(prev.licence, { spdx: str(detail.spdx) });
  }
  if (stage === 'fetching') {
    next.fetching = merge(prev.fetching, {
      artifact: str(detail.artifact),
      integrity: str(detail.integrity),
    });
  }
  if (stage === 'starting') {
    next.starting = merge(prev.starting, { artifact: str(detail.artifact) });
  }
  if (stage === 'walrus') {
    next.walrus = merge(prev.walrus, {
      blobId: str(detail.blobId),
      contentSha256: str(detail.contentSha256),
      registeredBy: str(detail.registeredBy),
      suiObjectId: str(detail.suiObjectId),
      registerTx: str(detail.registerTx),
      certifyTx: str(detail.certifyTx),
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
      files: num(detail.files),
      runs: num(detail.runs),
    });
  }
  if (stage === 'done') {
    next.done = merge(prev.done, { state: str(detail.state), reason: str(detail.reason) });
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

export function suiObjectUrl(objectId: string | undefined | null): string | null {
  if (!objectId) return null;
  const b = base(process.env.NEXT_PUBLIC_SUREX_SUI_EXPLORER, DEFAULT_SUI_EXPLORER);
  return `${b}/object/${encodeURIComponent(objectId)}`;
}

/** The entry's own page, once the run has produced a fingerprint. */
export function entryHref(fingerprint: string | undefined | null): string | null {
  if (!fingerprint || !FINGERPRINT_RE.test(fingerprint)) return null;
  return `/r/${fingerprint}`;
}

/* ------------------------------------------------- where the source came from */

/**
 * GitHub and npm are NOT in `apps/api/src/links.mjs`, and that is not an
 * oversight to fix later: that file turns the identifiers a RECORD carries —
 * blob, Sui object, both digests, Arkiv entity — into explorer URLs, and the API
 * never builds a link to somebody's repository. These two are the run's inputs
 * rather than its outputs, so they live here, and the shapes they accept are the
 * shapes `scripts/ingest-submission.mjs` itself enforces: `owner/name` and a
 * 40-character hex sha, never a tag.
 */
export const DEFAULT_GITHUB = 'https://github.com';
export const DEFAULT_NPM = 'https://www.npmjs.com';

const REPO_RE = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const SHA_RE = /^[0-9a-f]{40}$/i;
/** npm's own name rule, minus the length cap it enforces at publish time. */
const NPM_NAME_RE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

export function githubRepoUrl(repo: string | undefined | null): string | null {
  if (!repo || !REPO_RE.test(repo)) return null;
  return `${DEFAULT_GITHUB}/${repo.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * A commit, never a tag. A tag can be repointed, so a link built from one would
 * quietly stop pointing at the bytes this entry is about — which is the exact
 * gap Tier exists to describe.
 */
export function githubCommitUrl(
  repo: string | undefined | null,
  commit: string | undefined | null,
): string | null {
  const base = githubRepoUrl(repo);
  if (!base || !commit || !SHA_RE.test(commit)) return null;
  return `${base}/commit/${commit.toLowerCase()}`;
}

export function npmVersionUrl(
  name: string | undefined | null,
  version?: string | undefined | null,
): string | null {
  if (!name || !NPM_NAME_RE.test(name)) return null;
  const path = name.split('/').map(encodeURIComponent).join('/');
  const v = String(version ?? '').trim();
  return v ? `${DEFAULT_NPM}/package/${path}/v/${encodeURIComponent(v)}` : `${DEFAULT_NPM}/package/${path}`;
}

/**
 * `npm:<name>@<version>` or `github:<owner>/<repo>@<sha>` — the two forms the
 * pipeline records as `reviewedArtifact`, and the two things it can actually have
 * read. Anything else produces no link rather than a guess.
 */
export function artifactUrl(artifact: string | undefined | null): string | null {
  const raw = String(artifact ?? '').trim();
  if (!raw) return null;
  const split = (rest: string): [string, string] | null => {
    const at = rest.lastIndexOf('@');
    // `<= 0` and not `=== -1`: a scoped npm name starts with `@`, and that one is
    // the scope rather than a version separator.
    return at <= 0 ? null : [rest.slice(0, at), rest.slice(at + 1)];
  };
  if (raw.startsWith('npm:')) {
    const parts = split(raw.slice('npm:'.length));
    return parts ? npmVersionUrl(parts[0], parts[1]) : null;
  }
  if (raw.startsWith('github:')) {
    const parts = split(raw.slice('github:'.length));
    return parts ? githubCommitUrl(parts[0], parts[1]) : null;
  }
  return null;
}

/* -------------------------------------------------------------- the ens name */

/**
 * The label encoding, a second time.
 *
 * `lib/ens.ts` is the authority and it is SERVER ONLY — it holds the gateway's
 * signing configuration and reaches `@surex/core`, which reaches `node:crypto`.
 * Importing it here would pull both into the browser bundle. So the two constants
 * are copied, exactly as the link bases are, and `test/stage-rail.test.mjs` reads
 * `lib/ens.ts` as text to prove they are still the same two.
 *
 * `sxf1-`, not `sxf1_`: ENSIP-15 rejects a mid-label underscore, so our own
 * published identifier is not a legal ENS label as written (FRICTION-LOG E1).
 * 40 hex characters and not 64, because clients disagree above a 63-byte label
 * (E2). The truncation is a naming convenience and never the identity.
 */
export const ENS_LABEL_PREFIX = 'sxf1-';
export const ENS_LABEL_HEX_LENGTH = 40;
export const DEFAULT_ENS_APP_HOST = 'app.ens.domains';

export function ensLabelFor(fingerprint: string | undefined | null): string | null {
  if (!fingerprint || !FINGERPRINT_RE.test(fingerprint)) return null;
  return ENS_LABEL_PREFIX + fingerprint.slice('sxf1_'.length, 'sxf1_'.length + ENS_LABEL_HEX_LENGTH);
}

/** The parent this deployment was configured with, or `null`. */
export function ensParent(): string | null {
  const raw = process.env.NEXT_PUBLIC_SUREX_ENS_PARENT?.trim();
  return raw ? raw.replace(/^\.+|\.+$/g, '') : null;
}

/**
 * `null` when no parent is configured, and the row is then omitted rather than
 * rendered grey — the same rule the provenance panel follows. A deployment that
 * never set the parent has no name to show, and inventing one would be inventing
 * a read interface that does not answer.
 */
export function ensNameFor(fingerprint: string | undefined | null): string | null {
  const parent = ensParent();
  const label = ensLabelFor(fingerprint);
  return parent && label ? `${label}.${parent}` : null;
}

/** Where a human looks at a name. Mainnet unless the deployment says otherwise. */
export function ensAppUrl(name: string | undefined | null): string | null {
  if (!name) return null;
  const chain = process.env.NEXT_PUBLIC_SUREX_ENS_CHAIN?.trim() || 'mainnet';
  const host = chain === 'mainnet' ? DEFAULT_ENS_APP_HOST : `${chain}.${DEFAULT_ENS_APP_HOST}`;
  return `https://${host}/name/${encodeURIComponent(name)}`;
}

/* --------------------------------------------------------------- the rail --*/

/**
 * Which technology each stage touches.
 *
 * This is the question the halftone cannot answer. It says how far the run has
 * got; it does not say whose machine is reading the source right now, or what
 * just landed where. `null` is a real answer — the licence gate touches none of
 * the four, and a tile that invented a chip for it would be decorating.
 */
export type StageTech = 'source' | 'dgx' | 'walrus' | 'arkiv' | 'ens';

export const STAGE_TECH: Record<SubmissionStage, StageTech | null> = {
  resolving: 'source',
  licence: null,
  fetching: 'source',
  starting: null,
  reviewing: 'dgx',
  walrus: 'walrus',
  arkiv: 'arkiv',
  // Not a write to ENS — nothing is ever written there. Once the head is indexed
  // the wildcard resolver can answer for it, which is when the entry becomes
  // readable as a name. That is what this tile claims and all it claims.
  done: 'ens',
};

/**
 * The tiles to draw.
 *
 * `starting` is in the shared stage list because `GET /v1/submissions/:id` can
 * report it, but `scripts/ingest-submission.mjs` never emits it — it reads the
 * tool list out of the README rather than installing and starting the server, and
 * says so in a comment where the list is defined. Drawing a step that does not run
 * is a fabricated fact on a progress screen, so the tile appears only for a run
 * that actually reported the stage.
 */
export function railStages(trace: PipelineTrace): SubmissionStage[] {
  const seen = trace.seen ?? [];
  return SUBMISSION_STAGES.filter((stage) => stage !== 'starting' || seen.includes('starting'));
}

/**
 * `done` says the RUN moved past this stage. It does not say the stage ran.
 *
 * The two are genuinely different and the pipeline is explicit about it: a licence
 * refusal jumps from `licence` straight to `walrus`, so a stage number the run
 * skipped looks identical from out here to one it completed in under a poll
 * interval. The copy for this phase is worded accordingly, and the facts panel
 * prints nothing for a stage that reported nothing.
 */
export type StagePhase = 'pending' | 'active' | 'done' | 'stopped';

export function stagePhase(stage: SubmissionStage, status: SubmissionStatus | null): StagePhase {
  const current = stageOf(status);
  if (!status || !current) return 'pending';
  const at = SUBMISSION_STAGES.indexOf(stage);
  const now = SUBMISSION_STAGES.indexOf(current);
  if (at < now) return 'done';
  if (at > now) {
    // A finished run is past everything, including a stage whose report the poll
    // never caught. `pending` on a run that has ended would be the false one.
    return status.status === 'done' ? 'done' : 'pending';
  }
  if (status.status === 'failed') return 'stopped';
  if (status.status === 'done') return 'done';
  return 'active';
}

/**
 * Which stage the detail panel describes.
 *
 * Keyed on the stage the run last REPORTED, never on the one that is `active` —
 * they are the same thing while a run is in flight and part company the moment it
 * ends, because a finished run has no active stage. Keying it off `active` made a
 * completed run describe stage one, which was caught in a render rather than in
 * review, which is why the choice is a function with a test now.
 *
 * A pick wins over both, and a pick for a stage that is not on the rail is
 * ignored rather than blanking the panel.
 */
export function shownStage(
  stages: readonly SubmissionStage[],
  picked: SubmissionStage | null,
  status: SubmissionStatus | null,
): SubmissionStage | null {
  if (picked && stages.includes(picked)) return picked;
  const reported = stageOf(status);
  if (reported && stages.includes(reported)) return reported;
  return stages[0] ?? null;
}

/**
 * Custody the record itself calls thinner: a public HTTP publisher's wallet
 * registered the blob, so the Sui object and any digest are theirs. Rendered as a
 * dashed tile — the house border grammar, where dashed means a state we did not
 * measure ourselves (see `Chip.tsx`).
 */
export function stageProvisional(stage: SubmissionStage, trace: PipelineTrace): boolean {
  return stage === 'walrus' && trace.walrus?.registeredBy === 'publisher';
}

/** A gate the run reported an answer for, and then continued past. */
export function stageGatePassed(
  stage: SubmissionStage,
  trace: PipelineTrace,
  status: SubmissionStatus | null,
): boolean {
  if (stage !== 'licence') return false;
  return Boolean(trace.licence?.spdx) && stagePhase('licence', status) === 'done';
}

export interface StageFact {
  /** From `COPY`. Never a value. */
  label: string;
  /** As reported. Never derived, never filled in. */
  value: string;
  /** Only when a real link can be built from a real identifier. */
  href?: string;
}

/** Drops anything the run did not report, so an absent fact is an absent row. */
function fact(label: string, value: unknown, href?: string | null): StageFact | null {
  const text = typeof value === 'number' ? String(value) : str(value);
  if (!text) return null;
  return href ? { label, value: text, href } : { label, value: text };
}

/**
 * The `▸` lines under a stage. Built ONLY from identifiers the run reported —
 * there is no placeholder row, and a stage that reported nothing returns `[]` so
 * the panel can say so in words instead of showing an empty list.
 */
export function stageFacts(
  stage: SubmissionStage,
  trace: PipelineTrace,
  status: SubmissionStatus | null,
): StageFact[] {
  const F = COPY.pipeline.rail.fact;
  const P = COPY.pipeline;
  const out: (StageFact | null)[] = [];

  switch (stage) {
    case 'resolving': {
      const r = trace.resolving ?? {};
      out.push(fact(F.repo, r.repo, githubRepoUrl(r.repo)));
      out.push(fact(F.commit, r.commit, githubCommitUrl(r.repo, r.commit)));
      out.push(fact(F.release, r.release));
      out.push(
        fact(
          F.package,
          r.package && r.version ? `${r.package}@${r.version}` : r.package,
          npmVersionUrl(r.package, r.version),
        ),
      );
      out.push(fact(F.tier, r.tier));
      break;
    }
    case 'licence':
      out.push(fact(F.licence, trace.licence?.spdx));
      break;
    case 'fetching':
      out.push(fact(F.artifact, trace.fetching?.artifact, artifactUrl(trace.fetching?.artifact)));
      out.push(fact(F.integrity, trace.fetching?.integrity));
      break;
    case 'starting':
      out.push(fact(F.artifact, trace.starting?.artifact, artifactUrl(trace.starting?.artifact)));
      break;
    case 'reviewing': {
      const v = trace.reviewing ?? {};
      // The reviewer block on the status payload is the same two strings by
      // another route, so either source is the run's own answer — but neither is
      // ever invented, and an unset model stays unset.
      out.push(fact(F.model, v.model ?? status?.reviewer?.model));
      out.push(fact(F.prompt, v.promptVersion ?? status?.reviewer?.promptVersion));
      out.push(fact(F.files, v.files));
      out.push(fact(F.readings, v.runs));
      break;
    }
    case 'walrus': {
      const w = trace.walrus ?? {};
      out.push(fact(P.blobLabel, w.blobId, walrusBlobUrl(w.blobId)));
      out.push(fact(P.sha256Label, w.contentSha256));
      out.push(fact(F.suiObject, w.suiObjectId, suiObjectUrl(w.suiObjectId)));
      out.push(fact(F.registerTx, w.registerTx, suiTxUrl(w.registerTx)));
      out.push(fact(F.certifyTx, w.certifyTx, suiTxUrl(w.certifyTx)));
      out.push(
        fact(
          F.custody,
          w.registeredBy === 'publisher'
            ? COPY.pipeline.rail.custodyPublisher
            : w.registeredBy === 'wallet'
              ? COPY.pipeline.rail.custodyWallet
              : undefined,
        ),
      );
      break;
    }
    case 'arkiv':
      out.push(fact(P.entityLabel, trace.arkiv?.entityKey, arkivEntityUrl(trace.arkiv?.entityKey)));
      // No link: `apps/api/src/links.mjs` builds an entity URL and nothing else for
      // Arkiv, and a transaction path nobody has confirmed would be a guess.
      out.push(fact(P.txLabel, trace.arkiv?.txHash));
      break;
    case 'done': {
      const d = trace.done ?? {};
      // A reason with no state is not a state. The pair renders together or the
      // row does not render at all.
      out.push(fact(F.state, d.state ? (d.reason ? `${d.state} (${d.reason})` : d.state) : undefined));
      const name = ensNameFor(trace.fingerprint);
      // Deliberately NOT a link. An offchain resolver cannot enumerate its keys,
      // so the ENS app queries a fixed profile set and renders an empty Records
      // tab for a name that is answering perfectly well (FRICTION-LOG E9).
      // Sending anyone there to check makes them conclude it is broken.
      out.push(fact(F.ensName, name));
      out.push(fact(F.ensRead, name ? COPY.verdict.ensExample : undefined));
      out.push(fact(F.ensParent, ensParent(), ensAppUrl(ensParent())));
      break;
    }
    default:
      break;
  }

  return out.filter((f): f is StageFact => f !== null);
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
