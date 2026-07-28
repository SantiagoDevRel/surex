#!/usr/bin/env node
// Review a family of fixture MCP servers on the DGX and publish each verdict on chain.
//
// For every server under packages/fixtures/<name>/ and the original
// packages/fixture-mcp:
//   1. read its whole source tree (the reviewer needs the code)
//   2. start it over stdio and ask it tools/list — the stated intent is what the
//      server actually declares, never an assumption about it
//   3. run the real double-pass review on the DGX
//   4. write the review body to Walrus, index a ReviewRecord + VerdictHead on Arkiv
//   5. append the outcome to a database written to the owner's Downloads
//
// Only SureX's own fixtures are ever flagged (AGENTS.md §4). The ambiguous ones land
// wherever the model lands, which is the point of having them.
//
//   node scripts/review-and-publish.mjs --dry-run     # review, print, write nothing
//   node scripts/review-and-publish.mjs               # review + publish
//   node scripts/review-and-publish.mjs --only mal-   # a name prefix filter

import { writeFileSync, readdirSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

import { entryOf, readTree, statedIntentFrom } from './lib/server-source.mjs';
import { canonicalise, fingerprintOf, SEVERITY_LABEL } from '../packages/core/index.mjs';
import { localEntryResolver } from '../packages/plugin/lib/localentry.mjs';
import { reviewServer } from '../packages/reviewer/src/review.mjs';
import {
  createWalrusWriter,
  createArkivWriter,
  buildReviewRecord,
  buildVerdictHead,
  buildRegistryEntry,
  recordBytes,
  sha256Hex,
  selfAuthoredPath,
  setSelfAuthored,
  isSelfAuthored,
} from '../packages/worker/index.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const onlyIx = process.argv.indexOf('--only');
const ONLY = onlyIx !== -1 ? process.argv[onlyIx + 1] : null;
const log = (...a) => console.log(...a);

function discover() {
  const out = [];
  const original = join(ROOT, 'packages', 'fixture-mcp');
  out.push({ name: 'fixture-mcp', dir: original, entry: entryOf(original), tier: 'malicious' });
  const famDir = join(ROOT, 'packages', 'fixtures');
  if (existsSync(famDir)) {
    for (const name of readdirSync(famDir)) {
      const dir = join(famDir, name);
      if (!statSync(dir).isDirectory()) continue;
      const entry = entryOf(dir);
      if (!entry) continue;
      const tier = name.startsWith('honest-') ? 'honest'
        : name.startsWith('ambiguous-') ? 'ambiguous'
        : name.startsWith('mal-') ? 'malicious' : 'unknown';
      out.push({ name, dir, entry, tier });
    }
  }
  return out.filter((s) => !ONLY || s.name.includes(ONLY));
}

async function reviewOne(server) {
  const files = readTree(server.dir);
  // cwd at the repo ROOT: an in-repo fixture imports @modelcontextprotocol/sdk
  // from the monorepo's hoisted top-level node_modules — see server-source.mjs.
  const statedIntent = await statedIntentFrom({
    dir: server.dir, name: server.name, entry: server.entry, cwd: ROOT,
  });
  log(`\n${server.name}  [${server.tier}]  ${files.length} files · ${statedIntent.tools.length} tools declared`);

  const result = await reviewServer({ files, statedIntent });
  const top = [...(result.findings ?? [])].sort((a, b) => b.severity - a.severity)[0] ?? null;

  const caps = Object.entries(result.capabilities ?? {})
    .filter(([, v]) => v.present)
    .map(([k]) => k);

  log(`  verdict   ${result.verdict} · severity ${result.severity} · agreementRuns ${result.agreementRuns} · ${result.findings?.length ?? 0} findings`);
  log(`  reach     ${caps.join(' ') || 'nothing detected'}`);
  if (top) log(`  top       [${SEVERITY_LABEL[top.severity]}] ${top.category} ${top.file ?? '?'}:${top.line ?? '?'}`);
  if (result.notice) log(`  notice    ${result.notice}`);

  return { server, files, statedIntent, result, top, caps };
}

// Guarded so importing this file (a test, a debug session) does not run reviews
// and publish to chain. Only direct execution does anything.
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (!isMain) {
  // Exported for reuse without side effects.
} else {
await main();
}

async function main() {
const servers = discover();
log(`reviewing ${servers.length} fixtures on the DGX (${process.env.SUREX_REVIEWER_BASE_URL ?? 'SUREX_REVIEWER_BASE_URL unset!'})\n`);

const reviewed = [];
for (const s of servers) {
  try {
    reviewed.push(await reviewOne(s));
  } catch (err) {
    log(`  ✗ ${s.name}: ${err.message}`);
    reviewed.push({ server: s, error: err.message });
  }
}

const db = reviewed.map((r) => {
  if (r.error) return { name: r.server.name, tier: r.server.tier, error: r.error };
  const { server, statedIntent, result, top, caps } = r;
  return {
    name: server.name,
    tier: server.tier,
    declaredTools: statedIntent.tools.map((t) => ({ name: t.name, description: t.description })),
    verdict: result.verdict,
    severity: result.severity,
    severityLabel: SEVERITY_LABEL[result.severity],
    agreementRuns: result.agreementRuns,
    capabilitySurface: caps,
    findingCount: result.findings?.length ?? 0,
    topFinding: top ? { category: top.category, severity: top.severity, file: top.file, line: top.line, description: top.description } : null,
    statedIntentSummary: result.statedIntentSummary ?? null,
    model: result.modelId,
    promptVersion: result.promptVersion,
  };
});

const downloads = join(homedir(), 'Downloads');
mkdirSync(downloads, { recursive: true });
const dbPath = join(downloads, 'surex-mcp-fixtures.json');
writeFileSync(dbPath, JSON.stringify({ generatedAt: new Date().toISOString(), servers: db }, null, 2));
log(`\ndatabase → ${dbPath}`);

const line = (r) => `${(r.name ?? '?').padEnd(20)} ${(r.tier ?? '?').padEnd(10)} ${(r.verdict ?? r.error ?? '?').padEnd(13)} sev ${r.severity ?? '-'} · ${(r.capabilitySurface ?? []).join(' ')}`;
log('\n' + db.map(line).join('\n'));

if (DRY) {
  log('\n--dry-run: reviewed and wrote the database, nothing published on chain.\n');
  process.exit(0);
}

log('\npublishing verdicts on chain…');

/**
 * The commit these fixtures were read at. The worker refuses to write a flag without
 * it: a head published with none renders "commit —" in its block message, which is a
 * finding the accused cannot trace to any bytes.
 */
let reviewedCommit = null;
try {
  reviewedCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
} catch {
  reviewedCommit = null;
}
if (!reviewedCommit) {
  log('  ✗ could not read the current git commit — refusing to publish a flag with no provenance');
  process.exit(1);
}
log(`  provenance: commit ${reviewedCommit.slice(0, 12)}`);

/**
 * Regenerate the self-authored allowlist from the fixtures about to be published, and
 * hand it to the worker, which refuses to flag anything absent from it.
 *
 * Fingerprints, computed here from the fixture directories — never names, because a
 * name is whatever the caller types and `totally-not-a-fixture-thirdparty` satisfies
 * any name regex.
 */
const selfAuthored = [];
for (const r of reviewed) {
  if (r.error) continue;
  const canonical = canonicalise({ command: 'node', args: [r.server.entry] }, { hashLocalEntry: localEntryResolver(ROOT) });
  selfAuthored.push(fingerprintOf(canonical));
}
mkdirSync(join(ROOT, 'packages', 'worker', 'state'), { recursive: true });
writeFileSync(fileURLToPath(selfAuthoredPath()), JSON.stringify(selfAuthored, null, 2));
setSelfAuthored(selfAuthored);
log(`  self-authored allowlist: ${selfAuthored.length} fingerprint(s) — nothing outside it can be flagged`);
const walrus = await createWalrusWriter({ log: () => {} });
const arkiv = createArkivWriter({ log: () => {} });

async function existingKey(fingerprint, entityType) {
  const rows = await arkiv.readBackScoped({ entityType, fingerprint, limit: 1 });
  return rows.length ? String(rows[0].key) : null;
}

for (const r of reviewed) {
  if (r.error) continue;
  const { server, statedIntent, result, top } = r;

  const config = { command: 'node', args: [server.entry] };
  const canonical = canonicalise(config, { hashLocalEntry: localEntryResolver(ROOT) });
  const fingerprint = fingerprintOf(canonical);

  // Idempotent: an existing head skips the whole server, including the Walrus write.
  // The SDK does not dedupe already-certified bytes (FRICTION-LOG S3), so a re-run
  // without this re-charges for every blob.
  if (await existingKey(fingerprint, 'verdictHead')) {
    log(`  · ${server.name.padEnd(20)} already on chain — skipped`);
    continue;
  }

  const state = result.verdict === 'flagged' ? 'flagged'
    : result.verdict === 'unreviewable' ? 'unreviewable' : 'clean';

  // AGENTS.md §4: publicly flag only SureX-authored fixtures. Everything here is one,
  // but the guard stays explicit so this script cannot be pointed elsewhere.
  if (state === 'flagged' && !/fixture|mal-|ambiguous-|honest-/.test(server.name)) {
    log(`  refusing to flag ${server.name}: not a SureX-authored fixture`);
    continue;
  }

  const body = {
    schema: 'surex.review/1',
    fingerprint,
    subject: `@surex/${server.name} (a ${server.tier} review fixture authored by the SureX project)`,
    verdict: result.verdict,
    severity: result.severity,
    findings: result.findings,
    statedIntentSummary: result.statedIntentSummary,
    capabilities: result.capabilities,
    modelId: result.modelId,
    promptVersion: result.promptVersion,
    agreementRuns: result.agreementRuns,
    analyzedAt: new Date().toISOString(),
    disclosure:
      `Review fixture, tier "${server.tier}", authored by the SureX project. Read statically by an ` +
      `open-source model; no human audited it. Not a statement about anyone else's code.`,
  };
  const bytes = recordBytes(body);
  const contentSha256 = sha256Hex(bytes);

  const pointer = await walrus.writeRecord(bytes, { label: server.name });

  let reviewKey = await existingKey(fingerprint, 'review');
  if (!reviewKey) {
    const { created } = await arkiv.createMany([
      buildReviewRecord({
        fingerprint, sourceKey: `in-repo:${relative(ROOT, server.dir).replace(/\\/g, '/')}`,
        verdict: result.verdict, severity: result.severity, analyzedAt: Date.now(),
        modelId: result.modelId, promptVersion: result.promptVersion,
        blob: { ...pointer, contentSha256 },
      }),
    ]);
    reviewKey = created[0].key;
  }

  const entry = buildRegistryEntry({ fingerprint, name: `@surex/${server.name}`, tier: 'C', blob: { ...pointer, contentSha256 } });
  const head = buildVerdictHead({
    fingerprint, state, tier: 'C', severity: result.severity,
    reason: state === 'unreviewable' ? 'source-unavailable' : undefined,
    enforceAfter: state === 'flagged' ? Date.now() + 72 * 3600 * 1000 : undefined,
    name: `@surex/${server.name}`,
    latestReviewKey: reviewKey, sourceKey: `in-repo:${server.name}`,
    modelId: result.modelId, promptVersion: result.promptVersion,
    reviewedCommit,
    reviewedAt: new Date().toISOString(),
    capabilities: result.capabilities, topFinding: top ?? undefined,
    evidence: { ...pointer, contentSha256 },
    requireReviewForClean: true,
    // This script publishes our fixtures. The allowlist does not gate accusations
    // generally, but a fixture publisher that reached outside the fixture directory
    // would be a bug, and asking for the predicate says so at the write boundary
    // rather than in this script's own control flow.
    requireSelfAuthored: isSelfAuthored,
  });

  const pending = [];
  if (!(await existingKey(fingerprint, 'registryEntry'))) pending.push(entry);
  if (!(await existingKey(fingerprint, 'verdictHead'))) pending.push(head);
  if (pending.length) await arkiv.createMany(pending);

  log(`  ✓ ${server.name.padEnd(20)} ${state.padEnd(13)} blob ${pointer.blobId.slice(0, 12)}… fp ${fingerprint.slice(0, 14)}…`);
}

log(`\ndone. Database at ${dbPath}\n`);
}
