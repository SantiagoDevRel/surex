#!/usr/bin/env node
// One submitted repository, at one commit, all the way to a published verdict.
//
// This is the pipeline behind `POST /v1/submissions`. The deployed API checks the
// World ID proof and stops — it holds no wallet by design (worker/config.mjs) — so
// everything after the gate happens here, wherever the wallet is.
//
//   node scripts/ingest-submission.mjs --repo owner/name --commit <40-hex> [--release v1.2.3]
//   node scripts/ingest-submission.mjs --repo owner/name --commit <sha> --json --dry-run
//
// WHICH BYTES GET REVIEWED, and why it is not simply "the repo".
//
// A submission names a repository at a commit. What a *user* runs is almost never
// that: it is `npx -y <package>`, which fetches a tarball npm built from some
// commit the maintainer chose. The two can differ — that gap is the whole reason
// the `postmark-mcp` incident worked, and it is what Tier exists to describe. So:
//
//   · if the repository publishes to npm, the REVIEW is of the npm tarball (the
//     bytes that execute) and the commit is recorded as provenance beside it;
//   · if it does not, the review is of the repository at that commit, and the
//     entry is for a git-based install.
//
// Either way the record says which one it was. A verdict that does not say which
// bytes it read is a verdict about nothing.

import { writeFileSync, mkdirSync, mkdtempSync, existsSync, rmSync, readFileSync, readdirSync, statSync, accessSync, constants as fsConstants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

import { canonicalise, fingerprintOf, tierOf, SEVERITY_LABEL } from '../packages/core/index.mjs';
import { reviewServer, PROMPT_VERSION } from '../packages/reviewer/src/review.mjs';
import { resolveConfig } from '../packages/reviewer/src/model.mjs';
import { licenceGate } from '../packages/worker/index.mjs';
import {
  readPackage, readability, selectForReview, integrityMatches, REVIEW_LIMITS,
} from './review-known.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const JSON_OUT = argv.includes('--json');
const DRY = argv.includes('--dry-run');
const WEB = flag('--web', 'https://arkiv-surex.vercel.app');
const WORK = flag('--work', join(tmpdir(), 'surex-ingest'));

// The human log goes to stderr and always has. stdout is the machine channel.
const log = (...a) => console.error(...a);

// ---------------------------------------------------------------------------
// progress — what the pipeline is doing, while it is doing it
// ---------------------------------------------------------------------------
//
// A review is MINUTES. Without this, everything between "accepted" and a verdict
// URL is a spinner, and a screen with nothing true to say invents something —
// which is the exact class of lie this project exists to make impossible. So the
// pipeline says where it is, one JSON object per line, on stdout:
//
//   {"surexProgress":1,"stage":"walrus","label":"…","done":6,"total":8,"detail":{…}}
//
// stdout now carries TWO kinds of line, and exactly one field keeps them apart:
// the result line has `ok`, a progress line must NEVER have one. infra/dgx-ingest
// finds the result by scanning stdout backwards for the last line that HAS `ok`,
// so a progress line carrying one would be read as the pipeline's verdict and put
// a verdict URL in front of a maintainer for a review that was still running.
// `progress()` below cannot emit `ok`; stdout.mjs refuses any progress line that
// does. Both halves, because one of them alone is a comment.

/**
 * The canonical order. Shared with the reader — one list, so the two cannot drift.
 *
 * `starting` is RESERVED and this pipeline never emits it: it reads the tool list
 * out of the README (`toolSource: 'readme-only'` below) and does not run the
 * server. `scripts/review-known.mjs` is the pass that installs and starts one.
 * Announcing a stage that did not happen would be a fabricated fact on a progress
 * screen, so the slot stays empty rather than being filled with a plausible
 * sentence.
 */
export const STAGES = ['resolving', 'licence', 'fetching', 'starting', 'reviewing', 'walrus', 'arkiv', 'done'];

/**
 * @param {(line: string) => void} [write] injected so a test reads the lines
 *   instead of the ingest service.
 *
 * `done` is the stage's position in STAGES, held to never move backwards, and
 * `total` is the length of that list. Two consequences, both deliberate:
 *
 *   · A SKIPPED stage jumps the number forward. Unreadable source goes straight
 *     from `fetching` to `walrus`, and that jump is the honest reading:
 *     those stages will not happen for this submission.
 *   · The stages are not emitted in list order everywhere. This pipeline
 *     downloads the npm tarball BEFORE the licence gate, because the record for a
 *     licence-refused package names the artifact it would have read. So `fetching`
 *     can arrive before `licence`, and the clamp is what stops the bar going
 *     backwards when it does. Do not reorder the emissions to make the numbers
 *     tidy — that would mean announcing a gate before it ran.
 *
 * `done` is last in STAGES, so the terminal stage always reports `done === total`:
 * whatever route a run took, when it is finished it is finished.
 */
export function createProgress(write = (line) => process.stdout.write(line)) {
  let highest = 0;
  return function progress(stage, label, detail = {}) {
    const at = STAGES.indexOf(stage);
    if (at === -1) throw new Error(`unknown stage: ${stage}`);
    highest = Math.max(highest, at + 1);
    // Only facts that are ALREADY KNOWN travel here. An undefined or null value is
    // dropped rather than published, because `blobId: null` on a screen is not an
    // absent fact, it is a claim that there is no blob.
    const known = Object.fromEntries(
      Object.entries(detail).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    );
    write(`${JSON.stringify({ surexProgress: 1, stage, label, done: highest, total: STAGES.length, detail: known })}\n`);
  };
}

const progress = createProgress();

function done(payload, code = 0) {
  if (JSON_OUT) process.stdout.write(`${JSON.stringify(payload)}\n`);
  else log(JSON.stringify(payload, null, 2));
  process.exit(code);
}
const fail = (error, extra = {}) => done({ ok: false, error, ...extra }, 1);

// ---------------------------------------------------------------------------
// the source
// ---------------------------------------------------------------------------

const safe = (s) => String(s).replace(/[^a-z0-9._-]+/gi, '_');

/**
 * A directory we can definitely write, for one repo at one commit.
 *
 * The obvious version — `rmSync(dir, { force: true })` then `mkdirSync` — looks
 * safe and is not. `force: true` suppresses "does not exist"; it does NOT
 * suppress EACCES. So a leftover directory this process cannot delete takes the
 * whole run down, and the failure surfaces to a submitter as
 * "could not fetch <their repo>", which reads as a problem with their code.
 *
 * That is not hypothetical: a maintainer's submission died on
 * `EACCES /tmp/surex-ingest/SantiagoDevRel__mcp-medellin-news__b043470733f0`
 * because an operator had run the same pipeline by hand under sudo hours
 * earlier, leaving a root-owned directory at the path the service needed. The
 * deterministic name is what made it collide, and the name is worth keeping —
 * it makes a half-finished checkout obvious to whoever looks.
 *
 * So: try the canonical path, prove it is writable, and on ANY failure fall back
 * to a unique one rather than refusing to work. A stale directory is somebody
 * else's mess; it is not a reason to reject a submission.
 */
function freshDir(name) {
  const canonical = join(WORK, name);
  try {
    rmSync(canonical, { recursive: true, force: true });
    mkdirSync(canonical, { recursive: true });
    // `mkdirSync` on an existing directory we cannot write succeeds silently,
    // so writability is checked rather than assumed.
    accessSync(canonical, fsConstants.W_OK);
    return canonical;
  } catch (err) {
    const dir = mkdtempSync(join(WORK, `${name}__`));
    log(`  ! ${canonical} unusable (${err.code ?? err.message}) — using ${dir}`);
    return dir;
  }
}

/** The repository at exactly that commit. GitHub serves it as a tarball. */
function fetchRepoAtCommit(owner, repo, commit) {
  const dir = freshDir(`${safe(owner)}__${safe(repo)}__${commit.slice(0, 12)}`);
  // Relative filename with cwd set: GNU tar reads a Windows absolute path as a
  // remote host (FRICTION-LOG D8) and fails on every single archive.
  const url = `https://codeload.github.com/${owner}/${repo}/tar.gz/${commit}`;
  execFileSync('curl', ['-sSL', '--fail', '-o', 'repo.tar.gz', url], { cwd: dir, timeout: 120_000 });
  execFileSync('tar', ['-xzf', 'repo.tar.gz'], { cwd: dir, timeout: 120_000 });
  // GitHub roots the archive at `<repo>-<sha>/`, so the real tree is one level in.
  for (const entry of readdirSync(dir)) {
    if (entry === 'repo.tar.gz') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return full;
  }
  return dir;
}

async function npmMeta(name, version) {
  const url = version
    ? `https://registry.npmjs.org/${name.replace('/', '%2F')}/${encodeURIComponent(version)}`
    : `https://registry.npmjs.org/${name.replace('/', '%2F')}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) return null;
  const j = await res.json();
  const v = version ? j : (j.versions?.[j['dist-tags']?.latest] ?? {});
  return {
    name: j.name ?? name,
    version: v.version ?? j['dist-tags']?.latest ?? null,
    tarball: v.dist?.tarball ?? null,
    integrity: v.dist?.integrity ?? null,
    license: typeof v.license === 'string' ? v.license : (v.license?.type ?? null),
    repository: typeof v.repository === 'string' ? v.repository : (v.repository?.url ?? null),
  };
}

/** Download the npm tarball and verify it is the one npm published. */
async function fetchNpmTarball(name, meta) {
  const dir = freshDir(`${safe(name)}__${safe(meta.version)}`);
  const res = await fetch(meta.tarball);
  if (!res.ok) throw new Error(`tarball HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const check = integrityMatches(bytes, meta.integrity);
  if (check.checked && !check.ok) throw new Error(check.detail);
  writeFileSync(join(dir, 'package.tgz'), bytes);
  execFileSync('tar', ['-xzf', 'package.tgz'], { cwd: dir, timeout: 120_000 });
  const inner = join(dir, 'package');
  return { dir: existsSync(inner) ? inner : dir, integrityCheck: check };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) await main();

async function main() {
  const repoArg = String(flag('--repo', '')).trim();
  const commit = String(flag('--commit', '')).trim().toLowerCase();
  const release = flag('--release');
  const m = repoArg.match(/^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/);
  if (!m) fail('--repo must be owner/name');
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    // A tag is a label that can be repointed; a submission has to name bytes.
    fail('--commit must be a 40-character hex sha — a tag cannot pin bytes');
  }
  const [, owner, repo] = m;

  const config = resolveConfig();
  if (!config.baseUrl) fail('SUREX_REVIEWER_BASE_URL is unset — there is nothing to review against');

  mkdirSync(WORK, { recursive: true });
  log(`ingest ${owner}/${repo} @ ${commit.slice(0, 12)}${release ? ` (${release})` : ''}`);
  progress('resolving', `Reading ${owner}/${repo} at ${commit.slice(0, 7)}`, {
    repo: `${owner}/${repo}`,
    commit,
    release,
  });

  // 1. the repository, at that commit
  let repoDir;
  try {
    repoDir = fetchRepoAtCommit(owner, repo, commit);
  } catch (err) {
    fail(`could not fetch ${owner}/${repo} at ${commit.slice(0, 12)}: ${err.message}`);
  }

  let pkg = {};
  try { pkg = JSON.parse(readFileSync(join(repoDir, 'package.json'), 'utf8')); } catch { /* not a node package */ }

  // 2. what does a user actually install? That is what the entry is keyed on.
  const npmName = typeof pkg.name === 'string' ? pkg.name : null;
  const published = npmName ? await npmMeta(npmName, pkg.version) : null;
  const onNpm = Boolean(published?.tarball);

  const installConfig = onNpm
    ? { command: 'npx', args: ['-y', npmName] }
    : { command: 'npx', args: ['-y', `github:${owner}/${repo}`] };
  const canonical = canonicalise(installConfig);
  const fingerprint = fingerprintOf(canonical);
  const tier = tierOf(canonical);

  // The fingerprint is the id the verdict will be published under, so it is said
  // here rather than at the end — a watcher can open /r/<fp> before the review has
  // finished and see the entry appear under the name they were already given.
  progress(
    'resolving',
    onNpm
      ? `Published as ${npmName}@${published.version}`
      : 'Not published to npm — the repository is what a user installs',
    { repo: `${owner}/${repo}`, commit, package: npmName, version: published?.version, fingerprint, tier },
  );

  // 3. review the bytes that execute
  let sourceDir = repoDir;
  let integrityCheck = null;
  let reviewedArtifact = `github:${owner}/${repo}@${commit}`;
  if (onNpm) {
    progress('fetching', `Downloading the published tarball ${npmName}@${published.version}`, {
      artifact: `npm:${npmName}@${published.version}`,
    });
    try {
      const got = await fetchNpmTarball(npmName, published);
      sourceDir = got.dir;
      integrityCheck = got.integrityCheck;
      reviewedArtifact = `npm:${npmName}@${published.version}`;
      log(`  reviewing the published tarball ${reviewedArtifact} (integrity ${integrityCheck.detail})`);
      progress('fetching', `Reading ${reviewedArtifact}`, {
        artifact: reviewedArtifact,
        integrity: integrityCheck.detail,
      });
    } catch (err) {
      log(`  ! npm tarball unusable (${err.message}) — reviewing the repository at the submitted commit instead`);
      // The fallback is stated, not hidden. A verdict about the repository when the
      // user installs from npm is a different claim, and the screen says so while
      // it is happening rather than only in the record afterwards.
      progress('fetching', 'The npm tarball could not be read — reading the repository at the submitted commit', {
        artifact: reviewedArtifact,
      });
    }
  } else {
    log('  not published to npm — reviewing the repository at the submitted commit');
    progress('fetching', 'Reading the repository at the submitted commit', { artifact: reviewedArtifact });
  }

  /**
   * 4. Read the licence. RECORD it — do not refuse on it.
   *
   * The gate used to stop here: an unmatched or absent licence published
   * `unreviewable / licence` and the model never saw the code. That rule exists
   * to stop us REDISTRIBUTING source nobody licensed us to redistribute, and it
   * is the right rule for a path that stores source.
   *
   * This path does not store source. `publishOutcome` writes one blob and it is
   * the REVIEW BODY — our own words about the code, with file and line citations
   * to substantiate a finding. The repository is public and reading it is not
   * what a licence restricts. So the gate was refusing to review on the strength
   * of a concern this pipeline does not create, and the cost was real: a
   * maintainer submitting a perfectly good server got told nobody could review
   * it, for a LICENSE file.
   *
   * The licence is still established and still published — as a fact on the
   * entry, `none` when there is none — because "we reviewed this and its licence
   * is unknown" is information, and silence is not.
   *
   * NOTE the scope: `scripts/review-known.mjs` downloads and extracts npm
   * tarballs and DOES hold third-party bytes. Its gate stays.
   */
  progress('licence', 'Reading the licence', { artifact: reviewedArtifact });
  const gate = await licenceGate(
    {
      name: npmName ?? `${owner}/${repo}`,
      pkg: onNpm ? { registryType: 'npm', identifier: npmName, version: published.version } : null,
      repo: { url: `https://github.com/${owner}/${repo}` },
    },
    { fetchRepoFiles: true },
  );
  /**
   * What we will say the licence IS. Three distinct answers, kept apart because
   * they mean different things and collapsing them is how a record starts lying:
   *
   *   a recognised SPDX id   → that id
   *   read it, found nothing → `none`
   *   could not read it      → `unknown` (a request failed; not a claim)
   *
   * `undetermined` no longer aborts. It used to, on the sound principle that we
   * must not claim ineligibility off a failed request — but nothing is being
   * claimed ineligible any more, so the honest move is to record that we could
   * not tell and carry on.
   */
  const licence = gate.undetermined ? 'unknown' : (gate.spdx ?? 'none');
  progress(
    'licence',
    licence === 'unknown'
      ? 'Licence could not be read — recorded as unknown'
      : licence === 'none'
        ? 'No licence found — recorded as none, the review continues'
        : `Licence: ${licence}`,
    { spdx: licence },
  );

  // 5. can it be read at all?
  const files = readPackage(sourceDir);
  const read = readability(files);
  if (!read.readable) {
    progress('fetching', `The source cannot be read: ${read.reason}`, { artifact: reviewedArtifact });
    return publishOutcome({
      fingerprint, tier, state: 'unreviewable', reason: 'source-unavailable', why: read.reason,
      name: npmName ?? `${owner}/${repo}`, commit, release, reviewedArtifact, integrityCheck, licence, result: null,
    });
  }

  // 6. the review itself
  const readme = ['README.md', 'readme.md'].map((f) => join(repoDir, f)).find(existsSync);
  const statedIntent = {
    name: npmName ?? `${owner}/${repo}`,
    tools: [],
    toolSource: 'readme-only',
    readme: readme ? readFileSync(readme, 'utf8').slice(0, REVIEW_LIMITS.maxReadmeChars) : null,
  };
  const selection = selectForReview(files);

  // Named, not implied. The model and the prompt version are stamped on the
  // verdict forever, so whoever is watching sees the same two strings while the
  // reading is happening — and they are read from the same config the reviewer
  // itself uses, so the screen cannot drift from what actually ran.
  //
  // `run` is deliberately absent. reviewServer does two paraphrased readings, and
  // four when they disagree, but it does not report which one is in flight — and
  // an invented run number on a progress screen is an invented fact.
  progress('reviewing', `${config.modelId} is reading ${selection.kept.length} file(s)`, {
    model: config.modelId,
    promptVersion: PROMPT_VERSION,
    files: selection.kept.length,
  });

  const result = await reviewServer(
    { files: selection.kept, statedIntent },
    { config, limits: REVIEW_LIMITS, allowCache: false, writeCache: false },
  );

  // The RAW verdict does not go on this line, and that is not squeamishness. A flag
  // against a submitted third-party project is HELD a few lines below — published as
  // `unreviewable / withheld` with no findings, because a maintainer consented to a
  // review, not to an unaudited model publishing an accusation about them. Leaking
  // `flagged` through a progress line would publish exactly what that rule withholds,
  // through a door nobody was watching. What is published is what is said.
  progress('reviewing', `Read ${result.agreementRuns ?? 0} time(s) — merging the readings`, {
    model: result.modelId ?? config.modelId,
    promptVersion: result.promptVersion ?? PROMPT_VERSION,
    runs: result.agreementRuns,
  });

  const omitted = (result.run?.sourceCoverage?.filesOmittedOrTruncated ?? 0) + (selection.dropped?.length ?? 0);
  let state = result.verdict === 'clean' ? 'clean'
    : result.verdict === 'flagged' ? 'flagged' : 'unreviewable';
  let reason = state === 'unreviewable' ? (result.reason ?? 'no-agreement') : undefined;

  // A clean verdict claims the reviewer read the code. If it did not read all of
  // it, that claim is false rather than cautious.
  if (state === 'clean' && omitted > 0) {
    state = 'unreviewable';
    reason = 'partial-source';
  }

  /**
   * A flag against a THIRD PARTY is held. A flag against our own code is not.
   *
   * AGENTS.md §4 forbids publicly flagging a real, named third-party project on
   * the strength of an unaudited model verdict, and a maintainer submitting a
   * repository consented to a review, not to an accusation. That rule stands.
   *
   * It has never applied to code we own. `review-and-publish.mjs` publishes real
   * flags against our own fixtures for exactly this reason: we are the subject,
   * so there is nobody to protect from us. The submit path was holding those too,
   * which meant the owner could not get a flagged verdict about his own server —
   * the model read `mcp-medellin-news`, returned severity 3 with 11 findings, and
   * the entry published as `unreviewable / withheld` with none of them.
   *
   * `SUREX_SELF_OWNED` is the list of GitHub owners whose flags publish. It is a
   * deliberate allowlist and not a heuristic: getting this wrong in the other
   * direction publishes an accusation about somebody else.
   */
  const selfOwned = String(process.env.SUREX_SELF_OWNED ?? 'SantiagoDevRel')
    .split(',')
    .map((o) => o.trim().toLowerCase())
    .filter(Boolean);
  const ours = selfOwned.includes(String(owner).toLowerCase());

  if (state === 'flagged' && !ours) {
    state = 'unreviewable';
    reason = 'withheld';
  }

  return publishOutcome({
    fingerprint, tier, state, reason,
    why: result.notice ?? null,
    name: npmName ?? `${owner}/${repo}`,
    commit, release, reviewedArtifact, integrityCheck, licence, result,
    findings: result.findings ?? [],
  });
}

// ---------------------------------------------------------------------------
// writing it down
// ---------------------------------------------------------------------------

async function publishOutcome(o) {
  const summary = {
    ok: true,
    fingerprint: o.fingerprint,
    state: o.state,
    reason: o.reason ?? null,
    tier: o.tier,
    name: o.name,
    reviewedArtifact: o.reviewedArtifact,
    commit: o.commit,
    severity: o.result?.severity ?? 0,
    severityLabel: SEVERITY_LABEL[o.result?.severity ?? 0],
    findingCount: (o.findings ?? []).length,
    verdictUrl: `${WEB}/r/${o.fingerprint}`,
  };

  log(`  ${o.state}${o.reason ? ` (${o.reason})` : ''} · ${summary.findingCount} finding(s) · ${o.reviewedArtifact}`);
  if (DRY) {
    progress('done', 'Dry run — nothing was written on chain', { state: o.state, fingerprint: o.fingerprint });
    return done({ ...summary, published: false, note: 'dry run — nothing written on chain' });
  }

  const { createWalrusWriter, createArkivWriter, buildReviewRecord, buildVerdictHead, buildRegistryEntry, recordBytes, sha256Hex } =
    await import('../packages/worker/index.mjs');

  const body = {
    schema: 'surex.review/1',
    fingerprint: o.fingerprint,
    subject: o.reviewedArtifact,
    submittedCommit: o.commit,
    release: o.release ?? null,
    verdict: o.result?.verdict ?? 'unreviewable',
    publishedState: o.state,
    reason: o.reason ?? null,
    severity: o.result?.severity ?? 0,
    // A withheld verdict publishes NO findings. The state says a review ran and
    // its result is held; shipping the findings inside it would be publishing the
    // accusation while claiming not to.
    findings: o.reason === 'withheld' ? [] : (o.findings ?? []),
    statedIntentSummary: o.result?.statedIntentSummary ?? null,
    capabilities: o.result?.capabilities ?? null,
    sourceCoverage: o.result?.run?.sourceCoverage ?? null,
    npmIntegrity: o.integrityCheck?.detail ?? null,
    // An SPDX id, or `none` when we read and found nothing, or `unknown` when a
    // request failed. Published either way: "reviewed, licence none" is a fact a
    // reader can act on, and it used to be the reason there was no record at all.
    licence: o.licence ?? null,
    modelId: o.result?.modelId ?? null,
    promptVersion: o.result?.promptVersion ?? null,
    agreementRuns: o.result?.agreementRuns ?? 0,
    analyzedAt: new Date().toISOString(),
    disclosure:
      `Submitted by its maintainer and read statically by an open-source model from ${o.reviewedArtifact}; ` +
      'no human audited it. The commit above is what was submitted; the artifact named is what was read.',
  };

  const walrus = await createWalrusWriter({ log: () => {} });
  const arkiv = createArkivWriter({ log: (m) => log(m) });

  const bytes = recordBytes(body);

  // The content hash is OURS — computed from the bytes we are about to send, before
  // anyone else touches them. It is the one field a publisher cannot influence, and
  // it is what binds this record to its Arkiv entity, so it is said before the write
  // rather than reported back afterwards.
  const contentSha256 = sha256Hex(bytes);
  progress('walrus', `Writing the review blob (${bytes.length} B)`, { contentSha256 });

  /**
   * Writing a blob is a distributed write, and it can fail without anything being
   * wrong with the review.
   *
   * Measured on the first real submission: the review completed, reached a
   * verdict, and then `NotEnoughBlobConfirmationsError: Too many failures while
   * writing blob … to nodes` — the storage nodes did not confirm. That is a
   * property of the network on the day, not of the code being reviewed, and it
   * arrived as an uncaught exception with a stack trace, which tells whoever is
   * watching nothing about which half failed.
   *
   * So: retry, and if it still will not take, fail with a sentence that says the
   * review succeeded and the STORAGE did not. Those are different problems and
   * only one of them is worth re-reviewing for.
   */
  let pointer = null;
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      pointer = await walrus.writeRecord(bytes, { label: o.name });
      break;
    } catch (err) {
      lastError = err;
      log(`  walrus attempt ${attempt}/3 failed: ${err?.name ?? 'error'}`);
      // A retry is the honest reason a submission sits on this stage for half a
      // minute. Silence here reads as a hang, and a hang is what people refresh.
      if (attempt < 3) {
        progress('walrus', `The storage nodes did not confirm — retrying (${attempt + 1} of 3)`, {
          contentSha256,
          attempt: attempt + 1,
        });
        await new Promise((r) => setTimeout(r, 4000 * attempt));
      }
    }
  }
  if (!pointer) {
    return fail(
      'the review completed but its evidence could not be stored: Walrus did not confirm the blob write after ' +
      '3 attempts. Nothing was indexed, so there is no half-written record — the same submission can be retried.',
      { stage: 'walrus-write', reviewCompleted: true, verdict: o.state, detail: String(lastError?.message ?? lastError).slice(0, 300) },
    );
  }
  const evidence = { ...pointer, contentSha256 };
  log(`  walrus ${pointer.blobId}`);
  // `registeredBy` travels with the blob id because custody is part of the fact:
  // `wallet` means our key registered it, `publisher` means a public publisher's
  // did and the Sui object is theirs. Stated on both paths so it is read rather
  // than inferred from which fields happen to be present.
  progress('walrus', `Blob ${pointer.blobId} certified`, {
    blobId: pointer.blobId,
    contentSha256,
    registeredBy: pointer.registeredBy,
  });

  progress('arkiv', 'Indexing the review record and the registry entry', { fingerprint: o.fingerprint });
  const { created, txHashes } = await arkiv.createMany([
    buildReviewRecord({
      fingerprint: o.fingerprint,
      sourceKey: o.reviewedArtifact,
      verdict: o.result?.verdict ?? 'unreviewable',
      severity: o.result?.severity ?? 0,
      analyzedAt: Date.now(),
      modelId: o.result?.modelId, promptVersion: o.result?.promptVersion,
      blob: evidence,
    }),
    buildRegistryEntry({ fingerprint: o.fingerprint, name: o.name, tier: o.tier, blob: evidence }),
  ]);
  const reviewKey = created[0].key;
  // entityKey and txHash always describe the SAME write. Pairing the review
  // record's key with the head's transaction would send a reader to an explorer
  // page that does not contain the entity they were shown.
  progress('arkiv', 'Review record indexed', { entityKey: reviewKey, txHash: txHashes[0] });

  const head = await arkiv.createMany([
    buildVerdictHead({
      fingerprint: o.fingerprint,
      state: o.state === 'clean' ? 'clean' : 'unreviewable',
      reason: o.state === 'clean' ? undefined : o.reason,
      tier: o.tier,
      severity: o.state === 'clean' ? 0 : 0,
      name: o.name,
      latestReviewKey: o.state === 'clean' ? reviewKey : undefined,
      sourceKey: o.reviewedArtifact,
      reviewedCommit: o.commit,
      modelId: o.result?.modelId, promptVersion: o.result?.promptVersion,
      reviewedAt: new Date().toISOString(),
      capabilities: o.result?.capabilities,
      evidence,
      requireReviewForClean: true,
    }),
  ]);
  // The head is the entity the gate reads before a tool call, so it is the last
  // thing said before the verdict URL: from here the entry answers.
  progress('arkiv', 'Verdict head indexed', { entityKey: head.created[0]?.key, txHash: head.txHashes[0] });

  progress('done', `Published as ${o.state}${o.reason ? ` (${o.reason})` : ''}`, {
    state: o.state,
    reason: o.reason,
    fingerprint: o.fingerprint,
    verdictUrl: summary.verdictUrl,
  });
  return done({ ...summary, published: true, blobId: pointer.blobId, reviewKey });
}
