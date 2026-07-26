/**
 * The live loader's logic, without a browser. Run: node --test apps/web/test/
 *
 * Everything the loader says about a run is derived by pure functions in
 * `lib/submission.ts`. The assertions are mostly about ABSENCE — a missing field
 * stays missing, a derived number says it is derived, and no component appears on
 * a hunch — so a two-minute silence is never filled with something nobody reported.
 *
 * The `.ts` imports are deliberate — Node 22 strips types, so there is no build
 * step between writing the logic and checking it.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { COPY } from '../lib/copy.ts';
import { humanDuration } from '../lib/format.ts';
import {
  DEFAULT_ARKIV_EXPLORER,
  DEFAULT_SUI_EXPLORER,
  DEFAULT_WALRUS_AGGREGATOR,
  SUBMISSION_STAGES,
  SX_COLUMNS,
  SX_T,
  arkivEntityUrl,
  disagreementReported,
  entryHref,
  halftoneClass,
  halftoneState,
  parseSubmissionStatus,
  progressFraction,
  readingSource,
  readingsReported,
  shouldPoll,
  stageLabel,
  stageOf,
  suiTxUrl,
  traceFrom,
  walrusBlobUrl,
  writeReceipts,
} from '../lib/submission.ts';

const FP = `sxf1_${'a'.repeat(64)}`;

/** A minimal well-formed payload, plus whatever a test is exercising. */
const status = (over = {}) => parseSubmissionStatus({ id: 'sub_1', status: 'running', ...over });

/* ------------------------------------------------------------- the dither --*/

test('SX_T is the fixed 48-threshold dither array the CSS expects', () => {
  // 4 rows x 12 columns. A different length silently changes the grid; a shuffled
  // one makes the pattern move between renders and read as noise, not a quantity.
  assert.equal(SX_T.length, 48);
  assert.equal(SX_T.length % SX_COLUMNS, 0);
  assert.equal(new Set(SX_T).size, 48, 'every threshold is distinct');
  for (const t of SX_T) assert.ok(t > 0 && t < 1, `${t} is outside 0..1`);
});

/* -------------------------------------------------------------- the shape --*/

test('a payload with no id is not a status', () => {
  for (const bogus of [null, undefined, 'sub_1', 42, {}, { status: 'running' }]) {
    assert.equal(parseSubmissionStatus(bogus), null);
  }
});

test('an unrecognised status degrades to queued, never to done', () => {
  // Degrading to `done` would stop the poll and show a completed run that is still
  // going. Queued claims the least of the four.
  for (const weird of ['finished', 'ok', '', 42, undefined]) {
    assert.equal(parseSubmissionStatus({ id: 'x', status: weird })?.status, 'queued');
  }
});

test('a progress block with an unknown stage is dropped rather than trusted', () => {
  const parsed = parseSubmissionStatus({
    id: 'x',
    status: 'running',
    progress: { stage: 'uploading-to-s3', done: 3, total: 8 },
  });
  assert.equal(parsed.progress, undefined, 'an unnamed stage is not a stage');
  assert.equal(stageOf(parsed), null);
  assert.equal(progressFraction(parsed), null, 'and it contributes no number either');
});

test('the older flat stage field is read when there is no progress block', () => {
  const parsed = status({ stage: 'walrus' });
  assert.equal(stageOf(parsed), 'walrus');
  assert.equal(stageLabel(parsed), COPY.pipeline.stage.walrus);
});

test('the nested stage wins over the flat one', () => {
  const parsed = status({ stage: 'reviewing', progress: { stage: 'arkiv' } });
  assert.equal(stageOf(parsed), 'arkiv');
});

/* ------------------------------------------------------------- the labels --*/

test('every stage in the contract has a label', () => {
  for (const stage of SUBMISSION_STAGES) {
    const label = stageLabel(status({ progress: { stage } }));
    assert.ok(label && label.length > 2, `no label for ${stage}`);
  }
});

test("the API's own label wins over the table", () => {
  // It knows what it is doing on that particular run and this table does not.
  const parsed = status({ progress: { stage: 'fetching', label: 'fetching 412 files' } });
  assert.equal(stageLabel(parsed), 'fetching 412 files');
});

test('no stage reported means no label — not a guess at one', () => {
  assert.equal(stageLabel(status()), null);
  assert.equal(stageLabel(null), null);
});

/* ----------------------------------------------------------- the fraction --*/

test('a reported done/total is used as reported, and says so', () => {
  const f = progressFraction(status({ progress: { stage: 'reviewing', done: 3, total: 4 } }));
  assert.equal(f.value, 0.75);
  assert.equal(f.from, 'reported');
  assert.equal(f.done, 3);
  assert.equal(f.total, 4);
});

test('a stage with no counts derives a density, and marks it derived', () => {
  // The screen renders "step 5 of 8" for a derived fraction and "3 of 4" for a
  // reported one, because they are different claims.
  const f = progressFraction(status({ progress: { stage: 'reviewing' } }));
  assert.equal(f.from, 'stage');
  assert.equal(f.step, SUBMISSION_STAGES.indexOf('reviewing') + 1);
  assert.equal(f.steps, SUBMISSION_STAGES.length);
  assert.ok(f.value > 0 && f.value < 1);
});

test('a run that reported nothing gets NO fraction', () => {
  // Not zero — zero is a number. The component is told there is no fraction at all.
  assert.equal(progressFraction(status({ status: 'queued' })), null);
  assert.equal(progressFraction(null), null);
});

test('a finished run is full even if it never reported a count', () => {
  const f = progressFraction(parseSubmissionStatus({ id: 'x', status: 'done' }));
  assert.equal(f.value, 1);
});

test('a nonsense total cannot produce a fraction', () => {
  for (const total of [0, -4]) {
    const f = progressFraction(status({ progress: { stage: 'walrus', done: 2, total } }));
    assert.notEqual(f?.from, 'reported', `total ${total} must not be divided by`);
  }
});

test('a done count past the total is clamped, never rendered over 1', () => {
  const f = progressFraction(status({ progress: { stage: 'walrus', done: 9, total: 4 } }));
  assert.equal(f.value, 1);
});

/* ------------------------------------------------ which components mount --*/

test('the halftone state follows the queue state', () => {
  assert.equal(halftoneState(parseSubmissionStatus({ id: 'x', status: 'queued' })), 'idle');
  assert.equal(halftoneState(status()), 'working');
  assert.equal(halftoneState(parseSubmissionStatus({ id: 'x', status: 'done' })), 'done');
  assert.equal(halftoneState(null), 'idle');
});

test('a failed run gets the STATIC halftone, not the breathing one', () => {
  // `is-idle` breathes, and a breathing field of dots on a run that has stopped
  // reads as still working.
  const state = halftoneState(parseSubmissionStatus({ id: 'x', status: 'failed' }));
  assert.equal(state, 'static');
  assert.equal(halftoneClass(state), 'sx-halftone', 'the bare class is the settled render');
  assert.ok(!halftoneClass(state).includes('is-'));
});

test('the reading pulse is mounted only while the model has the source open', () => {
  assert.equal(readingSource(status({ progress: { stage: 'reviewing' } })), true);
  assert.equal(readingSource(status({ progress: { stage: 'walrus' } })), false);
  assert.equal(readingSource(status({ progress: { stage: 'fetching' } })), false);
  // Queued at the reviewing stage is not reading; nor is a finished run.
  assert.equal(
    readingSource(parseSubmissionStatus({ id: 'x', status: 'done', progress: { stage: 'reviewing' } })),
    false,
  );
});

test('the disagreement panel does NOT mount on a normal review', () => {
  assert.equal(disagreementReported(null), false);
  assert.equal(disagreementReported(status({ progress: { stage: 'reviewing' } })), false);
  for (const run of [1, 2]) {
    assert.equal(
      disagreementReported(status({ progress: { stage: 'reviewing', detail: { run } } })),
      false,
      `run ${run} is the normal pair, not a split`,
    );
  }
});

test('it mounts when the backend says so outright', () => {
  assert.equal(
    disagreementReported(status({ progress: { stage: 'reviewing', detail: { disagreement: true } } })),
    true,
  );
});

test('it mounts on a third reading, because a third reading only happens after a split', () => {
  // The reviewer takes two paraphrased readings and goes to four ONLY when they
  // disagree (AGENTS.md §7), so run >= 3 is the tie-break pair running.
  assert.equal(
    disagreementReported(status({ progress: { stage: 'reviewing', detail: { run: 3 } } })),
    true,
  );
  // …but only during the reading. A run counter left on a later stage is not a
  // live split.
  assert.equal(
    disagreementReported(status({ progress: { stage: 'walrus', detail: { run: 4 } } })),
    false,
  );
});

test('a split with no reported sides renders absence, never two invented readings', () => {
  const [a, b] = readingsReported(status({ progress: { stage: 'reviewing', detail: { run: 3 } } }));
  assert.equal(a, null);
  assert.equal(b, null);
});

test('and it uses the sides when they are reported', () => {
  const [a, b] = readingsReported(
    status({ progress: { stage: 'reviewing', detail: { run: 3, readings: ['flagged', 'clean'] } } }),
  );
  assert.equal(a, 'flagged');
  assert.equal(b, 'clean');
});

/* ------------------------------------------------------------- the trace --*/

test('the trace remembers a write after the payload has moved on', () => {
  // progress.detail describes the CURRENT stage only, so the blob id is gone from
  // the payload by the time Arkiv is written — losing it unmounts a receipt for a
  // write that really happened.
  let trace = {};
  trace = traceFrom(trace, status({ progress: { stage: 'walrus', detail: { blobId: 'blob-1', contentSha256: 'f0457c' } } }));
  trace = traceFrom(trace, status({ progress: { stage: 'arkiv', detail: { entityKey: 'ent-1', txHash: '0xabc' } } }));

  assert.equal(trace.walrus.blobId, 'blob-1');
  assert.equal(trace.walrus.contentSha256, 'f0457c');
  assert.equal(trace.arkiv.entityKey, 'ent-1');
  assert.equal(trace.arkiv.txHash, '0xabc');
});

test('a later poll that omits a field does not erase it', () => {
  let trace = traceFrom({}, status({ progress: { stage: 'walrus', detail: { blobId: 'blob-1', contentSha256: 'f0457c' } } }));
  trace = traceFrom(trace, status({ progress: { stage: 'walrus', detail: { blobId: 'blob-1' } } }));
  assert.equal(trace.walrus.contentSha256, 'f0457c', 'the write happened; a quieter payload does not undo it');
});

test('the final result fills in a stage the poll never saw', () => {
  // A stage shorter than one poll interval is invisible to the watcher, so on a
  // fast run the result is the only place its pointers appear.
  const trace = traceFrom({}, parseSubmissionStatus({
    id: 'x',
    status: 'done',
    result: { blobId: 'blob-9', reviewKey: 'ent-9', fingerprint: FP },
  }));
  assert.equal(trace.walrus.blobId, 'blob-9');
  assert.equal(trace.arkiv.entityKey, 'ent-9');
  assert.equal(trace.fingerprint, FP);
});

test('a result fingerprint that is not a fingerprint is not recorded', () => {
  const trace = traceFrom({}, parseSubmissionStatus({
    id: 'x',
    status: 'done',
    result: { fingerprint: 'sxf1_nope' },
  }));
  assert.equal(trace.fingerprint, undefined);
  assert.equal(entryHref(trace.fingerprint), null, 'and it produces no link');
});

/* ----------------------------------------------------------- the receipts --*/

test('no write, no receipt — there is no pending variant', () => {
  // `.sx-write` mounts once and the mount IS the animation, so a placeholder would
  // animate a write that has not happened.
  assert.deepEqual(writeReceipts({}), []);
  assert.deepEqual(writeReceipts({ walrus: {} }), []);
  assert.deepEqual(writeReceipts({ arkiv: { txHash: '0xabc' } }), [], 'a digest with no entity key is not an entity');
});

test('a receipt carries the real id, and links out to it', () => {
  const [walrus, arkiv] = writeReceipts({
    walrus: { blobId: 'blob-1', contentSha256: 'f0457c' },
    arkiv: { entityKey: 'ent-1', txHash: '0xabc' },
  });

  assert.equal(walrus.kind, 'walrus');
  assert.equal(walrus.id, 'blob-1');
  assert.equal(walrus.key, 'walrus:blob-1', 'stable key — the one-shot must not replay on re-render');
  assert.ok(walrus.href.endsWith('/v1/blobs/blob-1'));
  assert.ok(walrus.second.includes('f0457c'));

  assert.equal(arkiv.id, 'ent-1');
  assert.ok(arkiv.href.endsWith('/entity/ent-1'));
  assert.ok(arkiv.second.includes('0xabc'));
});

test('a hash nobody reported leaves the second line empty rather than filled', () => {
  const [walrus] = writeReceipts({ walrus: { blobId: 'blob-1' } });
  assert.equal(walrus.second, null);
});

/* --------------------------------------------------------------- the links -*/

test('an absent id produces no link at all', () => {
  // A dead link that looks alive is worse than no link — apps/api/src/links.mjs.
  for (const build of [walrusBlobUrl, arkivEntityUrl, suiTxUrl]) {
    assert.equal(build(undefined), null);
    assert.equal(build(null), null);
    assert.equal(build(''), null);
  }
  assert.equal(entryHref(undefined), null);
});

test('ids are encoded into the path', () => {
  assert.ok(walrusBlobUrl('a/b').endsWith('/v1/blobs/a%2Fb'));
  assert.ok(arkivEntityUrl('a b').endsWith('/entity/a%20b'));
});

test('the link bases have not drifted from the API lane', () => {
  // This module cannot import `apps/api/src/links.mjs` — it is bundled for the
  // browser and that file reaches `@surex/core`, which reaches `node:crypto`. So
  // the bases are a second copy, checked by reading the API file as TEXT.
  const links = readFileSync(new URL('../../../apps/api/src/links.mjs', import.meta.url), 'utf8');
  const blob = readFileSync(new URL('../../../packages/core/src/blob.mjs', import.meta.url), 'utf8');

  assert.ok(
    links.includes(`'${DEFAULT_ARKIV_EXPLORER}'`),
    `apps/api/src/links.mjs no longer carries ${DEFAULT_ARKIV_EXPLORER}`,
  );
  assert.ok(
    links.includes(`'${DEFAULT_SUI_EXPLORER}'`),
    `apps/api/src/links.mjs no longer carries ${DEFAULT_SUI_EXPLORER}`,
  );
  // The API uses DEFAULT_AGGREGATORS[0]; that array lives in core.
  const first = blob.match(/DEFAULT_AGGREGATORS = Object\.freeze\(\[\s*'([^']+)'/)?.[1];
  assert.equal(
    first,
    DEFAULT_WALRUS_AGGREGATOR,
    'DEFAULT_AGGREGATORS[0] moved; the browser copy must move with it',
  );

  // The PATHS, not only the bases. Every one was confirmed against a live explorer
  // — `/entities/<key>` and `/storage/entity/<key>` both 404 — so they are not
  // guessable and a silent change to one is a page full of dead links.
  for (const path of ['/v1/blobs/', '/object/', '/tx/', '/entity/']) {
    assert.ok(links.includes(path), `apps/api/src/links.mjs no longer builds ${path}`);
  }
});

test('the entry link is the entry page, not an explorer', () => {
  assert.equal(entryHref(FP), `/r/${FP}`);
});

/* ---------------------------------------------------------------- the poll -*/

test('polling stops on a terminal state and only on a terminal state', () => {
  assert.equal(shouldPoll(null), true, 'before the first answer there is nothing to stop for');
  assert.equal(shouldPoll(parseSubmissionStatus({ id: 'x', status: 'queued' })), true);
  assert.equal(shouldPoll(status()), true);
  assert.equal(shouldPoll(parseSubmissionStatus({ id: 'x', status: 'done' })), false);
  assert.equal(shouldPoll(parseSubmissionStatus({ id: 'x', status: 'failed' })), false);
});

/* -------------------------------------------------------------- formatting -*/

test('a duration nobody reported formats as nothing, not as 0s', () => {
  // `0s` reads as "it just started", which is a different claim from "nobody said".
  for (const bad of [undefined, null, NaN, -1, 'soon']) {
    assert.equal(humanDuration(bad), null);
  }
});

test('durations read in minutes once there are any', () => {
  assert.equal(humanDuration(0), '0s');
  assert.equal(humanDuration(4600), '5s');
  assert.equal(humanDuration(104_000), '1m 44s');
  assert.equal(humanDuration(600_000), '10m 0s');
});
