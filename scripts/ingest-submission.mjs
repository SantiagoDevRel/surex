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

import { canonicalise, fingerprintOf, SEVERITY_LABEL } from '../packages/core/index.mjs';
import { reviewServer, PROMPT_VERSION } from '../packages/reviewer/src/review.mjs';
import { resolveConfig } from '../packages/reviewer/src/model.mjs';
import {
  licenceGate, planPublication, submissionPinning, fallbackPlan, isSelfAuthored,
} from '../packages/worker/index.mjs';
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

  // The fingerprint is the id the verdict will be published under, so it is said
  // here rather than at the end — a watcher can open /r/<fp> before the review has
  // finished and see the entry appear under the name they were already given.
  //
  // The TIER is deliberately not on this line. It depends on which artifact is
  // actually read and whether its digest verifies, and neither is known yet;
  // announcing one here would mean revising it two stages later.
  progress(
    'resolving',
    onNpm
      ? `Published as ${npmName}@${published.version}`
      : 'Not published to npm — the repository is what a user installs',
    { repo: `${owner}/${repo}`, commit, package: npmName, version: published?.version, fingerprint },
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
   * What this submission actually pinned, now that the artifact is known.
   *
   * This used to be `tierOf(canonical)`, computed before the fetch, and it always
   * returned `C` — "nothing was checked" — on a submission that named a
   * 40-character commit sha. Something was checked. `submissionPinning` says what,
   * and hands back the digest that earns the tier, or none where recording one
   * would put a git sha where the gate expects an npm integrity.
   */
  const pinning = submissionPinning({
    onNpm,
    reviewedNpmTarball: reviewedArtifact.startsWith('npm:'),
    npmIntegrity: published?.integrity ?? null,
    integrityVerified: Boolean(integrityCheck?.checked && integrityCheck?.ok),
    commit,
  });
  const tier = pinning.tier;
  progress('fetching', `Reviewing ${reviewedArtifact} — tier ${tier}`, {
    artifact: reviewedArtifact,
    tier,
    tierBasis: pinning.basis,
  });

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
      fingerprint, tier, pinning, verdict: 'unreviewable', reason: 'source-unavailable', why: read.reason,
      name: npmName ?? `${owner}/${repo}`, commit, release, reviewedArtifact, integrityCheck, licence,
      result: null, ours: false,
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
  let verdict = ['clean', 'flagged', 'unreviewable'].includes(result.verdict) ? result.verdict : 'unreviewable';
  let reason = result.reason ?? null;

  // A clean verdict claims the reviewer read the code. If it did not read all of
  // it, that claim is false rather than cautious.
  if (verdict === 'clean' && omitted > 0) {
    verdict = 'unreviewable';
    reason = 'partial-source';
  }

  /**
   * A flag against a THIRD PARTY is held. A flag against our own code is not.
   *
   * AGENTS.md §4 forbids publicly flagging a real, named third-party project on
   * the strength of an unaudited model verdict, and a maintainer submitting a
   * repository consented to a review, not to an accusation. That rule stands, and
   * it is enforced twice: `planPublication` will not PLAN a flag that the write
   * boundary would refuse, and `buildVerdictHead` refuses one regardless.
   *
   * It has never applied to code we own. `review-and-publish.mjs` publishes real
   * flags against our own fixtures for exactly this reason: we are the subject, so
   * there is nobody to protect from us.
   *
   * `SUREX_SELF_OWNED` is the list of GitHub owners whose flags publish. It is set
   * by the OPERATOR, in the environment of the box that holds the wallet — a
   * submitter chooses a repository, never whose repositories count as ours. And
   * the owner is not a claim in the submission: the bytes were just fetched from
   * `github.com/<owner>/…`, which nobody else can publish under.
   *
   * It is ONE of two locks and never both. The other is the fingerprint allowlist
   * the write boundary reads, which a human curates off the request path
   * (`scripts/allow-self-authored.mjs`). The pipeline deliberately does NOT add to
   * it: `owner` is not proof of authorship, because GitHub serves every commit in
   * a repository's fork network from the upstream namespace — anyone who can push
   * to a fork of one of our public repos gets a sha that resolves under our owner,
   * and with it the choice of which fingerprint would be flagged. See the long
   * note in packages/worker/src/entities.mjs.
   *
   * So a self-owned flag publishes only when an operator has already vouched for
   * that fingerprint. Until then it is WITHHELD — the safe direction, and an
   * honest state rather than a crash.
   */
  const selfOwned = String(process.env.SUREX_SELF_OWNED ?? 'SantiagoDevRel')
    .split(',')
    .map((o) => o.trim().toLowerCase())
    .filter(Boolean);
  const ours = selfOwned.includes(String(owner).toLowerCase());

  if (verdict === 'flagged' && ours && !isSelfAuthored(fingerprint)) {
    // Said out loud, because the difference between "we protected a third party"
    // and "an operator has not vouched for our own server yet" is invisible in the
    // published entry — both are `unreviewable / withheld` — and only one of them
    // is something to act on.
    log(`  ! ${fingerprint} is under a self-owned repo but is not on the self-authored`);
    log('    allowlist, so the flag will be withheld. To publish it, vouch for the');
    log(`    fingerprint deliberately: node scripts/allow-self-authored.mjs ${fingerprint}`);
  }

  return publishOutcome({
    fingerprint, tier, pinning, verdict, reason, ours,
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
  /**
   * One decision, taken once, in a module with a test that walks every verdict
   * and asserts the write boundary accepts the result. Everything below — the
   * review record, the blob body, the head — is rendered FROM this plan rather
   * than each re-deciding from `o.verdict` on its own. That divergence is what
   * killed two live submissions: the state was computed in one place and the head
   * was written from a second expression that had drifted away from it.
   */
  const plan = planPublication({
    verdict: o.verdict,
    reason: o.reason,
    severity: o.result?.severity ?? 0,
    findings: o.findings ?? [],
    concern: o.result?.concern ?? null,
    assessment: o.result?.assessment ?? null,
    statedIntentSummary: o.result?.statedIntentSummary ?? null,
    fingerprint: o.fingerprint,
    selfOwned: Boolean(o.ours),
  });

  const summary = {
    ok: true,
    fingerprint: o.fingerprint,
    state: plan.state,
    reason: plan.reason ?? null,
    tier: o.tier,
    tierBasis: o.pinning?.basis,
    name: o.name,
    reviewedArtifact: o.reviewedArtifact,
    commit: o.commit,
    // What was PUBLISHED. `severity: 3` beside `state: unreviewable` would be the
    // accusation with its evidence stripped out.
    severity: plan.severity,
    severityLabel: SEVERITY_LABEL[plan.severity],
    findingCount: plan.findings.length,
    verdictUrl: `${WEB}/r/${o.fingerprint}`,
    /**
     * The maintainer's half of a withheld result, and the reason withholding is
     * not the same as hiding. It never reaches the chain, the blob or the ENS
     * record — it travels back down the submission channel to the person who
     * submitted the repository and asked to be told about their own code.
     */
    /**
     * That a result was held, and NOT what it was.
     *
     * The findings used to ride here, on the reasoning that this channel goes back
     * to the maintainer who submitted the repository. Two things are wrong with
     * that. The submission is authenticated by World ID, which proves a PERSON and
     * not a maintainer — `POST /v1/submissions` says so itself, the repo-ownership
     * proof is listed as not built — so the submitter may be anyone. And the
     * channel is `GET /v1/submissions/:id`, documented as public and
     * unauthenticated: the job id is a bearer token for whatever it returns.
     *
     * Put together, shipping the findings here means anyone with a World ID can
     * submit anyone's repository and read back an unaudited, file-and-line
     * accusation about it. That is the thing the head withholds, handed over
     * through a side door.
     *
     * So the status channel reports the SHAPE of the outcome — a review ran, its
     * result is held, here is why — and the DGX keeps the detail in its own logs
     * for an operator who can already read them.
     */
    withheld: plan.withheld
      ? {
          because: plan.withheld.because,
          findingCount: plan.withheld.findingCount,
          notice:
            plan.withheld.because === 'third-party'
              ? 'A review ran and reached a conclusion. SureX publishes findings only about servers it wrote ' +
                'itself, so the registry entry records that a review happened and holds the result. Proving you ' +
                'maintain this repository is not something this registry can do yet, so the findings are not ' +
                'returned here.'
              : 'A review ran and reached a conclusion, and it was not published.',
        }
      : null,
  };

  if (plan.withheld?.findings?.length) {
    // stderr, which the ingest service captures and no HTTP route serves. The
    // operator can already read the wallet's logs; a stranger with a job id cannot.
    log(`  withheld ${plan.withheld.findingCount} finding(s) — ${plan.withheld.because}:`);
    for (const f of plan.withheld.findings) {
      log(`    sev ${f.severity} ${f.category ?? 'finding'} · ${f.file ?? '?'}:${f.line ?? '?'} — ${f.description ?? ''}`);
    }
  }
  log(
    `  ${plan.state}${plan.reason ? ` (${plan.reason})` : ''} · published ${plan.findings.length} finding(s)` +
    `${plan.withheld ? ` · ${plan.withheld.findingCount} held` : ''} · tier ${o.tier} · ${o.reviewedArtifact}`,
  );
  if (DRY) {
    progress('done', 'Dry run — nothing was written on chain', { state: plan.state, fingerprint: o.fingerprint });
    return done({ ...summary, published: false, note: 'dry run — nothing written on chain' });
  }

  const { createWalrusWriter, createArkivWriter, buildReviewRecord, buildVerdictHead, buildRegistryEntry, recordBytes, sha256Hex } =
    await import('../packages/worker/index.mjs');

  /**
   * The verdict as PUBLISHED. Not the raw one.
   *
   * This was `o.result?.verdict`, and the consequence was that a third party whose
   * review came back flagged got a head saying `unreviewable / withheld` and, two
   * entities away, a review record annotated `verdict=flagged severity=3` — plus a
   * certified blob saying the same. The head withheld the accusation and the
   * record published it. Anyone querying `entityType=review` read straight past
   * the rule. `withheld` has to mean withheld on every entity the run writes.
   */
  const publishedVerdict = plan.state === 'clean' ? 'clean' : plan.state === 'flagged' ? 'flagged' : 'unreviewable';

  const body = {
    schema: 'surex.review/1',
    fingerprint: o.fingerprint,
    subject: o.reviewedArtifact,
    submittedCommit: o.commit,
    release: o.release ?? null,
    verdict: publishedVerdict,
    publishedState: plan.state,
    reason: plan.reason ?? null,
    severity: plan.severity,
    // A withheld result publishes NO findings and NO severity. The state says a
    // review ran and its result is held; shipping the findings inside it — or the
    // number that summarises them — would be publishing the accusation while
    // claiming not to.
    findings: plan.findings,
    // Said plainly, because a reader of this blob deserves to know that the
    // absence above is a decision and not an empty review.
    withheld: plan.withheld
      ? {
          because: plan.withheld.because,
          // Says only what is true. The previous wording claimed "the maintainer who
          // submitted it was given the result in full" — a delivery this system
          // cannot perform (there is no repo-ownership proof, so it cannot even
          // establish who the maintainer is) published as a fact on chain.
          statement:
            'A review ran to completion. Its result is not published: SureX publishes findings only about ' +
            'servers it wrote itself, and this repository is not ours.',
        }
      : null,
    concern: plan.concern ?? null,
    assessment: plan.assessment ?? null,
    // From the PLAN, not from the raw result. It is nominally the author's own
    // claim, and in practice the model writes the conclusion into it — so on a
    // withheld run it was carrying the accusation into the public blob.
    statedIntentSummary: plan.statedIntentSummary ?? null,
    capabilities: o.result?.capabilities ?? null,
    sourceCoverage: o.result?.run?.sourceCoverage ?? null,
    npmIntegrity: o.integrityCheck?.detail ?? null,
    // What made this entry its tier, so the tier is never an assertion on its own.
    tier: o.tier,
    tierBasis: o.pinning?.basis ?? null,
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
      { stage: 'walrus-write', reviewCompleted: true, verdict: plan.state, detail: String(lastError?.message ?? lastError).slice(0, 300) },
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
      verdict: publishedVerdict,
      severity: plan.severity,
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

  /**
   * The head, from the plan — and never a reason for the run to die.
   *
   * `latestReviewKey` now travels on EVERY state, not only on `clean`. It was
   * conditional, which left a withheld or unreviewable entry pointing at nothing
   * while its review record sat on chain two entities away: the one link that
   * proves a review actually ran was the link being withheld. The guard's rule is
   * that `clean` REQUIRES a review key, not that the others may not have one.
   *
   * Provenance is unconditional for the same reason. `reviewedCommit`, `modelId`
   * and `promptVersion` are what let a maintainer reproduce the reading, and the
   * live `@surex/mal-*` heads written without them render "commit —" in a block
   * message. The guard demands them for an accusing state; this pipeline supplies
   * them for all of them.
   */
  const headFields = (p) => ({
    fingerprint: o.fingerprint,
    state: p.state,
    reason: p.reason,
    tier: o.tier,
    severity: p.severity,
    enforceAfter: p.enforceAfter,
    name: o.name,
    latestReviewKey: reviewKey,
    sourceKey: o.reviewedArtifact,
    reviewedCommit: o.commit,
    integrity: o.pinning?.integrity,
    modelId: o.result?.modelId ?? null,
    promptVersion: o.result?.promptVersion ?? null,
    reviewedAt: new Date().toISOString(),
    capabilities: o.result?.capabilities,
    topFinding: p.topFinding,
    // rv-7: what KIND of gap this is, and one sentence about it. The head is the
    // only entity the gate and `/r` read without a second fetch, so a verdict whose
    // explanation lives only in the Walrus blob is a verdict nobody reads.
    concern: p.concern,
    assessment: p.assessment,
    findingCount: p.findingCount,
    evidence,
    requireReviewForClean: true,
  });

  let head;
  let published = plan;
  try {
    head = await arkiv.createMany([buildVerdictHead(headFields(plan))]);
  } catch (err) {
    /**
     * The boundary refused, or the write did not land. Either way the review
     * record and the certified blob are ALREADY on chain, so exiting here is what
     * produced the failure this whole change exists to remove: an entry with no
     * head, invisible to the listing query, and a maintainer watching a stage
     * counter stop at 7 of 8.
     *
     * So fall back to the one shape that is writable by construction — an honest
     * `unreviewable / withheld` — and say loudly why. Publishing less than we
     * know is a decision the registry is allowed to make. Publishing nothing at
     * all is just a lost submission.
     */
    log(`  ! the planned head was refused (${err?.message ?? err}) — falling back to a withheld entry`);
    published = fallbackPlan(String(err?.message ?? err).slice(0, 300));
    head = await arkiv.createMany([buildVerdictHead(headFields(published))]);
  }
  // The head is the entity the gate reads before a tool call, so it is the last
  // thing said before the verdict URL: from here the entry answers.
  progress('arkiv', 'Verdict head indexed', { entityKey: head.created[0]?.key, txHash: head.txHashes[0] });

  progress('done', `Published as ${published.state}${published.reason ? ` (${published.reason})` : ''}`, {
    state: published.state,
    reason: published.reason,
    tier: o.tier,
    fingerprint: o.fingerprint,
    verdictUrl: summary.verdictUrl,
  });
  return done({
    ...summary,
    state: published.state,
    reason: published.reason ?? null,
    severity: published.severity,
    severityLabel: SEVERITY_LABEL[published.severity],
    findingCount: published.findings.length,
    published: true,
    blobId: pointer.blobId,
    reviewKey,
    headKey: head.created[0]?.key ?? null,
  });
}
