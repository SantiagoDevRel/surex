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

import { writeFileSync, mkdirSync, existsSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

import { canonicalise, fingerprintOf, tierOf, SEVERITY_LABEL } from '../packages/core/index.mjs';
import { reviewServer } from '../packages/reviewer/src/review.mjs';
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

// Progress goes to stderr so `--json` leaves exactly one machine-readable line on
// stdout — the ingest service parses it, and a stray log line would break it.
const log = (...a) => console.error(...a);

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

/** The repository at exactly that commit. GitHub serves it as a tarball. */
function fetchRepoAtCommit(owner, repo, commit) {
  const dir = join(WORK, `${safe(owner)}__${safe(repo)}__${commit.slice(0, 12)}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
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
  const dir = join(WORK, `${safe(name)}__${safe(meta.version)}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
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

  // 3. review the bytes that execute
  let sourceDir = repoDir;
  let integrityCheck = null;
  let reviewedArtifact = `github:${owner}/${repo}@${commit}`;
  if (onNpm) {
    try {
      const got = await fetchNpmTarball(npmName, published);
      sourceDir = got.dir;
      integrityCheck = got.integrityCheck;
      reviewedArtifact = `npm:${npmName}@${published.version}`;
      log(`  reviewing the published tarball ${reviewedArtifact} (integrity ${integrityCheck.detail})`);
    } catch (err) {
      log(`  ! npm tarball unusable (${err.message}) — reviewing the repository at the submitted commit instead`);
    }
  } else {
    log('  not published to npm — reviewing the repository at the submitted commit');
  }

  // 4. licence gate, before anything is stored
  const gate = await licenceGate(
    {
      name: npmName ?? `${owner}/${repo}`,
      pkg: onNpm ? { registryType: 'npm', identifier: npmName, version: published.version } : null,
      repo: { url: `https://github.com/${owner}/${repo}` },
    },
    { fetchRepoFiles: true },
  );
  if (gate.undetermined) {
    fail('the licence could not be read, and refusing to claim ineligibility on a failed request', { detail: gate.detail });
  }
  if (!gate.eligible) {
    return publishOutcome({
      fingerprint, tier, state: 'unreviewable', reason: 'licence',
      why: `licence not redistribution-permitting (${gate.spdx ?? gate.detail})`,
      name: npmName ?? `${owner}/${repo}`, commit, release, reviewedArtifact, integrityCheck, result: null,
    });
  }

  // 5. can it be read at all?
  const files = readPackage(sourceDir);
  const read = readability(files);
  if (!read.readable) {
    return publishOutcome({
      fingerprint, tier, state: 'unreviewable', reason: 'source-unavailable', why: read.reason,
      name: npmName ?? `${owner}/${repo}`, commit, release, reviewedArtifact, integrityCheck, result: null,
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
  const result = await reviewServer(
    { files: selection.kept, statedIntent },
    { config, limits: REVIEW_LIMITS, allowCache: false, writeCache: false },
  );

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

  // A flag against a submitted third-party project is HELD, exactly as it is for
  // the seeded ones. The maintainer submitted it; that is consent to a review,
  // not consent to an unaudited model publishing an accusation about them.
  if (state === 'flagged') {
    state = 'unreviewable';
    reason = 'withheld';
  }

  return publishOutcome({
    fingerprint, tier, state, reason,
    why: result.notice ?? null,
    name: npmName ?? `${owner}/${repo}`,
    commit, release, reviewedArtifact, integrityCheck, result,
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
  if (DRY) return done({ ...summary, published: false, note: 'dry run — nothing written on chain' });

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
  const pointer = await walrus.writeRecord(bytes, { label: o.name });
  const evidence = { ...pointer, contentSha256: sha256Hex(bytes) };
  log(`  walrus ${pointer.blobId}`);

  const { created } = await arkiv.createMany([
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

  await arkiv.createMany([
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

  return done({ ...summary, published: true, blobId: pointer.blobId, reviewKey });
}
