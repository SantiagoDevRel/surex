// Checkpoint and resume for the seed.
//
// This exists because of a measured fact, not caution: the testnet SUI faucet
// produced continuous 429s for ~7 minutes, with a `retry-after` that reads
// "Wait for 0s", is not per-IP, and is discarded by the SDK — success came on
// attempt 53 of a blind loop (FRICTION-LOG S1). And `alreadyCertified` dedup is
// publisher behaviour, so re-running a Walrus write RE-CHARGES rather than
// deduplicating (S3). A seed that dies at record 40 and has to start over pays
// twice for the first 39.
//
// So: state is written after EVERY server, atomically, and re-running the same
// command continues instead of restarting. The file is the record of what really
// happened — it is never edited to look tidier, and a failure is stored as a
// failure.

import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { STATE_DIR } from './config.mjs';

export const DEFAULT_STATE_FILE = join(fileURLToPath(STATE_DIR), 'seed-progress.json');

const VERSION = 1;

export function emptyState({ runId, target, project, writerAddress, suiAddress }) {
  return {
    version: VERSION,
    runId,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    finishedAt: null,
    target,
    project,
    writerAddress,
    suiAddress,
    // Crawl output, frozen on first run so a resume seeds the SAME set. Re-crawling
    // on resume would silently change the population mid-run.
    candidates: [],
    /** fingerprint → { stage, licence, arkiv, error, … } */
    servers: {},
    quilt: null,
    counters: { attempted: 0, seeded: 0, licenceBlocked: 0, failed: 0 },
    notes: [],
  };
}

export function loadState(file = DEFAULT_STATE_FILE) {
  if (!existsSync(file)) return null;
  try {
    const state = JSON.parse(readFileSync(file, 'utf8'));
    if (state.version !== VERSION) return null;
    return state;
  } catch {
    return null;
  }
}

/**
 * Atomic write — temp file then rename. A seed interrupted mid-write must not
 * leave a truncated checkpoint, because an unparseable checkpoint is the same as
 * no checkpoint and costs the whole run.
 */
export function saveState(state, file = DEFAULT_STATE_FILE) {
  mkdirSync(dirname(file), { recursive: true });
  state.updatedAt = new Date().toISOString();
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
  return file;
}

export function recordServer(state, fingerprint, patch) {
  const prev = state.servers[fingerprint] ?? {};
  state.servers[fingerprint] = { ...prev, ...patch, at: new Date().toISOString() };
  return state.servers[fingerprint];
}

export function recountersFrom(state) {
  const counters = { attempted: 0, seeded: 0, licenceBlocked: 0, failed: 0 };
  for (const entry of Object.values(state.servers)) {
    counters.attempted += 1;
    if (entry.stage === 'seeded') counters.seeded += 1;
    if (entry.licence && entry.licence.eligible === false) counters.licenceBlocked += 1;
    if (entry.stage === 'failed') counters.failed += 1;
  }
  state.counters = counters;
  return counters;
}

/** Which candidates still need work, in the original order. */
export function pendingCandidates(state) {
  return state.candidates.filter((c) => state.servers[c.fingerprint]?.stage !== 'seeded');
}
