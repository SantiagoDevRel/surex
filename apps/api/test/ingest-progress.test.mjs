// Reading the writer's stdout, and carrying what it says through to the API.
//
// Three things are under test here and all three are load-bearing:
//
//   1. `drainLines` — stdout arrives in arbitrary chunks, so a JSON object split
//      across two `data` events must still parse. Get this wrong and progress does
//      not break loudly, it goes missing at random, which reads as a hung pipeline.
//   2. The `ok` invariant, from both sides. `resultFrom` finds the pipeline's
//      verdict by scanning backwards for the last line with an `ok` field, so a
//      progress line carrying one would be reported as a verdict for a review that
//      was still running. `parseProgressLine` refuses it, and `resultFrom` skips
//      every progress line to reach the real result.
//   3. That `GET /v1/submissions/:id` carries progress through unchanged.
//
// Every test here fails if its guard is removed — a test that passes with the
// logic disabled is a comment (repo memory: "grep rules are not tests").

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  drainLines, parseProgressLine, resultFrom, MAX_CARRY_BYTES, MAX_PROGRESS_LINE_BYTES,
} from '../../../infra/dgx-ingest/stdout.mjs';
import { createProgress, STAGES } from '../../../scripts/ingest-submission.mjs';
import { createApp } from '../src/app.mjs';

const quiet = { warn() {}, info() {}, error() {} };
const HOST = 'localhost';

const PROGRESS = (over = {}) =>
  JSON.stringify({ surexProgress: 1, stage: 'walrus', label: 'Writing the review blob', done: 6, total: 8, detail: {}, ...over });

/** Feed a stream of chunks through the reader exactly as ingest.mjs does. */
function readChunks(chunks) {
  let carry = '';
  const seen = [];
  for (const chunk of chunks) {
    const drained = drainLines(carry, chunk);
    carry = drained.carry;
    for (const line of drained.lines) {
      const progress = parseProgressLine(line);
      if (progress) seen.push(progress);
    }
  }
  return { progress: seen, carry };
}

// ---------------------------------------------------------------------------
// 1. the chunk boundary
// ---------------------------------------------------------------------------

test('a JSON object split across two chunks is still parsed', () => {
  const line = PROGRESS({ stage: 'reviewing', detail: { model: 'qwen3-coder-next:surex32k' } });
  const cut = Math.floor(line.length / 2);

  // The split is mid-object, which is what a socket actually does — it has nothing
  // to do with where the newlines are.
  const { progress } = readChunks([line.slice(0, cut), `${line.slice(cut)}\n`]);
  assert.equal(progress.length, 1, 'the halves must be rejoined, not parsed separately');
  assert.equal(progress[0].stage, 'reviewing');
  assert.equal(progress[0].detail.model, 'qwen3-coder-next:surex32k');
});

test('a line split byte by byte still arrives exactly once', () => {
  // The pathological case. If the carry were ever dropped or double-counted this
  // is where it shows: 100+ chunks, one line.
  const line = `${PROGRESS({ stage: 'arkiv', done: 7 })}\n`;
  const { progress, carry } = readChunks([...line]);
  assert.equal(progress.length, 1);
  assert.equal(progress[0].stage, 'arkiv');
  assert.equal(carry, '', 'a chunk ending on a newline leaves nothing behind');
});

test('several lines in one chunk all arrive, in order', () => {
  const chunk = `${PROGRESS({ stage: 'resolving', done: 1 })}\n${PROGRESS({ stage: 'licence', done: 2 })}\n`;
  const { progress } = readChunks([chunk]);
  assert.deepEqual(progress.map((p) => p.stage), ['resolving', 'licence']);
});

test('a chunk that ends mid-line yields nothing until the newline arrives', () => {
  // The failure this prevents: parsing per chunk would throw on half an object,
  // and a `try/catch` around it would silently drop the stage.
  const line = PROGRESS({ stage: 'fetching' });
  let carry = '';
  let drained = drainLines(carry, line);
  assert.deepEqual(drained.lines, [], 'a complete object with no newline is not yet a line');
  carry = drained.carry;
  drained = drainLines(carry, '\n');
  assert.equal(drained.lines.length, 1);
  assert.equal(parseProgressLine(drained.lines[0]).stage, 'fetching');
});

test('\\r\\n line endings parse the same as \\n', () => {
  const { progress } = readChunks([`${PROGRESS({ stage: 'done', done: 8 })}\r\n`]);
  assert.equal(progress.length, 1);
  assert.equal(progress[0].stage, 'done');
});

test('an unbounded partial line is dropped rather than grown for ever', () => {
  // A child printing megabytes with no newline must not be able to exhaust the
  // service's memory through the carry.
  const drained = drainLines('', 'x'.repeat(MAX_CARRY_BYTES + 10));
  assert.equal(drained.carry, '', 'the oversized fragment is dropped');
  assert.deepEqual(drained.lines, []);

  // And a real progress line after it still gets through.
  const after = drainLines(drained.carry, `tail-of-the-monster\n${PROGRESS()}\n`);
  const parsed = after.lines.map((l) => parseProgressLine(l)).filter(Boolean);
  assert.equal(parsed.length, 1, 'the orphaned tail is ignored and the next real line is read');
  assert.equal(parsed[0].stage, 'walrus');
});

// ---------------------------------------------------------------------------
// 2. the `ok` invariant — the two channels on one stream
// ---------------------------------------------------------------------------

test('a progress line is NEVER mistaken for the result', () => {
  const stdout = [PROGRESS({ stage: 'resolving', done: 1 }), PROGRESS({ stage: 'reviewing', done: 5 })].join('\n');
  assert.equal(
    resultFrom(stdout),
    null,
    'a pipeline that printed progress and then died reported no result, and must not appear to have reported one',
  );
});

test('the result is still found when progress lines precede it', () => {
  const stdout = [
    'ingest acme/acme-mcp @ deadbeefdead',
    PROGRESS({ stage: 'resolving', done: 1 }),
    PROGRESS({ stage: 'walrus', done: 6 }),
    PROGRESS({ stage: 'done', done: 8 }),
    JSON.stringify({ ok: true, fingerprint: 'sxf1_abc', state: 'clean', verdictUrl: 'https://x/r/sxf1_abc' }),
    '',
  ].join('\n');
  const result = resultFrom(stdout);
  assert.ok(result, 'the result line is found past every progress line');
  assert.equal(result.ok, true);
  assert.equal(result.state, 'clean');
});

test('a progress line carrying `ok` is refused, not published as progress', () => {
  assert.equal(parseProgressLine(PROGRESS({ ok: true })), null);
  assert.equal(parseProgressLine(PROGRESS({ ok: false })), null);

  // What this does not do: resultFrom reads the raw stdout, so a line that broke
  // the rule is still a candidate result there. The next test holds the invariant.
  assert.ok(resultFrom(PROGRESS({ ok: true })), 'resultFrom cannot tell — which is why the emitter must never produce one');
});

test('the pipeline emits no `ok` on any stage, on any route', () => {
  // The guard. The `ok` invariant is only enforceable at the emitter, and this is
  // the test that fails if someone adds the field to the progress payload for
  // convenience — before it can ever reach a maintainer as a verdict.
  const lines = [];
  const progress = createProgress((line) => lines.push(line));
  for (const stage of STAGES) progress(stage, `at ${stage}`, { note: 'x' });
  assert.equal(lines.length, STAGES.length);
  for (const line of lines) {
    const parsed = JSON.parse(line);
    assert.equal('ok' in parsed, false, `stage ${parsed.stage} must not carry an ok field`);
    assert.equal(parsed.surexProgress, 1);
    assert.equal(resultFrom(line), null, 'and resultFrom must not accept it');
  }
});

// ---------------------------------------------------------------------------
// 3. malformed input is ignored, never thrown
// ---------------------------------------------------------------------------

test('a malformed line is ignored rather than throwing', () => {
  // Everything the child might print that is not a progress line. Not one of
  // these may take down the queue that other jobs are waiting in.
  const junk = [
    '',
    '   ',
    'ingest acme/acme-mcp @ 0f2c1b',
    '{',
    '{"surexProgress":1,"stage":"walrus"', // truncated: the chunk-boundary case, mid-line
    '{"surexProgress":1,',
    '[{"surexProgress":1,"stage":"walrus"}]', // an array, not an object
    'null',
    '{"surexProgress":2,"stage":"walrus"}', // wrong discriminator
    '{"stage":"walrus","label":"no discriminator"}',
    '{"surexProgress":1,"label":"no stage"}',
    '{"surexProgress":1,"stage":"   "}',
    '{"surexProgress":true,"stage":"walrus"}',
    undefined,
    null,
  ];
  for (const line of junk) {
    assert.doesNotThrow(() => parseProgressLine(line), `threw on: ${String(line)}`);
    assert.equal(parseProgressLine(line), null, `accepted junk: ${String(line)}`);
  }
});

test('an absurdly long progress line is refused', () => {
  // Bounds what lands on the job, in the state file, and in the API's answer.
  const huge = PROGRESS({ detail: { blob: 'z'.repeat(MAX_PROGRESS_LINE_BYTES) } });
  assert.equal(parseProgressLine(huge), null);
  assert.ok(parseProgressLine(PROGRESS()), 'and an ordinary line still passes');
});

test('progress is narrowed to the agreed shape', () => {
  const parsed = parseProgressLine(
    PROGRESS({ stage: ' walrus ', label: 'Blob written', done: 6, total: 8, detail: { blobId: 'abc' }, extra: 'dropped' }),
  );
  assert.deepEqual(parsed, { stage: 'walrus', label: 'Blob written', done: 6, total: 8, detail: { blobId: 'abc' } });

  // A detail that is not an object becomes an empty one rather than reaching a
  // screen as a string it would try to read keys off.
  assert.deepEqual(parseProgressLine(PROGRESS({ detail: 'nope' })).detail, {});
});

// ---------------------------------------------------------------------------
// 4. the emitter's own arithmetic
// ---------------------------------------------------------------------------

test('done never moves backwards, and a skipped stage jumps it forward', () => {
  // The licence-refusal route: nothing is fetched, nothing is reviewed, and the
  // entry is still written down. The number must not pretend those stages happened
  // and must not go backwards when the pipeline reaches storage.
  const lines = [];
  const progress = createProgress((l) => lines.push(JSON.parse(l)));
  progress('resolving', 'a');
  progress('licence', 'b');
  progress('walrus', 'c');
  progress('arkiv', 'd');
  progress('done', 'e');

  assert.deepEqual(lines.map((l) => l.done), [1, 2, 6, 7, 8]);
  assert.ok(lines.every((l) => l.total === STAGES.length));
  assert.equal(lines.at(-1).done, lines.at(-1).total, 'a finished pipeline reads as finished');
});

test('this pipeline fetches before it gates, and the clamp keeps the bar honest', () => {
  // `fetching` sits after `licence` in the canonical list but happens before it
  // here, because the record for a licence-refused package names the artifact it
  // would have read. The bar must not run backwards because of that.
  const lines = [];
  const progress = createProgress((l) => lines.push(JSON.parse(l)));
  progress('fetching', 'downloading');
  progress('licence', 'checking');
  assert.deepEqual(lines.map((l) => l.done), [3, 3]);
});

test('a stage that speaks twice does not advance the bar', () => {
  const lines = [];
  const progress = createProgress((l) => lines.push(JSON.parse(l)));
  progress('walrus', 'writing');
  progress('walrus', 'written', { blobId: 'abc' });
  assert.deepEqual(lines.map((l) => l.done), [6, 6]);
  assert.equal(lines[1].detail.blobId, 'abc');
});

test('an unknown value is DROPPED from detail, never published as null', () => {
  // `blobId: null` on a screen is not an absent fact, it is a claim that there is
  // no blob. The rule is: only what is already known travels.
  const lines = [];
  const progress = createProgress((l) => lines.push(JSON.parse(l)));
  progress('walrus', 'writing', { contentSha256: 'f0457c30', blobId: undefined, registeredBy: null, publisher: '' });
  assert.deepEqual(lines[0].detail, { contentSha256: 'f0457c30' });
});

test('an unknown stage is a throw, not a silently mislabelled line', () => {
  const progress = createProgress(() => {});
  assert.throws(() => progress('uploading', 'not a stage'), /unknown stage/);
});

test('the reader and the emitter share one stage list', () => {
  // The contract the web loader is built against. If this list changes, it changes
  // in one place and this test is the reminder that something else reads it.
  assert.deepEqual(STAGES, ['resolving', 'licence', 'fetching', 'starting', 'reviewing', 'walrus', 'arkiv', 'done']);
});

// ---------------------------------------------------------------------------
// 5. through the API
// ---------------------------------------------------------------------------

const ingestEnv = {
  SUREX_MOCK: '1',
  SUREX_INGEST_URL: 'https://writer.test',
  SUREX_INGEST_TOKEN: 't0ken',
  SUREX_REVIEWER_MODEL: 'qwen3-coder-next:surex32k',
};

test('GET /v1/submissions/:id carries the writer progress through unchanged', async () => {
  const writerProgress = {
    stage: 'walrus',
    label: 'Blob 5PLd… certified',
    done: 6,
    total: 8,
    detail: { blobId: '-SzjTmxUSjs01bmC2AZ48iqz-fTCcllwcLu3nc2rb2Y', contentSha256: 'f0457c30', registeredBy: 'wallet' },
    at: '2026-07-25T20:00:00.000Z',
  };
  const app = createApp({
    logger: quiet,
    env: ingestEnv,
    fetchImpl: async () => new Response(
      JSON.stringify({ id: 'ing_1', status: 'running', startedAt: '2026-07-25T19:59:00Z', progress: writerProgress }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  });

  const res = await app.request('/v1/submissions/ing_1', { headers: { host: HOST } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.progress, writerProgress, 'forwarded verbatim — a second reshaping here is a second place to drift');
  assert.equal(res.headers.get('cache-control'), 'no-store', 'progress must never be cached');
});

test('a job with no progress yet reports none, rather than an invented stage', async () => {
  // A queued job has not started. The honest answer is the queue position, and a
  // fabricated "resolving" would be a screen claiming work that has not begun.
  const app = createApp({
    logger: quiet,
    env: ingestEnv,
    fetchImpl: async () => new Response(JSON.stringify({ id: 'ing_2', status: 'queued', queuePosition: 3 }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }),
  });
  const res = await app.request('/v1/submissions/ing_2', { headers: { host: HOST } });
  const body = await res.json();
  assert.equal(body.status, 'queued');
  assert.equal(body.queuePosition, 3);
  assert.equal('progress' in body, false);
});

test('progress and the failure stage are different fields and stay that way', async () => {
  // `progress.stage` is where the pipeline currently is; `stage` is where it failed. Merging
  // them would report a submission still writing its blob as one that failed at it.
  const app = createApp({
    logger: quiet,
    env: ingestEnv,
    fetchImpl: async () => new Response(
      JSON.stringify({
        id: 'ing_3',
        status: 'failed',
        error: 'the review completed but its evidence could not be stored',
        stage: 'walrus-write',
        progress: { stage: 'walrus', label: 'The storage nodes did not confirm — retrying (3 of 3)', done: 6, total: 8, detail: {} },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  });
  const res = await app.request('/v1/submissions/ing_3', { headers: { host: HOST } });
  const body = await res.json();
  assert.equal(body.stage, 'walrus-write');
  assert.equal(body.progress.stage, 'walrus');
  assert.match(body.error, /evidence could not be stored/);
});
