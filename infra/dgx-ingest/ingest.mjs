#!/usr/bin/env node
// The writer. A bearer-gated queue that runs the SureX ingest pipeline on the DGX.
// apps/api on Vercel holds no wallet — the read side cannot write, and that split is
// the only reason a compromised API cannot rewrite the registry — so the process that
// signs lives here instead.
//
//   listen   127.0.0.1:11600        (the tunnel is the only thing that talks to it)
//   runs     node scripts/ingest-submission.mjs --repo … --commit … [--release …] --json
//   auth     Authorization: Bearer <SUREX_INGEST_TOKEN>, compared timing-safely
//
// Three properties it exists to guarantee:
//
//   1. The request returns in milliseconds. A review is MINUTES, and a handler that
//      waits for one times out at every hop and gets retried mid-signing.
//   2. One job at a time, FIFO. One GPU and one wallet: two concurrent pipelines
//      sign two transaction sets at once.
//   3. A job survives `systemctl restart`.
//
// Node stdlib only, same as infra/dgx-reviewer/proxy.mjs.

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { timingSafeEqual, createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

// One invariant, held in its own file so a test can reach it without starting this
// server: the result line carries `ok`, a progress line never does.
import { drainLines, parseProgressLine, resultFrom } from './stdout.mjs';

// ── configuration ────────────────────────────────────────────────────────────

const PORT = Number(process.env.SUREX_INGEST_PORT ?? 11600);
const TOKEN = process.env.SUREX_INGEST_TOKEN ?? '';

/** Where the repo checkout lives on the box. The child runs with this as its cwd. */
const REPO_DIR = process.env.SUREX_INGEST_REPO_DIR || '/home/santiagodevrel/surex';

/**
 * The command, WITHOUT the per-job flags — those are appended as argv and never
 * interpolated into a string; there is no shell anywhere in this file. Two forms:
 *
 *   `node scripts/ingest-submission.mjs`          whitespace-separated
 *   `["node","-e","console.log('…')"]`            JSON argv, for anything with spaces
 *
 * Configurable so the service can be exercised against a stub that touches neither
 * the GPU nor the wallet.
 */
const RAW_CMD = process.env.SUREX_INGEST_CMD || 'node scripts/ingest-submission.mjs';

/** State file. `StateDirectory=surex` in the unit makes systemd create the directory. */
const STATE_FILE = process.env.SUREX_INGEST_STATE || '/var/lib/surex/ingest-jobs.json';

/** A hung review must not hold the queue forever. Twenty minutes, then SIGTERM. */
const TIMEOUT_MS = Number(process.env.SUREX_INGEST_TIMEOUT_MS ?? 20 * 60 * 1000);

/** Grace between SIGTERM and SIGKILL, so a well-behaved child can still clean up. */
const KILL_GRACE_MS = Number(process.env.SUREX_INGEST_KILL_GRACE_MS ?? 10_000);

/** A submission is four short fields. Anything larger is not one. */
const MAX_BODY_BYTES = 8 * 1024;

/** Enough of the tail to diagnose a crash, bounded so a chatty child cannot eat RAM. */
const MAX_STDOUT_BYTES = 256 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const STDERR_TAIL_CHARS = 4000;

/** Terminal jobs kept on disk. The file is a work log, not an archive. */
const MAX_HISTORY = 500;

if (!TOKEN || TOKEN.length < 24) {
  console.error('refusing to start: SUREX_INGEST_TOKEN is missing or too short');
  process.exit(1);
}

function parseCommand(raw) {
  const t = String(raw).trim();
  if (t.startsWith('[')) {
    const argv = JSON.parse(t);
    if (!Array.isArray(argv) || argv.length === 0 || argv.some((a) => typeof a !== 'string')) {
      throw new Error('SUREX_INGEST_CMD JSON form must be a non-empty array of strings');
    }
    return argv;
  }
  const argv = t.split(/\s+/).filter(Boolean);
  if (argv.length === 0) throw new Error('SUREX_INGEST_CMD is empty');
  return argv;
}

let BASE_ARGV;
try {
  BASE_ARGV = parseCommand(RAW_CMD);
} catch (err) {
  console.error(`refusing to start: ${err.message}`);
  process.exit(1);
}

// A job that cannot be persisted is the failure this service exists to prevent, so
// an unwritable state directory refuses to start rather than warning.
try {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
} catch (err) {
  console.error(`refusing to start: state directory is not writable (${err.code ?? err.message})`);
  process.exit(1);
}

// ── auth ─────────────────────────────────────────────────────────────────────

/** Hash both sides so timingSafeEqual never throws on a length mismatch. */
const digest = (s) => createHash('sha256').update(String(s)).digest();
const EXPECTED = digest(TOKEN);

function authorised(req) {
  const header = req.headers.authorization ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) return false;
  return timingSafeEqual(digest(m[1]), EXPECTED);
}

// ── validation ───────────────────────────────────────────────────────────────
//
// Every pattern starts with an alphanumeric: that is what stops a value beginning
// with `-` from reaching the child as a FLAG, and makes `..` unrepresentable in
// either half of a repo name. With no shell in this file, argument injection is the
// whole of the attack surface.

const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/i;
const RELEASE_RE = /^[A-Za-z0-9][A-Za-z0-9._+\-/]{0,99}$/;
const SUBMISSION_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** @returns {{ok:true,value:object}|{ok:false,error:string}} */
function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'body must be a JSON object: { repo, commit, release?, submissionId? }' };
  }
  const repo = typeof body.repo === 'string' ? body.repo.trim() : '';
  if (!REPO_RE.test(repo)) return { ok: false, error: 'repo must look like owner/name' };

  const commit = typeof body.commit === 'string' ? body.commit.trim() : '';
  if (!COMMIT_RE.test(commit)) return { ok: false, error: 'commit must be a 40-character hex sha' };

  let release = null;
  if (body.release !== undefined && body.release !== null && body.release !== '') {
    release = typeof body.release === 'string' ? body.release.trim() : '';
    if (!RELEASE_RE.test(release)) return { ok: false, error: 'release must be a plain tag name' };
  }

  let submissionId = null;
  if (body.submissionId !== undefined && body.submissionId !== null && body.submissionId !== '') {
    submissionId = typeof body.submissionId === 'string' ? body.submissionId.trim() : '';
    if (!SUBMISSION_RE.test(submissionId)) return { ok: false, error: 'submissionId is not a plain identifier' };
  }

  return { ok: true, value: { repo, commit: commit.toLowerCase(), release, submissionId } };
}

// ── redaction ────────────────────────────────────────────────────────────────

/**
 * The stderr tail is stored and returned, so anything shaped like a key is scrubbed
 * first. A bare 64-hex string goes too: a raw private key looks exactly like a
 * sha256. The pipeline's own result JSON is NOT passed through here — its
 * fingerprint and blob id are the answer, not a leak.
 */
function scrub(text) {
  return String(text)
    .replace(/suiprivkey1[a-z0-9]+/gi, '[redacted]')
    .replace(/0x[0-9a-fA-F]{64}\b/g, '[redacted]')
    .replace(/\b[0-9a-fA-F]{64}\b/g, '[redacted]')
    .replace(/((?:KEY|TOKEN|SECRET|PASSWORD|PRIVATE|SEED|MNEMONIC|PK)[A-Z_]*\s*[=:]\s*)\S+/gi, '$1[redacted]');
}

// ── job state ────────────────────────────────────────────────────────────────

/** @type {Map<string, object>} */
const jobs = new Map();
/** @type {string[]} */
const queue = [];
let activeId = null;
let activeChild = null;
let shuttingDown = false;

const now = () => new Date().toISOString();
const newId = () => `ing_${randomBytes(9).toString('hex')}`;
const log = (...a) => console.log(now(), ...a);

function persist() {
  // Terminal jobs are pruned oldest-first; queued and running ones are never dropped.
  const all = [...jobs.values()];
  const live = all.filter((j) => j.status === 'queued' || j.status === 'running');
  const terminal = all
    .filter((j) => j.status === 'done' || j.status === 'failed')
    .sort((a, b) => String(a.queuedAt).localeCompare(String(b.queuedAt)))
    .slice(-MAX_HISTORY);
  const keep = [...live, ...terminal];
  if (keep.length !== all.length) {
    const keepIds = new Set(keep.map((j) => j.id));
    for (const id of [...jobs.keys()]) if (!keepIds.has(id)) jobs.delete(id);
  }
  const payload = JSON.stringify({ version: 1, savedAt: now(), jobs: keep });
  try {
    // tmp + rename: a crash mid-write must not leave a truncated file that loses
    // every job at the next boot.
    const tmp = `${STATE_FILE}.tmp`;
    writeFileSync(tmp, payload, { mode: 0o600 });
    renameSync(tmp, STATE_FILE);
  } catch (err) {
    log(`state write failed: ${err.code ?? err.message}`);
  }
}

function restore() {
  let raw;
  try {
    raw = readFileSync(STATE_FILE, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') log(`state read failed: ${err.code ?? err.message}`);
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    log('state file is not valid JSON; starting with an empty queue');
    return;
  }
  for (const j of parsed?.jobs ?? []) {
    if (!j?.id) continue;
    if (j.status === 'running') {
      // The child died with the process, and is NOT re-run: it may already have
      // written a blob or signed an Arkiv transaction, so a silent second run would
      // double-write the registry.
      j.status = 'failed';
      j.finishedAt = now();
      j.error =
        'interrupted by a restart while the pipeline was running — it may have partially ' +
        'written. Check the registry for this commit before re-submitting.';
      j.interrupted = true;
    }
    jobs.set(j.id, j);
    // Queued jobs never started, so nothing was signed and re-queueing is safe.
    if (j.status === 'queued') queue.push(j.id);
  }
  const q = queue.length;
  const total = jobs.size;
  log(`restored ${total} job${total === 1 ? '' : 's'} from state, ${q} re-queued`);
  persist();
}

// ── the queue ────────────────────────────────────────────────────────────────

function pump() {
  // Never start a pipeline we are about to kill — it would sign into a process with
  // seconds to live.
  if (shuttingDown) return;
  if (activeId) return;
  const id = queue.shift();
  if (!id) return;
  const job = jobs.get(id);
  if (!job || job.status !== 'queued') return pump();
  run(job);
}

function run(job) {
  activeId = job.id;
  job.status = 'running';
  job.startedAt = now();
  persist();
  log(`job ${job.id} running`);

  const argv = [
    ...BASE_ARGV.slice(1),
    '--repo', job.repo,
    '--commit', job.commit,
    ...(job.release ? ['--release', job.release] : []),
    '--json',
  ];

  // The child needs the wallet and reviewer env, never the front door's bearer.
  const childEnv = { ...process.env };
  delete childEnv.SUREX_INGEST_TOKEN;

  let child;
  try {
    child = spawn(BASE_ARGV[0], argv, {
      cwd: REPO_DIR,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false, // explicit: repo/commit came off the network
    });
  } catch (err) {
    return finish(job, { error: `could not start the pipeline: ${err.code ?? err.message}` });
  }
  activeChild = child;

  let out = '';
  let err = '';
  /**
   * What is left of a line that arrived cut in half. Separate from `out`, which is a
   * capped TAIL kept for resultFrom(): a review long enough to overflow 256 KB would
   * lose its early stages if progress were read from there instead of off the stream.
   */
  let carry = '';
  child.stdout.on('data', (b) => {
    out = (out + b).slice(-MAX_STDOUT_BYTES);
    const drained = drainLines(carry, b);
    carry = drained.carry;
    for (const line of drained.lines) {
      const progress = parseProgressLine(line);
      if (progress) noteProgress(job, progress);
    }
  });
  child.stderr.on('data', (b) => {
    err = (err + b).slice(-MAX_STDERR_BYTES);
  });

  let timedOut = false;
  let killer = null;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    killer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
  }, TIMEOUT_MS);

  child.on('error', (e) => {
    clearTimeout(timer);
    if (killer) clearTimeout(killer);
    finish(job, { stdout: out, stderr: err, error: `pipeline failed to run: ${e.code ?? e.message}` });
  });

  child.on('close', (code, signal) => {
    clearTimeout(timer);
    if (killer) clearTimeout(killer);
    finish(job, {
      stdout: out,
      stderr: err,
      code,
      signal,
      error: timedOut ? `the pipeline exceeded ${TIMEOUT_MS} ms and was killed` : null,
    });
  });
}

/**
 * Keep the LATEST progress line on the job, and persist only when the STAGE changes:
 * a stage speaks more than once as its facts land, and persist() serialises every
 * job plus a write and a rename of the state file. Stage granularity loses nothing —
 * restore() FAILS a running job rather than resuming it, so persisted progress is
 * only ever read as "how far it had got"; the finer detail is served from memory.
 *
 * A job that is no longer running is left alone: a straggling `data` event after
 * finish() must not reopen a terminal job or trigger a write for it.
 */
function noteProgress(job, progress) {
  if (job.status !== 'running') return;
  const stageChanged = job.progress?.stage !== progress.stage;
  job.progress = { ...progress, at: now() };
  if (stageChanged) {
    log(`job ${job.id} ${progress.stage}${progress.done ? ` (${progress.done}/${progress.total})` : ''}`);
    persist();
  }
}

function finish(job, { stdout = '', stderr = '', code = null, signal = null, error = null } = {}) {
  /**
   * First writer wins; everything after it is dropped. Two paths reach here for the
   * same job:
   *
   *   - a failed spawn emits BOTH `error` and `close`. Running the tail of this
   *     function twice clears `activeId` twice and lets pump() start a SECOND
   *     pipeline alongside the first, which concurrency 1 does not survive.
   *   - on shutdown the job is already marked interrupted, and the child's SIGTERM
   *     close would relabel it as an ordinary exit 143, losing the "may have
   *     partially written" warning.
   */
  if (job.status !== 'running') return;

  const result = resultFrom(stdout);
  job.finishedAt = now();
  job.exitCode = code;
  if (signal) job.signal = signal;

  if (error) {
    job.status = 'failed';
    job.error = error;
  } else if (code === 0 && result?.ok === true) {
    job.status = 'done';
    job.result = result;
  } else if (result && result.ok === false) {
    // The pipeline reported its own failure. Its message beats anything invented here.
    job.status = 'failed';
    job.error = String(result.error ?? 'the pipeline reported a failure without a reason');
  } else if (code === 0) {
    // Exit 0 and no parseable result is NOT a success: reporting it as one puts a
    // verdict URL in front of a maintainer for a review that never happened.
    job.status = 'failed';
    job.error = 'the pipeline exited 0 but printed no JSON result';
  } else {
    job.status = 'failed';
    job.error = `the pipeline exited ${code}${signal ? ` on ${signal}` : ''}`;
  }

  if (job.status === 'failed') {
    const tail = scrub(stderr).trim().slice(-STDERR_TAIL_CHARS);
    if (tail) job.stderrTail = tail;
  }

  const ms = Date.parse(job.finishedAt) - Date.parse(job.startedAt ?? job.finishedAt);
  log(`job ${job.id} ${job.status} exit=${code ?? 'n/a'} ${ms}ms`);
  activeId = null;
  activeChild = null;
  persist();
  pump();
}

// ── http ─────────────────────────────────────────────────────────────────────

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const deny = (res, status, message) => send(res, status, { error: { code: status, message } });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** What a caller is allowed to see. Never the raw stdout, never the environment. */
function publicJob(job) {
  const view = {
    id: job.id,
    status: job.status,
    repo: job.repo,
    commit: job.commit,
    release: job.release ?? null,
    submissionId: job.submissionId ?? null,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt ?? null,
    finishedAt: job.finishedAt ?? null,
  };
  // Served for terminal jobs too: on a failure the last stage reached separates "the
  // review never ran" from "the review ran and the storage did not".
  if (job.progress) view.progress = job.progress;
  if (job.status === 'queued') {
    const at = queue.indexOf(job.id);
    // Position among the jobs still WAITING — the running one is not counted, so `1`
    // means "next".
    view.queuePosition = at === -1 ? null : at + 1;
  }
  if (job.status === 'done') view.result = job.result;
  if (job.status === 'failed') {
    view.error = job.error;
    if (job.exitCode !== null && job.exitCode !== undefined) view.exitCode = job.exitCode;
    if (job.stderrTail) view.stderrTail = job.stderrTail;
    if (job.interrupted) view.interrupted = true;
  }
  return view;
}

async function handle(req, res) {
  const path = (req.url ?? '/').split('?')[0].replace(/\/+$/, '') || '/';

  // Unauthenticated liveness, deliberately uninformative: the front door is up, and
  // nothing about what is behind it.
  if (path === '/healthz') return send(res, 200, { ok: true });

  if (!authorised(req)) {
    log(`401 ${req.method} ${path}`);
    return deny(res, 401, 'a bearer token is required');
  }

  if (path === '/v1/ingest' && req.method === 'POST') return enqueue(req, res);

  const m = /^\/v1\/ingest\/([A-Za-z0-9_]{1,64})$/.exec(path);
  if (m && req.method === 'GET') {
    const job = jobs.get(m[1]);
    if (!job) {
      log(`404 GET ${path} (no such job)`);
      return deny(res, 404, 'no such job');
    }
    log(`200 GET /v1/ingest/:id`);
    return send(res, 200, publicJob(job));
  }

  // Same allowlist posture as the reviewer proxy: anything not named above is a 404.
  log(`404 ${req.method} ${path}`);
  return deny(res, 404, 'this path is not served');
}

async function enqueue(req, res) {
  let raw;
  try {
    raw = await readBody(req);
  } catch {
    log('413 POST /v1/ingest');
    return deny(res, 413, 'body too large');
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    log('400 POST /v1/ingest (unparseable)');
    return deny(res, 400, 'body must be JSON');
  }

  const checked = validate(body);
  if (!checked.ok) {
    // The reason is echoed; the body never is.
    log('400 POST /v1/ingest (invalid)');
    return deny(res, 400, checked.error);
  }
  const { repo, commit, release, submissionId } = checked.value;

  // A repeat of a job already waiting or running gets that job back rather than a
  // second one: two runs of the same commit would sign the same writes twice.
  for (const j of jobs.values()) {
    if ((j.status === 'queued' || j.status === 'running') && j.repo === repo && j.commit === commit) {
      log(`202 POST /v1/ingest (deduped onto ${j.id})`);
      res.setHeader('location', `/v1/ingest/${j.id}`);
      return send(res, 202, { id: j.id, status: j.status, statusUrl: `/v1/ingest/${j.id}`, deduped: true });
    }
  }

  const job = {
    id: newId(),
    status: 'queued',
    repo,
    commit,
    release,
    submissionId,
    queuedAt: now(),
    startedAt: null,
    finishedAt: null,
  };
  jobs.set(job.id, job);
  queue.push(job.id);
  persist();
  log(`202 POST /v1/ingest → job ${job.id} (queued, position ${queue.indexOf(job.id) + 1})`);

  res.setHeader('location', `/v1/ingest/${job.id}`);
  send(res, 202, {
    id: job.id,
    status: 'queued',
    statusUrl: `/v1/ingest/${job.id}`,
    queuePosition: queue.indexOf(job.id) + 1,
  });

  // Started only after the 202 is on the wire, so the pipeline can never delay it.
  setImmediate(pump);
}

const server = createServer((req, res) => {
  // One malformed request must not take the process down and stop the queue.
  Promise.resolve()
    .then(() => handle(req, res))
    .catch((err) => {
      log(`500 ${req.method} ${(req.url ?? '/').split('?')[0]} ${err?.message}`);
      if (!res.headersSent) deny(res, 500, 'ingest error');
      else res.end();
    });
});

function shutdown(signal) {
  log(`${signal} received`);
  shuttingDown = true;
  if (activeId) {
    const job = jobs.get(activeId);
    if (job && job.status === 'running') {
      job.status = 'failed';
      job.finishedAt = now();
      job.interrupted = true;
      job.error =
        `interrupted by ${signal} while the pipeline was running — it may have partially ` +
        'written. Check the registry for this commit before re-submitting.';
    }
  }
  if (activeChild) activeChild.kill('SIGTERM');
  persist();
  server.close(() => process.exit(0));
  // The socket close can outlive a hung keep-alive; do not wait forever for it.
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

restore();
server.listen(PORT, '127.0.0.1', () => {
  // The BOUND port, not the configured one: they differ whenever `PORT` is 0, which
  // is how the service is exercised against a stub without claiming a fixed port.
  log(`surex ingest on 127.0.0.1:${server.address()?.port ?? PORT}`);
  log(`repo dir ${REPO_DIR} · state ${STATE_FILE} · timeout ${TIMEOUT_MS}ms · concurrency 1`);
  pump();
});
