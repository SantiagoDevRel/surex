// Everything the gate keeps between runs. It ALL lives in ${CLAUDE_PLUGIN_DATA},
// never ${CLAUDE_PLUGIN_ROOT} — the root is replaced on every plugin update, so
// overrides written there would be wiped by one.

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** ${CLAUDE_PLUGIN_DATA}, falling back to ~/.surex for the CLI outside a session. */
export function dataDir() {
  const fromEnv = process.env.CLAUDE_PLUGIN_DATA;
  if (fromEnv) return fromEnv;
  return join(homedir(), '.surex');
}

function ensure(path) {
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

/** Write via a temp file + rename, so a killed hook cannot leave a half file. */
function writeAtomic(path, text) {
  ensure(path);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

function readJson(path, fallback) {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
  } catch {
    return fallback;
  }
}

export const paths = {
  cache: () => join(dataDir(), 'cache.json'),
  overrides: () => join(dataDir(), 'overrides.json'),
  log: () => join(dataDir(), 'gate.log'),
};

// ─── cache ──────────────────────────────────────────────────────────────────

/**
 * Disk cache, keyed by fingerprint. A cached `flagged` survives its TTL and the
 * registry being unreachable: a network blip must never un-flag a server already
 * known to be bad.
 */
export function readCache() {
  const raw = readJson(paths.cache(), { v: 1, entries: {} });
  return raw && raw.entries ? raw : { v: 1, entries: {} };
}

export function cacheGet(fingerprint, now = Date.now(), cache = readCache()) {
  const entry = cache.entries?.[fingerprint];
  if (!entry) return null;
  const fresh = now < entry.expiresAt;
  if (fresh) return { ...entry, stale: false };
  // Expired. Only a flagged verdict is still worth returning, marked stale.
  if (entry.head?.state === 'flagged' || entry.head?.state === 'disputed') {
    if (now < entry.expiresAt + (entry.graceMs ?? 0)) return { ...entry, stale: true };
  }
  return null;
}

export function cachePut(fingerprint, head, { ttlMs, graceMs = 0, now = Date.now() }) {
  const cache = readCache();
  cache.entries[fingerprint] = { head, storedAt: now, expiresAt: now + ttlMs, graceMs };
  // Keep the file from growing without bound over a long-lived install.
  const keys = Object.keys(cache.entries);
  if (keys.length > 500) {
    keys
      .sort((a, b) => (cache.entries[a].storedAt ?? 0) - (cache.entries[b].storedAt ?? 0))
      .slice(0, keys.length - 500)
      .forEach((k) => delete cache.entries[k]);
  }
  writeAtomic(paths.cache(), JSON.stringify(cache));
  return cache.entries[fingerprint];
}

export function cachePutMany(heads, opts) {
  for (const head of heads) {
    if (head?.fingerprint) cachePut(head.fingerprint, head, opts);
  }
}

// ─── overrides ──────────────────────────────────────────────────────────────

/**
 * The escape hatch: a block a user cannot pass is one that gets the gate
 * uninstalled. Overrides are local and are reported nowhere — which warnings a
 * user ignored never leaves the machine.
 */
export function readOverrides() {
  const raw = readJson(paths.overrides(), { v: 1, always: [], sessions: {} });
  return { v: 1, always: [], sessions: {}, ...raw };
}

export function isOverridden(fingerprint, sessionId, now = Date.now()) {
  const o = readOverrides();
  if (o.always.some((e) => e.fingerprint === fingerprint)) return { scope: 'always' };
  const forSession = o.sessions?.[sessionId];
  if (forSession?.some((e) => e.fingerprint === fingerprint && (!e.expiresAt || now > 0))) {
    return { scope: 'session' };
  }
  return null;
}

export function addOverride(fingerprint, { once = false, sessionId = null, note = null } = {}) {
  const o = readOverrides();
  const record = { fingerprint, at: new Date().toISOString(), ...(note ? { note } : {}) };
  if (once) {
    if (!sessionId) throw new Error('--once needs a session id');
    o.sessions[sessionId] = (o.sessions[sessionId] ?? []).filter((e) => e.fingerprint !== fingerprint);
    o.sessions[sessionId].push(record);
    // Session overrides from long-dead sessions are dead weight; keep the last few.
    const ids = Object.keys(o.sessions);
    if (ids.length > 20) ids.slice(0, ids.length - 20).forEach((id) => delete o.sessions[id]);
  } else {
    o.always = o.always.filter((e) => e.fingerprint !== fingerprint);
    o.always.push(record);
  }
  writeAtomic(paths.overrides(), JSON.stringify(o, null, 2));
  return record;
}

export function removeOverride(fingerprint) {
  const o = readOverrides();
  const before = o.always.length;
  o.always = o.always.filter((e) => e.fingerprint !== fingerprint);
  for (const id of Object.keys(o.sessions)) {
    o.sessions[id] = o.sessions[id].filter((e) => e.fingerprint !== fingerprint);
  }
  writeAtomic(paths.overrides(), JSON.stringify(o, null, 2));
  return before !== o.always.length;
}

// ─── log ────────────────────────────────────────────────────────────────────

/**
 * A local, append-only record of what the gate did. It never leaves the machine.
 * Exists so "why did that get blocked" is answerable after the fact, and so
 * registry hit rate is measurable at all (failure-modes §3.1).
 */
export function logDecision(entry) {
  try {
    const path = ensure(paths.log());
    writeFileSync(path, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', { flag: 'a' });
  } catch {
    // Logging must never be able to break a tool call.
  }
}

export function readLog(limit = 200) {
  try {
    return readFileSync(paths.log(), 'utf8')
      .trim()
      .split('\n')
      .slice(-limit)
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}
