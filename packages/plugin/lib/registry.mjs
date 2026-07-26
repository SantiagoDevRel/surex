// The read path, from the gate's side. Every call is on a hard budget: a
// PreToolUse hook that exceeds its timeout is killed and the tool call proceeds
// anyway (FRICTION-LOG C1) — silently. Budgets stay well inside the hook timeout.

import { CACHE, DEFAULT_API_BASE, GATE_BUDGET, ROUTES, parseVerdictHead, partitionBatchResponse, unknownHead } from './core/index.mjs';

export function apiBase() {
  return (process.env.SUREX_API_URL || DEFAULT_API_BASE).replace(/\/+$/, '');
}

async function withTimeout(url, init, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One fingerprint. Returns `{head, from}` or throws. A response that does not
 * parse as a head degrades to `unknown` (warn), never to `clean` (silent allow).
 */
export async function fetchVerdict(fingerprint, opts = {}) {
  const url = `${apiBase()}${ROUTES.verdict(fingerprint)}`;
  const res = await withTimeout(url, { headers: { accept: 'application/json' } },
    opts.timeoutMs ?? GATE_BUDGET.networkTimeoutMs);
  if (!res.ok) throw new Error(`registry returned HTTP ${res.status}`);
  const json = await res.json();
  const head = parseVerdictHead(json?.head ?? json);
  if (!head) return { head: unknownHead(fingerprint), from: 'network', malformed: true };
  return { head, from: 'network' };
}

/** Many fingerprints in one round trip. Used by the SessionStart prefetch. */
export async function fetchVerdictBatch(fingerprints, opts = {}) {
  const url = `${apiBase()}${ROUTES.verdictBatch()}`;
  const res = await withTimeout(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ fps: fingerprints }),
  }, opts.timeoutMs ?? GATE_BUDGET.batchNetworkTimeoutMs);
  if (!res.ok) throw new Error(`registry returned HTTP ${res.status}`);
  const json = await res.json();
  const rows = Array.isArray(json) ? json : (json.heads ?? json.results ?? []);
  // Answered and unanswered are kept apart: synthesising an `unknown` for a
  // fingerprint the registry did not mention lets a broken batch endpoint suppress
  // a flag for the whole negative TTL.
  return partitionBatchResponse(fingerprints, rows);
}

/** TTL for a head, from the frozen cache policy. */
export function ttlFor(head) {
  const positive = head?.state && head.state !== 'unknown';
  return {
    ttlMs: positive ? CACHE.positiveTtlMs : CACHE.negativeTtlMs,
    // Only a flag earns a grace period past its TTL.
    graceMs: head?.state === 'flagged' || head?.state === 'disputed' ? CACHE.flaggedGraceMs : 0,
  };
}
