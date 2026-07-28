#!/usr/bin/env node
/**
 * Seed the registry from the official MCP Registry.
 *
 *   node scripts/seed.mjs                 # seed (resumes if a checkpoint exists)
 *   node scripts/seed.mjs --target 30     # smaller run
 *   node scripts/seed.mjs --dry-run       # crawl + licence gate + fingerprints, no writes
 *   node scripts/seed.mjs --reset         # discard the checkpoint and start over
 *   node scripts/seed.mjs --verify        # re-read what is on chain, write nothing
 *   node scripts/seed.mjs --repair-pointers   # re-derive quilt patch ids and fix the entries
 *
 * The two rules this script exists to honour
 *
 * 1. Seeded entries are `unknown`, never `clean` — being listed is not an
 *    endorsement, and a seeded entry that inherits an existing backdoor must gain
 *    no legitimacy from it. entities.mjs enforces it too: `buildVerdictHead`
 *    refuses `clean` without a review key.
 *
 * 2. The ~50 seed-time RegistryEntry bodies go into one Walrus Quilt. A standalone
 *    blob is two Sui transactions, so 50 of them is 100, and transaction count is
 *    the real budget (the testnet faucet took 53 blind attempts to answer once,
 *    FRICTION-LOG S1); a quilt batches up to 660 small blobs into 2 transactions
 *    total. Standalone certified blobs stay for source trees, reviews and dispute
 *    evidence, where per-record citability is the point.
 *
 *    The trade: a quilted record is addressed as (quilt blob, patch id) and has no
 *    certified Sui object of its own, so no per-record explorer link. Every pointer
 *    written here carries `addressing: 'quilt-patch'`, its own `patchId` and the
 *    quilt's digests, so a reader can tell which kind of record they have.
 */

// @surex/core and @surex/worker are imported by relative path, not package name: the
// repo root is a private workspace container with no dependencies of its own, so pnpm
// links neither into the root node_modules. `viem` and `@arkiv-network/sdk` do resolve
// by name — node-linker=hoisted puts them at the root (see .npmrc).
import { formatEther } from 'viem';
import {
  PROJECT,
  createWalrusWriter,
  createArkivWriter,
  collectCandidates,
  licenceGate,
  buildRegistryEntry,
  buildVerdictHead,
  loadState,
  saveState,
  emptyState,
  recordServer,
  recountersFrom,
  pendingCandidates,
  DEFAULT_STATE_FILE,
} from '../packages/worker/index.mjs';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? fallback : argv[at + 1];
};

const TARGET = Number(value('target', 50));
const DRY_RUN = flag('dry-run');
const RESET = flag('reset');
const VERIFY_ONLY = flag('verify');
const REPAIR_POINTERS = flag('repair-pointers');
const STATE_FILE = value('state', DEFAULT_STATE_FILE);
/** Arkiv creates per transaction. 50–100 per tech spec §4.3; 25 keeps a failure cheap. */
const ARKIV_CHUNK = Number(value('chunk', 25));
/** Licence-gate concurrency. Each candidate is up to ~11 HTTP requests. */
const LICENCE_CONCURRENCY = Number(value('concurrency', 4));

const log = (...a) => console.log(...a);
const step = (t) => log(`\n── ${t} ${'─'.repeat(Math.max(0, 62 - t.length))}`);

/**
 * The disclosure on every seeded record. SureX copy, so the copy law binds it: the
 * word is *reviewed*, and a listing is never an endorsement.
 */
const SEED_DISCLOSURE =
  'Seeded from the public MCP registry. Nobody has reviewed this code. The entry exists so ' +
  'the fingerprint resolves to something, and its state stays "unknown" until a review is written ' +
  'against a specific version.';
const LICENCE_DISCLOSURE =
  'No source was uploaded: the licence either does not permit redistribution or could not be matched ' +
  'against an SPDX template. An unmatched licence is treated as ineligible, not as permissive.';

/** Bounded-concurrency map that reports each completion as it lands. */
async function pool(items, limit, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}

step('0 · preflight');
const walrusWriter = await createWalrusWriter({ log });
const { sui, wal } = await walrusWriter.balances();
const maxEpochs = await walrusWriter.maxEpochs();
const nShards = await walrusWriter.nShards();
log(`  sui wallet  ${walrusWriter.address}`);
log(`  SUI ${sui} MIST · WAL ${wal} FROST · max epochs ${maxEpochs} (on chain) · n_shards ${nShards}`);

const arkiv = createArkivWriter({ log });
const health = await arkiv.health();
log(`  arkiv writer ${arkiv.address} · ${formatEther(health.balance)} GLM · chainId ${health.chainId}`);
log(`  project ${PROJECT}`);

if (!DRY_RUN && !VERIFY_ONLY && !REPAIR_POINTERS) {
  if (sui === 0n) throw new Error('SUI balance is zero — fund before seeding (faucet risk, S1)');
  if (health.balance === 0n) throw new Error('Arkiv writer balance is zero — nothing would be written');
  if (wal === 0n) {
    log('  WAL is zero → swapping 0.5 SUI for WAL');
    const swap = await walrusWriter.ensureWal();
    log(`  WAL now ${swap.wal} FROST${swap.digest ? ` (tx ${swap.digest})` : ''}`);
  }
}

// Reads only what a consumer can read — the `.createdBy(writer)` scoped query — then
// follows every evidence pointer to the bytes and hashes them. Counts alone prove
// nothing: 50 rows each pointing at the wrong record also counts to 50.
if (VERIFY_ONLY) {
  step('verify · re-read from chain, then follow every evidence pointer');
  const { eq } = await import('@arkiv-network/sdk/query');
  const entryCount = Number(await arkiv.count('registryEntry'));
  const headCount = Number(await arkiv.count('verdictHead'));
  const byState = {};
  for (const s of ['unknown', 'unreviewable', 'clean', 'flagged', 'disputed', 'stale']) {
    byState[s] = Number(await arkiv.count('verdictHead', [eq('state', s)]));
  }
  log(`  registryEntry ${entryCount} · verdictHead ${headCount}`);
  log(`  heads by state ${JSON.stringify(byState)}`);
  if (byState.clean > 0) log('  ⚠ a head is `clean` with no review behind it — investigate before demoing');

  const { entities, pages, truncated } = await arkiv.readAllScoped({ entityType: 'registryEntry' });
  log(`  read ${entities.length} registryEntry entities over ${pages} page(s)${truncated ? ' (TRUNCATED)' : ''}`);

  const attrOf = (e, k) => e.attributes?.find((a) => a.key === k)?.value;
  const pointers = [];
  for (const e of entities) {
    const body = e.toJson?.() ?? {};
    if (!body.blob?.patchId) continue;
    pointers.push({ fingerprint: attrOf(e, 'fingerprint'), name: attrOf(e, 'name'), blob: body.blob });
  }
  const read = await walrusWriter.readQuiltPatches(pointers.map((p) => p.blob.patchId));
  const servedById = new Map(read.map((r) => [r.patchId, r]));

  let shaOk = 0;
  let identityOk = 0;
  const failures = [];
  for (const p of pointers) {
    const served = servedById.get(p.blob.patchId);
    if (!served) {
      failures.push(`${p.name}: patch ${p.blob.patchId} not retrievable`);
      continue;
    }
    if (served.contentSha256 === p.blob.contentSha256) shaOk += 1;
    else failures.push(`${p.name}: sha256 ${served.contentSha256.slice(0, 12)} vs recorded ${String(p.blob.contentSha256).slice(0, 12)}`);
    let bodyFp = null;
    try {
      bodyFp = JSON.parse(served.bytes.toString('utf8')).fingerprint;
    } catch {
      /* not JSON */
    }
    if (bodyFp === p.fingerprint) identityOk += 1;
    else failures.push(`${p.name}: entity fp ${p.fingerprint} but patch body says ${bodyFp}`);
  }
  log(`  evidence: ${shaOk}/${pointers.length} bytes match the recorded contentSha256`);
  log(`  identity: ${identityOk}/${pointers.length} patch bodies self-identify as the right record`);
  for (const f of failures.slice(0, 10)) log(`    ✗ ${f}`);
  process.exit(failures.length ? 1 : 0);
}

// Frozen on the first run, so a resume seeds the same set.
step('1 · candidates');
let state = RESET ? null : loadState(STATE_FILE);
if (state) {
  log(`  resuming run ${state.runId} started ${state.startedAt}`);
  log(`  ${state.candidates.length} candidates frozen · ${Object.keys(state.servers).length} already touched`);
} else {
  state = emptyState({
    runId: `seed-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    target: TARGET,
    project: PROJECT,
    writerAddress: arkiv.address,
    suiAddress: walrusWriter.address,
  });
  const { candidates, stats } = await collectCandidates({ target: TARGET, log });
  state.candidates = candidates;
  state.notes.push(`crawl: ${JSON.stringify(stats)}`);
  log(`  ${candidates.length} candidates from ${stats.rowsSeen} active registry rows over ${stats.pages} pages`);
  log(`  skipped: ${stats.skippedNoPackage} unfingerprintable · ${stats.skippedNoRepo} with no repository`);
  saveState(state, STATE_FILE);
}

const tierCounts = {};
for (const c of state.candidates) tierCounts[c.tier] = (tierCounts[c.tier] ?? 0) + 1;
log(`  tiers ${JSON.stringify(tierCounts)}`);
for (const c of state.candidates.slice(0, 3)) log(`  e.g. ${c.name} → ${c.fingerprint} (tier ${c.tier})`);

step('2 · licence gate (FR-16) — before any source upload');
const needLicence = state.candidates.filter((c) => !state.servers[c.fingerprint]?.licence);
log(`  ${needLicence.length} to resolve (${state.candidates.length - needLicence.length} already on file)`);

let done = 0;
await pool(needLicence, LICENCE_CONCURRENCY, async (candidate) => {
  let result;
  try {
    result = await licenceGate(candidate);
  } catch (err) {
    result = { eligible: false, spdx: null, source: 'error', detail: err.message, integrity: null };
  }
  recordServer(state, candidate.fingerprint, { licence: result, stage: 'licence-resolved' });
  done += 1;
  // After every server, so a stall costs one record and not the run.
  saveState(state, STATE_FILE);
  const mark = result.eligible ? 'eligible' : 'INELIGIBLE';
  log(`  [${done}/${needLicence.length}] ${candidate.name} → ${result.spdx ?? '—'} ${mark} (${result.source})`);
});
recountersFrom(state);
saveState(state, STATE_FILE);

const eligible = state.candidates.filter((c) => state.servers[c.fingerprint]?.licence?.eligible);
const blocked = state.candidates.filter((c) => state.servers[c.fingerprint]?.licence?.eligible === false);
log(`  → ${eligible.length} redistribution-permitting · ${blocked.length} written unreviewable(licence)`);

if (DRY_RUN) {
  step('dry run · nothing written');
  log(`  would write ${state.candidates.length} registryEntry + ${state.candidates.length} verdictHead`);
  log(`  would write 1 quilt with ${state.candidates.length} patches (2 Sui transactions)`);
  log(`  checkpoint: ${saveState(state, STATE_FILE)}`);
  process.exit(0);
}

step('3 · Walrus — one quilt, every seed RegistryEntry body');
/**
 * The record body. Must be byte-deterministic for a given candidate, or the digest
 * recorded on the Arkiv entity cannot be re-derived and every later check degrades to
 * "trust the store" — hence `capturedAt` minted once per server into the checkpoint,
 * never `new Date()` at call time.
 */
function entryBody(candidate) {
  const record = state.servers[candidate.fingerprint];
  const licence = record.licence;
  if (!record.capturedAt) {
    recordServer(state, candidate.fingerprint, { capturedAt: new Date().toISOString() });
  }
  return {
    schema: 'surex.registryEntry/1',
    fingerprint: candidate.fingerprint,
    name: candidate.name,
    tier: candidate.tier,
    // What was hashed to get the fingerprint. Recorded so anyone can recompute it.
    canonicalConfig: candidate.canonicalConfig,
    canonical: candidate.canonical,
    seedSource: candidate.seedSource,
    // The server's own words, quoted verbatim from the registry. Not SureX copy.
    registryName: candidate.registryName,
    title: candidate.title,
    description: candidate.description,
    websiteUrl: candidate.websiteUrl,
    registryVersion: candidate.version,
    repo: candidate.repo,
    pkg: candidate.pkg,
    // The pinned form of the same server is a different fingerprint under SXF-1.
    // `seeded: false` keeps it from reading as a claim that it is in the registry.
    aliases: candidate.pinned
      ? [{ kind: 'pinned-version', fingerprint: candidate.pinned.fingerprint, tier: candidate.pinned.tier, seeded: false }]
      : [],
    licence: {
      spdx: licence.spdx,
      eligible: licence.eligible,
      source: licence.source,
      detail: licence.detail,
    },
    // npm dist.integrity, recorded now because it becomes unobtainable once a version
    // is unpublished. It is what makes Tier A reachable later.
    integrity: licence.integrity ?? null,
    capturedAt: state.servers[candidate.fingerprint].capturedAt,
    disclosure: licence.eligible ? SEED_DISCLOSURE : `${SEED_DISCLOSURE} ${LICENCE_DISCLOSURE}`,
  };
}

if (state.quilt?.certifyTx) {
  log(`  quilt already certified, reusing: ${state.quilt.blobId}`);
} else {
  const items = state.candidates.map((c) => ({
    // Patch identifiers must be unique inside a quilt; the fingerprint already is.
    identifier: c.fingerprint,
    body: entryBody(c),
    tags: { entityType: 'registryEntry', name: c.name, tier: c.tier },
  }));
  const { quilt, patches } = await walrusWriter.writeQuiltOfRecords(items, { label: 'seed-registry-entries' });
  state.quilt = quilt;
  for (const [fingerprint, pointer] of patches) {
    recordServer(state, fingerprint, { entryBlob: pointer, stage: 'blob-written' });
  }
  saveState(state, STATE_FILE);
  log(`  quilt blobId     ${quilt.blobId}`);
  log(`  quilt suiObject  ${quilt.suiObjectId}`);
  log(`  registerTx       ${quilt.registerTx}`);
  log(`  certifyTx        ${quilt.certifyTx}`);
  log(`  ${quilt.patchCount} patches · ${quilt.size} B · ${quilt.epochs} epochs · nShards ${quilt.nShards} · ${quilt.encodingType}`);
}

// Repairs a mis-recorded identifier → patch-id mapping. `flow.listFiles()` returns
// patch ids with no identifier and not in input order (positional mapping measured
// right for 1 of 50), so a seed written under that assumption has every entry
// pointing at another entry's bytes. The mapping is re-derived from the certified
// quilt itself — identifier from the quilt index, digest from the bytes it serves.
// It does not write a new quilt: those bytes are certified, and re-writing re-charges
// (S3).
if (REPAIR_POINTERS) {
  step('3b · repair — re-derive quilt patch ids from the certified quilt');
  if (!state.quilt?.blobId) throw new Error('no certified quilt in the checkpoint; nothing to repair');

  const knownPatchIds = state.candidates
    .map((c) => state.servers[c.fingerprint]?.entryBlob?.patchId)
    .filter(Boolean);
  log(`  ${knownPatchIds.length} patch ids on file · quilt ${state.quilt.blobId}`);

  const { patches, read } = await walrusWriter.mapCertifiedQuilt(state.quilt, { patchIds: knownPatchIds });
  log(`  read ${read.length} patches back · ${patches.size} distinct identifiers`);

  // Cross-check against the record's own content, not just the index: each body
  // carries its fingerprint and it must equal the identifier the quilt gave the
  // patch. Disagreement means the mapping is unreliable, so nothing gets written.
  let bodyChecked = 0;
  for (const patch of read) {
    let body;
    try {
      body = JSON.parse(patch.bytes.toString('utf8'));
    } catch {
      throw new Error(`quilt patch ${patch.patchId} is not JSON`);
    }
    if (body.fingerprint !== patch.identifier) {
      throw new Error(
        `patch ${patch.patchId}: quilt index says identifier ${patch.identifier}, the body says ${body.fingerprint}`,
      );
    }
    bodyChecked += 1;
  }
  log(`  ${bodyChecked}/${read.length} patch bodies self-identify consistently with the quilt index`);

  let wrong = 0;
  const updates = [];
  for (const candidate of state.candidates) {
    const record = state.servers[candidate.fingerprint];
    const correct = patches.get(candidate.fingerprint);
    if (!correct) throw new Error(`no patch for ${candidate.fingerprint}`);
    if (record.entryBlob?.patchId === correct.patchId) continue;
    wrong += 1;
    recordServer(state, candidate.fingerprint, { entryBlob: correct, pointerRepaired: true });
    if (!record.registryEntryKey) continue;
    // updateEntity is a full replacement, so the entity is rebuilt in its entirety
    // by the same builder — which re-includes the project attribute, without which
    // it would silently drop out of every scoped query.
    updates.push({
      entityKey: record.registryEntryKey,
      built: buildRegistryEntry({
        fingerprint: candidate.fingerprint,
        name: candidate.name,
        tier: candidate.tier,
        blob: correct,
      }),
    });
  }
  saveState(state, STATE_FILE);
  log(`  ${wrong} of ${state.candidates.length} pointers were wrong · ${updates.length} entities to rewrite`);

  for (let i = 0; i < updates.length; i += ARKIV_CHUNK) {
    const slice = updates.slice(i, i + ARKIV_CHUNK);
    const res = await arkiv.updateMany(slice);
    log(`  rewrote ${Math.min(i + ARKIV_CHUNK, updates.length)}/${updates.length} · tx ${res.txHashes.join(', ')}`);
    saveState(state, STATE_FILE);
  }

  // Prove one repaired entry end to end: read the entity, fetch its patch, hash it.
  const sample = state.candidates[0];
  const entities = await arkiv.readBackScoped({
    entityType: 'registryEntry',
    fingerprint: sample.fingerprint,
    limit: 1,
  });
  const onChain = entities[0]?.toJson?.()?.blob;
  const refetched = await walrusWriter.readQuiltPatches([onChain.patchId]);
  const bodyFp = JSON.parse(refetched[0].bytes.toString('utf8')).fingerprint;
  log(
    `  spot check ${sample.name}: entity fp ${sample.fingerprint.slice(0, 14)}… → patch body fp ` +
      `${String(bodyFp).slice(0, 14)}… · sha256 ${refetched[0].contentSha256 === onChain.contentSha256 ? 'MATCH' : 'MISMATCH'}`,
  );
  if (bodyFp !== sample.fingerprint) throw new Error('repaired pointer still points at the wrong record');
  state.notes.push(`pointer repair: ${wrong} of ${state.candidates.length} corrected at ${new Date().toISOString()}`);
  saveState(state, STATE_FILE);
  log('\n  repair complete');
  process.exit(0);
}

step('4 · Arkiv — registryEntry + verdictHead per server');
const pending = pendingCandidates(state);
log(`  ${pending.length} servers to write (${state.candidates.length - pending.length} already seeded)`);

for (let i = 0; i < pending.length; i += ARKIV_CHUNK) {
  const slice = pending.slice(i, i + ARKIV_CHUNK);
  const built = [];
  const owners = [];
  for (const candidate of slice) {
    const record = state.servers[candidate.fingerprint];
    const licence = record.licence;
    const pointer = record.entryBlob;
    if (!pointer) throw new Error(`no quilt patch pointer for ${candidate.fingerprint}`);

    built.push(
      buildRegistryEntry({
        fingerprint: candidate.fingerprint,
        name: candidate.name,
        tier: candidate.tier,
        blob: pointer,
      }),
    );
    owners.push({ fingerprint: candidate.fingerprint, kind: 'registryEntry' });

    built.push(
      buildVerdictHead({
        fingerprint: candidate.fingerprint,
        // The whole rule, in one expression: never `clean` from a seed.
        state: licence.eligible ? 'unknown' : 'unreviewable',
        reason: licence.eligible ? undefined : 'licence',
        tier: candidate.tier,
        severity: 0,
        // An eligible-but-unreviewed entry is the reviewer's work queue (query (e)).
        // A licence-blocked one is not: no amount of re-analysis changes a licence.
        needsReanalysis: licence.eligible,
        name: candidate.name,
        integrity: licence.integrity ?? undefined,
        seedSource: candidate.seedSource,
      }),
    );
    owners.push({ fingerprint: candidate.fingerprint, kind: 'verdictHead' });
  }

  const { created, txHashes } = await arkiv.createMany(built, { chunk: built.length });
  for (let j = 0; j < created.length; j += 1) {
    const owner = owners[j];
    const patch = owner.kind === 'registryEntry'
      ? { registryEntryKey: created[j].key }
      : { verdictHeadKey: created[j].key };
    recordServer(state, owner.fingerprint, patch);
  }
  for (const candidate of slice) {
    const r = state.servers[candidate.fingerprint];
    if (r.registryEntryKey && r.verdictHeadKey) {
      recordServer(state, candidate.fingerprint, {
        stage: 'seeded',
        state: r.licence.eligible ? 'unknown' : 'unreviewable',
        arkivTx: txHashes[0],
      });
    }
  }
  recountersFrom(state);
  saveState(state, STATE_FILE);
  log(`  checkpoint after ${Math.min(i + ARKIV_CHUNK, pending.length)}/${pending.length} servers`);
}

step('5 · read back — the same .createdBy(writer) scoped query the gate runs');
const { eq } = await import('@arkiv-network/sdk/query');
const entryCount = Number(await arkiv.count('registryEntry'));
const headCount = Number(await arkiv.count('verdictHead'));
const unknownCount = Number(await arkiv.count('verdictHead', [eq('state', 'unknown')]));
const unreviewableCount = Number(await arkiv.count('verdictHead', [eq('state', 'unreviewable')]));
const cleanCount = Number(await arkiv.count('verdictHead', [eq('state', 'clean')]));
log(`  registryEntry ${entryCount} · verdictHead ${headCount}`);
log(`  unknown ${unknownCount} · unreviewable ${unreviewableCount} · clean ${cleanCount}`);
if (cleanCount !== 0) log('  ⚠ a seeded head is `clean` — that must never happen, investigate before demoing');

const sampleFp = state.candidates.find((c) => state.servers[c.fingerprint]?.stage === 'seeded')?.fingerprint;
if (sampleFp) {
  const found = await arkiv.waitForIndexed({ entityType: 'verdictHead', fingerprint: sampleFp });
  log(`  spot check ${sampleFp} visible in ${found.ms} ms · ${found.entities.length} entity`);
}

state.finishedAt = new Date().toISOString();
recountersFrom(state);
saveState(state, STATE_FILE);

step('summary');
log(`  attempted        ${state.candidates.length}`);
log(`  seeded           ${state.counters.seeded}`);
log(`  licence-blocked  ${state.counters.licenceBlocked} (written unreviewable, reason=licence)`);
log(`  failed           ${state.counters.failed}`);
log(`  quilt blobId     ${state.quilt?.blobId}`);
log(`  quilt registerTx ${state.quilt?.registerTx}`);
log(`  quilt certifyTx  ${state.quilt?.certifyTx}`);
log(`  checkpoint       ${STATE_FILE}`);
const after = await walrusWriter.balances();
log(`  SUI spent        ${sui - after.sui} MIST · WAL spent ${wal - after.wal} FROST`);
