#!/usr/bin/env node
// Publish the real review of the SureX fixture, so the demo has no mocked link.
//
// Writes a real cached review body to Walrus as its own certified blob — not a quilt
// patch, because a review is exactly the record where per-record citability is the
// point — and indexes it on Arkiv as a ReviewRecord plus a flagged VerdictHead.
//
// The only thing SureX ever flags is this fixture, which the project wrote itself.
//
//   node scripts/publish-fixture-review.mjs [--dry-run]
//
// Cost: one standalone blob = 2 Sui transactions.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalise, fingerprintOf, SEVERITY_LABEL } from '../packages/core/index.mjs';
import { localEntryResolver } from '../packages/plugin/lib/localentry.mjs';
import {
  createWalrusWriter,
  createArkivWriter,
  buildReviewRecord,
  buildVerdictHead,
  buildRegistryEntry,
  recordBytes,
  sha256Hex,
} from '../packages/worker/index.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_ENTRY = join(ROOT, 'packages', 'fixture-mcp', 'src', 'server.mjs');
const FIXTURE_DIR = join(ROOT, 'packages', 'reviewer', 'fixtures');
const DRY = process.argv.includes('--dry-run');

const log = (...a) => console.log(...a);

// The reviewer's demo-recovery cache: real runs, kept because the DGX is behind a
// tunnel that drops. Never presented as a fresh run.
function loadRealReview() {
  const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'));
  const runs = files
    .map((f) => ({ file: f, json: JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf8')) }))
    .filter((r) => r.json?.kind === 'review' && r.json?.value?.verdict)
    // Prefer the code model over the generalist, and the most recent of those.
    .sort((a, b) => {
      const score = (r) => (String(r.json.modelId).includes('coder') ? 1 : 0);
      return score(b) - score(a) || String(b.json.recordedAt).localeCompare(String(a.json.recordedAt));
    });
  if (!runs.length) throw new Error(`no cached review found in ${FIXTURE_DIR}`);
  return runs[0];
}

const { file, json: cached } = loadRealReview();
const review = cached.value;

log(`\nreal review, from ${file.slice(0, 12)}…`);
log(`  model            ${cached.modelId}   prompt ${cached.promptVersion}`);
log(`  recorded         ${cached.recordedAt}  (${Math.round(cached.durationMs / 1000)}s on ${cached.endpoint?.label})`);
log(`  verdict          ${review.verdict} · severity ${review.severity} · agreementRuns ${review.agreementRuns}`);
log(`  findings         ${review.findings.length}`);

if (review.verdict !== 'flagged') {
  throw new Error(`refusing to publish a ${review.verdict} verdict as flagged`);
}

// The fingerprint the gate will compute for the fixture — it has to match exactly.
const canonical = canonicalise(
  { command: 'node', args: [FIXTURE_ENTRY] },
  { hashLocalEntry: localEntryResolver(ROOT) },
);
const fingerprint = fingerprintOf(canonical);
log(`\nfixture fingerprint ${fingerprint}`);
log(`  canonical         ${JSON.stringify(canonical)}`);

// The blob is the findings themselves, so a verdict points at the exact bytes it was
// made from and anyone can check them independently.
const topFinding = [...review.findings].sort((a, b) => b.severity - a.severity)[0];

const reviewBody = {
  schema: 'surex.review/1',
  fingerprint,
  subject: '@surex/fixture-mcp (a deliberately malicious fixture authored by the SureX project)',
  verdict: review.verdict,
  severity: review.severity,
  findings: review.findings,
  statedIntentSummary: review.statedIntentSummary,
  capabilities: review.capabilities,
  modelId: review.modelId,
  promptVersion: review.promptVersion,
  agreementRuns: review.agreementRuns,
  analyzedAt: cached.recordedAt,
  endpoint: cached.endpoint,
  disclosure:
    'This review was produced by an open-source model reading the source statically. ' +
    'No human audited it. It describes a fixture the SureX project wrote itself in order to have ' +
    'something real to flag; it is not a statement about anyone else\'s code.',
  reviewedBytes: {
    note: 'the fixture source tree is in this repository at packages/fixture-mcp',
    entryFileSha256: canonical.package.version.replace('local:', '') + '… (first 16 hex of sha256)',
  },
};

const bytes = recordBytes(reviewBody);
const contentSha256 = sha256Hex(bytes);
log(`\nreview record        ${bytes.length} B   sha256 ${contentSha256.slice(0, 16)}…`);
log(`  top finding        [${SEVERITY_LABEL[topFinding.severity]}] ${topFinding.category} ${topFinding.file}:${topFinding.line}`);

if (DRY) {
  log('\n--dry-run: nothing written.\n');
  process.exit(0);
}

// Checkpointed so a re-run does not pay for bytes that are already certified — this
// script has died between the Walrus write and the Arkiv write.
const CHECKPOINT = join(ROOT, 'packages', 'worker', 'state', 'fixture-review.json');

function readCheckpoint() {
  try {
    const j = JSON.parse(readFileSync(CHECKPOINT, 'utf8'));
    return j.fingerprint === fingerprint && j.contentSha256 === contentSha256 ? j : null;
  } catch {
    return null;
  }
}

let saved = readCheckpoint();
let pointer = saved?.pointer ?? null;

const walrus = await createWalrusWriter({ log: (m) => log(m) });

if (pointer) {
  log(`\nWalrus: reusing the already-certified blob ${pointer.blobId}`);
} else {
  log('\nwriting to Walrus…');
  const balances = await walrus.balances();
  log(`  balances           ${balances.sui} MIST · ${balances.wal} FROST`);
  pointer = await walrus.writeRecord(bytes, { label: 'fixture review' });
  writeFileSync(CHECKPOINT, JSON.stringify({ fingerprint, contentSha256, pointer }, null, 2));
}
log(`  blobId             ${pointer.blobId}`);
log(`  suiObjectId        ${pointer.suiObjectId}`);
log(`  registerTx         ${pointer.registerTx}`);
log(`  certifyTx          ${pointer.certifyTx}`);

// The ReviewRecord first, then the head that points at it.
log('\nwriting to Arkiv…');
const arkiv = createArkivWriter({ log: (m) => log(m) });

/**
 * Whatever is already on chain for this fingerprint, so a re-run adds nothing twice.
 *
 * Must be `readBackScoped`, not `readAllScoped`: the latter takes {entityType, extra}
 * and silently ignores a `fingerprint` key, so it returns every seeded row and this
 * script concludes "already on chain" about entities that do not exist.
 */
async function existingKey(entityType) {
  const rows = await arkiv.readBackScoped({ entityType, fingerprint, limit: 1 });
  if (!rows.length) return null;
  const attrs = Object.fromEntries((rows[0].attributes ?? []).map((a) => [a.key, a.value]));
  if (attrs.fingerprint !== fingerprint) return null;
  return String(rows[0].key);
}

let reviewKey = await existingKey('review');
if (reviewKey) {
  log(`  reviewKey          ${reviewKey}   (already on chain — not rewritten)`);
} else {
  const reviewEntity = buildReviewRecord({
    fingerprint,
    sourceKey: 'in-repo:packages/fixture-mcp',
    verdict: review.verdict,
    severity: review.severity,
    analyzedAt: Date.parse(cached.recordedAt),
    reviewedSourceBlobId: null,
    modelId: review.modelId,
    promptVersion: review.promptVersion,
    blob: { ...pointer, contentSha256 },
  });
  const { created } = await arkiv.createMany([reviewEntity]);
  reviewKey = created[0].key;
  log(`  reviewKey          ${reviewKey}`);
}

const head = buildVerdictHead({
  fingerprint,
  state: 'flagged',
  // Tier C, and the verdict says so: a local script's identity is the content of its
  // entry file, which does not cover the module graph behind it.
  tier: 'C',
  severity: review.severity,
  // The server blocks from the moment it is flagged; the window only decides
  // whether the block calls itself unconfirmed or confirmed.
  enforceAfter: Date.now() + 72 * 3600 * 1000,
  name: '@surex/fixture-mcp (local)',
  latestReviewKey: reviewKey,
  sourceKey: 'in-repo:packages/fixture-mcp',
  reviewedCommit: 'see packages/fixture-mcp in this repository',
  reviewedAt: cached.recordedAt,
  modelId: review.modelId,
  promptVersion: review.promptVersion,
  capabilities: review.capabilities,
  topFinding,
  evidence: { ...pointer, contentSha256 },
});

const entry = buildRegistryEntry({
  fingerprint,
  name: '@surex/fixture-mcp (local)',
  tier: 'C',
  blob: { ...pointer, contentSha256 },
});

const pending = [];
const existingEntry = await existingKey('registryEntry');
const existingHead = await existingKey('verdictHead');
if (!existingEntry) pending.push({ label: 'entryKey ', built: entry });
if (!existingHead) pending.push({ label: 'headKey  ', built: head });
if (existingEntry) log(`  entryKey           ${existingEntry}   (already on chain)`);
if (existingHead) log(`  headKey            ${existingHead}   (already on chain)`);
if (pending.length) {
  const { created } = await arkiv.createMany(pending.map((p) => p.built));
  created.forEach((c, i) => log(`  ${pending[i].label}          ${c.key}`));
}

log('\nreading it back, filtered by .createdBy…');
const readBack = await arkiv.waitForIndexed({ entityType: 'verdictHead', fingerprint });
log(`  indexed            ${readBack ? 'yes' : 'NOT VISIBLE'}`);

log(`\ndone. The chain now has nothing stood in for:`);
log(`  SUREX_API_URL=http://127.0.0.1:4310 node demo/chain.mjs\n`);
