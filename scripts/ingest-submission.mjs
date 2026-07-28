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
// Which bytes get reviewed, and why it is not simply "the repo".
//
// A submission names a repository at a commit. What a *user* runs is almost never
// that: it is `npx -y <package>`, a tarball npm built from some commit the maintainer
// chose. The two can differ — that gap is what Tier exists to describe. So:
//
//   · if the repository publishes to npm, the review is of the npm tarball (the
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
  licenceGate, planPublication, submissionPinning, fallbackPlan,
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

// A review takes minutes, so the pipeline says where it is, one JSON object per line,
// on stdout:
//
//   {"surexProgress":1,"stage":"walrus","label":"…","done":6,"total":8,"detail":{…}}
//
// stdout carries two kinds of line and exactly one field keeps them apart: the result
// line has `ok`, and a progress line must never carry one. infra/dgx-ingest finds the
// result by scanning stdout backwards for the last line carrying `ok`, so a progress
// line carrying one puts a verdict URL in front of a maintainer for a review that is
// still running. `progress()` cannot emit `ok`; stdout.mjs refuses any progress line
// that does. Both halves, because one of them alone is a comment.

/**
 * The canonical order. Shared with the reader — one list, so the two cannot drift.
 *
 * `starting` is reserved and this pipeline never emits it: it reads the tool list out
 * of the README (`toolSource: 'readme-only'` below) and never runs the server —
 * `scripts/review-known.mjs` is the pass that does. Announcing a stage that did not
 * happen would be a fabricated fact on a progress screen.
 */
export const STAGES = ['resolving', 'licence', 'fetching', 'starting', 'reviewing', 'walrus', 'arkiv', 'done'];

/**
 * @param {(line: string) => void} [write] injected so a test reads the lines
 *   instead of the ingest service.
 *
 * `done` is the stage's position in STAGES, clamped to never move backwards, and
 * `total` is that list's length. Two consequences, both deliberate:
 *
 *   · A skipped stage jumps the number forward — unreadable source goes straight from
 *     `fetching` to `walrus`, and the jump is the honest reading.
 *   · The stages are not emitted in list order. The npm tarball is downloaded before
 *     the licence gate, so `fetching` can arrive before `licence` and the clamp is
 *     what stops the bar going backwards. Do not reorder the emissions to tidy the
 *     numbers — that would announce a gate before it ran.
 *
 * `done` is last in STAGES, so the terminal stage always reports `done === total`.
 */
export function createProgress(write = (line) => process.stdout.write(line)) {
  let highest = 0;
  return function progress(stage, label, detail = {}) {
    const at = STAGES.indexOf(stage);
    if (at === -1) throw new Error(`unknown stage: ${stage}`);
    highest = Math.max(highest, at + 1);
    // Only facts already known travel here: `blobId: null` on a screen is
    // not an absent fact, it is a claim that there is no blob.
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

const safe = (s) => String(s).replace(/[^a-z0-9._-]+/gi, '_');

/**
 * A directory that is definitely writable, for one repo at one commit.
 *
 * `rmSync(dir, { force: true })` then `mkdirSync` is not enough: `force` suppresses
 * "does not exist", not EACCES, so one leftover root-owned directory at the
 * deterministic path takes the run down and surfaces to the submitter as "could not
 * fetch <their repo>". Try the canonical path, prove it is writable, and on any
 * failure fall back to a unique one — a stale directory is not a reason to reject a
 * submission.
 */
function freshDir(name) {
  const canonical = join(WORK, name);
  try {
    rmSync(canonical, { recursive: true, force: true });
    mkdirSync(canonical, { recursive: true });
    // `mkdirSync` on an existing but unwritable directory succeeds silently, so
    // writability is checked rather than assumed.
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

  // The fingerprint is the id the verdict will be published under, said here rather
  // than at the end so a watcher can open /r/<fp> before the review finishes.
  //
  // The tier is deliberately not on this line: it depends on which artifact is read
  // and whether its digest verifies, so announcing one here means revising it later.
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
      // The fallback is stated, not hidden: a verdict about the repository when the
      // user installs from npm is a different claim.
      progress('fetching', 'The npm tarball could not be read — reading the repository at the submitted commit', {
        artifact: reviewedArtifact,
      });
    }
  } else {
    log('  not published to npm — reviewing the repository at the submitted commit');
    progress('fetching', 'Reading the repository at the submitted commit', { artifact: reviewedArtifact });
  }

  /**
   * What this submission actually pinned, now that the artifact is known. Not
   * `tierOf(canonical)`, which is computed before the fetch and answers `C` —
   * "nothing was checked" — even for a 40-character commit sha. `submissionPinning`
   * hands back the digest that earns the tier, or none where recording one would put
   * a git sha where the gate expects an npm integrity.
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
   * 4. Read the licence. Record it — do not refuse on it.
   *
   * The licence rule exists to stop the redistribution of source nobody licensed for
   * redistribution, and this path stores no source: `publishOutcome` writes one blob
   * and it is the review body, words written here about public code. Refusing here
   * would deny a maintainer a review over a LICENSE file.
   *
   * It is still established and published as a fact on the entry (`none` when there
   * is none), because "reviewed, licence unknown" is information and silence is not.
   *
   * `scripts/review-known.mjs` downloads and extracts npm tarballs and does hold
   * third-party bytes. Its gate stays.
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
   * What the entry will say the licence is. Three answers, kept apart because
   * collapsing them is how a record starts lying:
   *
   *   a recognised SPDX id   → that id
   *   read it, found nothing → `none`
   *   could not read it      → `unknown` (a request failed; not a claim)
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

  // The model and prompt version are read from the same config the reviewer uses, so
  // the screen cannot drift from what actually ran. `run` is deliberately absent:
  // reviewServer does not report which of its readings is in flight, and an invented
  // run number on a progress screen is an invented fact.
  progress('reviewing', `${config.modelId} is reading ${selection.kept.length} file(s)`, {
    model: config.modelId,
    promptVersion: PROMPT_VERSION,
    files: selection.kept.length,
  });

  const result = await reviewServer(
    { files: selection.kept, statedIntent },
    { config, limits: REVIEW_LIMITS, allowCache: false, writeCache: false },
  );

  // The raw verdict must never go on a progress line. A flag against a submitted
  // third-party project is held below and published as `unreviewable / withheld`;
  // leaking `flagged` through here publishes exactly what that rule withholds.
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
   * A flag against a third party is held; a flag against self-owned code is not.
   *
   * AGENTS.md §4 forbids publicly flagging a real, named third-party project on an
   * unaudited model verdict — a maintainer consented to a review, not an accusation —
   * and it is enforced twice: `planPublication` will not plan a flag the write
   * boundary would refuse, and `buildVerdictHead` refuses one regardless.
   *
   * `SUREX_SELF_OWNED` is the list of GitHub owners whose flags may publish, set by
   * the operator in the environment of the machine holding the wallet — a submitter
   * chooses a repository, never which repositories count as self-owned.
   *
   * It is one of two locks and never both. The other is the fingerprint allowlist the
   * write boundary reads, curated by a human off the request path
   * (`scripts/allow-self-authored.mjs`), and this pipeline must not add to it: `owner`
   * is not proof of authorship, because GitHub serves every commit in a repository's
   * fork network from the upstream namespace, so anyone who can push to a fork of a
   * self-owned repository picks the fingerprint that would be flagged. See the note
   * in packages/worker/src/entities.mjs.
   *
   * So a self-owned flag publishes only once an operator has vouched for that
   * fingerprint. Until then it is withheld — the safe direction, and an honest state
   * rather than a crash.
   */
  const selfOwned = String(process.env.SUREX_SELF_OWNED ?? 'SantiagoDevRel')
    .split(',')
    .map((o) => o.trim().toLowerCase())
    .filter(Boolean);
  const ours = selfOwned.includes(String(owner).toLowerCase());

  if (verdict === 'flagged') {
    // Said out loud on the operator's channel, because this run is about to make a
    // public claim about a named piece of software.
    log(`  publishing a FLAG for ${owner}/${repo} — ${ours ? 'our own code' : 'a third party'}`);
  }

  return publishOutcome({
    fingerprint, tier, pinning, verdict, reason, ours,
    why: result.notice ?? null,
    name: npmName ?? `${owner}/${repo}`,
    commit, release, reviewedArtifact, integrityCheck, licence, result,
    findings: result.findings ?? [],
  });
}


async function publishOutcome(o) {
  /**
   * One decision, taken once, in a module whose test walks every verdict and asserts
   * the write boundary accepts the result. Everything below — the review record, the
   * blob body, the head — is rendered from this plan and must never re-decide from
   * `o.verdict` on its own; that divergence has killed live submissions.
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
    // What was published. `severity: 3` beside `state: unreviewable` would be the
    // accusation with its evidence stripped out.
    severity: plan.severity,
    severityLabel: SEVERITY_LABEL[plan.severity],
    findingCount: plan.findings.length,
    verdictUrl: `${WEB}/r/${o.fingerprint}`,
    /**
     * That a result was held, and never what it was. The findings must not ride here:
     * a submission is authenticated by World ID, which proves a person and not a
     * maintainer, and `GET /v1/submissions/:id` is public and unauthenticated — the
     * job id is a bearer token for whatever it returns. Together those mean anyone
     * with a World ID could submit anyone's repository and read back an unaudited,
     * file-and-line accusation about it through a side door.
     *
     * So this channel reports the shape of the outcome — a review ran, its result is
     * held, here is why — and the detail stays in the DGX's own logs.
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
   * The verdict as published, never the raw one. `o.result?.verdict` here gives a
   * third party a head saying `unreviewable / withheld` and, two entities away, a
   * review record annotated `verdict=flagged severity=3` — so anyone querying
   * `entityType=review` reads straight past the rule. `withheld` has to mean withheld
   * on every entity the run writes.
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
    // A withheld result publishes no findings and no severity — shipping either would
    // be publishing the accusation while claiming not to.
    findings: plan.findings,
    // So a reader knows the absence above is a decision, not an empty review.
    withheld: plan.withheld
      ? {
          because: plan.withheld.because,
          // Only what is true: this system has no repo-ownership proof, so it cannot
          // claim the maintainer was given the result in full.
          statement:
            'A review ran to completion. Its result is not published: SureX publishes findings only about ' +
            'servers it wrote itself, and this repository is not ours.',
        }
      : null,
    concern: plan.concern ?? null,
    assessment: plan.assessment ?? null,
    // From the plan, never the raw result: nominally the author's own claim, but in
    // practice the model writes its conclusion into it, so on a withheld run the raw
    // one carries the accusation into the public blob.
    statedIntentSummary: plan.statedIntentSummary ?? null,
    capabilities: o.result?.capabilities ?? null,
    sourceCoverage: o.result?.run?.sourceCoverage ?? null,
    npmIntegrity: o.integrityCheck?.detail ?? null,
    // What made this entry its tier, so the tier is never an assertion on its own.
    tier: o.tier,
    tierBasis: o.pinning?.basis ?? null,
    // An SPDX id, `none` when it was read and none found, or `unknown` when a request
    // failed. Published either way — "reviewed, licence none" is a fact.
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

  // The content hash is computed here, from the bytes before anyone else touches
  // them: the one field a publisher cannot influence, and what binds this record to
  // its Arkiv entity. Said before the write, not reported back after it.
  const contentSha256 = sha256Hex(bytes);
  progress('walrus', `Writing the review blob (${bytes.length} B)`, { contentSha256 });

  /**
   * A blob write is a distributed write and fails without anything being wrong with
   * the review — `NotEnoughBlobConfirmationsError` is a property of the network on the
   * day. Retry, and if it still will not take, fail with a sentence saying the review
   * succeeded and the storage did not; only one of those is worth re-reviewing for.
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
      // A retry is the honest reason a submission sits here for half a minute;
      // silence reads as a hang, and a hang is what people refresh.
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
  // `wallet` means this writer's key registered it, `publisher` means a public
  // publisher's did and the Sui object is theirs.
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
  // entityKey and txHash must always describe the same write: pairing this key with
  // the head's transaction sends a reader to an explorer page without their entity.
  progress('arkiv', 'Review record indexed', { entityKey: reviewKey, txHash: txHashes[0] });

  /**
   * The head, from the plan — and never a reason for the run to die.
   *
   * `latestReviewKey` travels on every state, not only `clean`: the guard's rule is
   * that `clean` requires a review key, not that the others may not have one, and a
   * conditional one leaves a withheld entry pointing at nothing while the record
   * proving a review ran sits on chain two entities away.
   *
   * Provenance is unconditional for the same reason: `reviewedCommit`, `modelId` and
   * `promptVersion` are what let a maintainer reproduce the reading, and a head
   * written without them renders "commit —" in its block message.
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
    // What kind of gap this is, and one sentence about it. The head is the only entity
    // the gate and `/r` read without a second fetch, so a verdict whose explanation
    // lives only in the Walrus blob is a verdict nobody reads.
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
     * The boundary refused, or the write did not land. Either way the review record
     * and the certified blob are already on chain, so exiting here leaves an entry
     * with no head, invisible to the listing query. Fall back to the one shape that
     * is writable by construction — an honest `unreviewable / withheld` — and say
     * loudly why: publishing less than is known is allowed, publishing nothing is a
     * lost submission.
     */
    log(`  ! the planned head was refused (${err?.message ?? err}) — falling back to a withheld entry`);
    published = fallbackPlan(String(err?.message ?? err).slice(0, 300));
    head = await arkiv.createMany([buildVerdictHead(headFields(published))]);
  }
  // The head is what the gate reads before a tool call, so it is the last thing said
  // before the verdict URL: from here the entry answers.
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
