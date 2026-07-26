// The writer service, running for real, against a stub pipeline.
//
// `ingest-progress.test.mjs` holds the parsing to its contract; this one proves the
// contract is WIRED: a real child process, a real socket, a real state file, and
// progress that survives a chunked stdout write through to `GET /v1/ingest/:id`.
// No GPU, no wallet, nothing on chain.
//
// Every assertion is made on the job's FINAL view, never on a poll that caught a
// stage mid-flight — sampling a running pipeline fails on a loaded machine for
// reasons unrelated to the code. Each stub makes the fact under test the LAST thing
// it said.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVICE = resolve(HERE, '../../../infra/dgx-ingest/ingest.mjs');
const TOKEN = 'test-token-0123456789abcdefghijklmn';
const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

const PROGRESS = (over) => `JSON.stringify(${JSON.stringify({ surexProgress: 1, total: 8, detail: {}, ...over })})`;
const RESULT = JSON.stringify({ ok: true, fingerprint: 'sxf1_stub', state: 'clean', blobId: 'blob-1', verdictUrl: 'https://x/r/sxf1_stub' });

/**
 * Start the service on an ephemeral port, with a stub for a pipeline.
 * `SUREX_INGEST_CMD` is configurable for exactly this reason.
 */
function startService(t, stubSource) {
  const dir = mkdtempSync(join(tmpdir(), 'surex-ingest-test-'));
  const stub = join(dir, 'stub.mjs');
  writeFileSync(stub, stubSource);
  const state = join(dir, 'ingest-jobs.json');

  /** @type {import('node:child_process').ChildProcess} */
  const child = spawn(process.execPath, [SERVICE], {
    env: {
      ...process.env,
      SUREX_INGEST_TOKEN: TOKEN,
      SUREX_INGEST_PORT: '0',
      SUREX_INGEST_STATE: state,
      SUREX_INGEST_REPO_DIR: dir,
      SUREX_INGEST_CMD: JSON.stringify([process.execPath, stub]),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    child.kill();
    // Retried AND swallowed, for the SIGKILL case on Windows: a killed process's
    // handles are released asynchronously there, so `rmSync` throws EBUSY just
    // after the kill. The retries cover the ordinary case, the catch covers a busy
    // full-suite run. POSIX unlinks an open file happily and never sees this.
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    } catch { /* windows file locks */ }
  });

  let log = '';
  child.stdout.on('data', (b) => { log += b; });
  child.stderr.on('data', (b) => { log += b; });

  async function ready() {
    for (let i = 0; i < 600; i += 1) {
      const m = /surex ingest on 127\.0\.0\.1:(\d+)/.exec(log);
      if (m) return `http://127.0.0.1:${m[1]}`;
      if (child.exitCode !== null) break;
      await sleep(25);
    }
    throw new Error(`the service did not start: ${log}`);
  }

  return { ready, state, child, logOf: () => log };
}

/** Submit one, then wait for it to stop moving. Only the final view is asserted on. */
async function runOne(base, commit = 'a'.repeat(40)) {
  const accepted = await fetch(`${base}/v1/ingest`, {
    method: 'POST', headers: auth, body: JSON.stringify({ repo: 'acme/mcp', commit }),
  });
  assert.equal(accepted.status, 202);
  const { id } = await accepted.json();
  assert.ok(id, 'a queued job comes back with an id');

  for (let i = 0; i < 600; i += 1) {
    const res = await fetch(`${base}/v1/ingest/${id}`, { headers: auth });
    assert.equal(res.status, 200);
    const view = await res.json();
    if (view.status === 'done' || view.status === 'failed') return { id, view };
    await sleep(25);
  }
  throw new Error('the job never reached a terminal state');
}

test('a progress line split MID-OBJECT across two writes still reaches the job view', async (t) => {
  // The stub writes 18 bytes, yields, then writes the rest, so the parent genuinely
  // receives half a JSON object in one `data` event — parsing per chunk looks
  // correct by inspection and only shows up as stages going missing at random.
  // One progress line only, so "the last thing it said" IS the line under test.
  const service = startService(t, `
    const write = (s) => new Promise((r) => process.stdout.write(s, r));
    const line = ${PROGRESS({ stage: 'resolving', label: 'Reading acme/mcp', done: 1, detail: { repo: 'acme/mcp' } })};
    await write(line.slice(0, 18));
    await new Promise((r) => setTimeout(r, 40));
    await write(line.slice(18) + '\\n');
    await write(${JSON.stringify(RESULT)} + '\\n');
  `);
  const base = await service.ready();
  const { view } = await runOne(base);

  assert.equal(view.status, 'done', `stub should have succeeded — service log:\n${service.logOf()}`);
  assert.ok(view.progress, 'the split line went missing entirely');
  assert.equal(view.progress.stage, 'resolving');
  assert.equal(view.progress.done, 1);
  assert.equal(view.progress.detail.repo, 'acme/mcp', 'and it was rejoined intact, not truncated at the split');

  // The other half of the same invariant: that progress line did not become the result.
  assert.equal(view.result.ok, true);
  assert.equal(view.result.fingerprint, 'sxf1_stub');
});

test('the result is found past every progress line, and junk between them is ignored', async (t) => {
  const service = startService(t, `
    const write = (s) => new Promise((r) => process.stdout.write(s, r));
    await write(${PROGRESS({ stage: 'resolving', label: 'reading', done: 1 })} + '\\n');
    await write('ingest acme/mcp @ 0f2c1b — a human log line on the wrong stream\\n');
    await write(${PROGRESS({ stage: 'reviewing', label: 'the model is reading', done: 5, detail: { model: 'stub-model' } })} + '\\n');
    await write('{"surexProgress":1,"stage":"walrus","truncated\\n');
    await write(${PROGRESS({ stage: 'walrus', label: 'writing', done: 6 })} + '\\n');
    await write(${PROGRESS({ stage: 'walrus', label: 'written', done: 6, detail: { blobId: 'blob-1', registeredBy: 'wallet' } })} + '\\n');
    await write(${PROGRESS({ stage: 'done', label: 'Published as clean', done: 8, detail: { state: 'clean' } })} + '\\n');
    await write(${JSON.stringify(RESULT)} + '\\n');
  `);
  const base = await service.ready();
  const { id, view } = await runOne(base);

  assert.equal(view.status, 'done', `service log:\n${service.logOf()}`);
  assert.equal(view.result.ok, true, 'seven progress lines did not hide the result');

  // The last word is the last thing the pipeline said, with the facts that stage knew.
  assert.equal(view.progress.stage, 'done');
  assert.equal(view.progress.done, 8);
  assert.equal(view.progress.total, 8);
  assert.equal(view.progress.detail.state, 'clean');
  assert.ok(view.progress.at, 'and when it said it');

  // Persisted, so a restart can still say how far it got.
  const saved = JSON.parse(readFileSync(service.state, 'utf8')).jobs.find((j) => j.id === id);
  assert.ok(saved.progress, 'progress reaches the state file');
  assert.equal(saved.progress.stage, 'done');
});

test('a pipeline that prints progress and then dies is a FAILURE, never a verdict', async (t) => {
  // What the `ok` discriminator exists to prevent: the stub prints two good
  // progress lines and exits 1 without a result, so the job must come back `failed`
  // with no `result` — never a verdict URL for a review that never finished.
  const service = startService(t, `
    process.stdout.write(${PROGRESS({ stage: 'reviewing', label: 'reading', done: 5 })} + '\\n');
    process.stdout.write(${PROGRESS({ stage: 'walrus', label: 'writing', done: 6 })} + '\\n');
    process.stderr.write('NotEnoughBlobConfirmationsError\\n');
    process.exit(1);
  `);
  const base = await service.ready();
  const { view } = await runOne(base, 'b'.repeat(40));

  assert.equal(view.status, 'failed');
  assert.equal(view.result, undefined, 'no progress line may be served as the pipeline result');
  assert.equal(view.exitCode, 1);
  // The progress it DID print is kept, and it advanced: reviewing then walrus. On a
  // failure that is the difference between re-reviewing and retrying the storage.
  assert.equal(view.progress.stage, 'walrus');
  assert.equal(view.progress.done, 6);
});

test('the stage a job was on survives a HARD kill of the service', async (t) => {
  // What persisting on a stage CHANGE buys: SIGKILL runs no shutdown handler and no
  // finish(), so `reviewing` being on disk afterwards means the stage transition
  // wrote it while the pipeline was still running. restore() marks an interrupted
  // job FAILED rather than re-running it (it may already have signed something), so
  // "it was reviewing" vs "it was writing to Arkiv" is what tells a human whether to
  // check the registry before re-submitting.
  const service = startService(t, `
    process.stdout.write(${PROGRESS({ stage: 'reviewing', label: 'the model is reading', done: 5, detail: { model: 'stub-model' } })} + '\\n');
    setTimeout(() => {}, 60_000);
  `);
  const base = await service.ready();

  const accepted = await fetch(`${base}/v1/ingest`, {
    method: 'POST', headers: auth, body: JSON.stringify({ repo: 'acme/mcp', commit: 'd'.repeat(40) }),
  });
  const { id } = await accepted.json();

  // The stub parks on `reviewing` and stays there, so waiting for it is not a race:
  // it is waiting for a state that does not move on.
  let view = null;
  for (let i = 0; i < 600; i += 1) {
    view = await (await fetch(`${base}/v1/ingest/${id}`, { headers: auth })).json();
    if (view.progress?.stage === 'reviewing') break;
    await sleep(25);
  }
  assert.equal(view.progress?.stage, 'reviewing', `never saw the stage — service log:\n${service.logOf()}`);
  assert.equal(view.status, 'running');

  // No SIGTERM: nothing gets to tidy up, exactly as a power cut or an OOM kill.
  service.child.kill('SIGKILL');
  for (let i = 0; i < 200 && service.child.exitCode === null && service.child.signalCode === null; i += 1) await sleep(25);

  const saved = JSON.parse(readFileSync(service.state, 'utf8')).jobs.find((j) => j.id === id);
  assert.equal(saved.status, 'running', 'the file is the one written mid-run, before any finish()');
  assert.equal(saved.progress?.stage, 'reviewing', 'the stage was written to disk when it changed, not at the end');
});

test('exit 0 with progress but no result is still a failure', async (t) => {
  // Progress is not evidence that anything was published. A pipeline that announced
  // every stage and then exited without printing a verdict has still not produced
  // one, and the service must not let the stages stand in for it.
  const service = startService(t, `
    process.stdout.write(${PROGRESS({ stage: 'done', label: 'Published as clean', done: 8, detail: { state: 'clean' } })} + '\\n');
  `);
  const base = await service.ready();
  const { view } = await runOne(base, 'c'.repeat(40));

  assert.equal(view.status, 'failed');
  assert.match(view.error, /exited 0 but printed no JSON result/);
  assert.equal(view.result, undefined);
  assert.equal(view.progress.stage, 'done', 'the claim it made is still visible, it is just not believed');
});
