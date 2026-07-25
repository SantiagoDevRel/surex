// The read path, from the gate's side.
//
// Every call is on a hard budget. A PreToolUse hook that exceeds its timeout is
// killed and the tool call proceeds anyway (FRICTION-LOG C1), so a slow gate
// does not fail closed — it fails *silently*, which is worse than failing open
// loudly. The budgets here are set well inside the hook timeout so the gate
// always gets to say something.

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
 * One fingerprint. Returns `{head, from}` or throws.
 * A response that does not parse as a head is treated as no answer at all —
 * degrading to `unknown` (warn) rather than to `clean` (silent allow), because
 * the failure mode of a trust layer must never be "quietly says it is fine".
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
  // Answered and unanswered are kept apart on purpose. Synthesising an `unknown`
  // for a fingerprint the registry simply did not mention — and caching it —
  // lets a broken batch endpoint suppress a flag for the whole negative TTL.
  // See partitionBatchResponse.
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
