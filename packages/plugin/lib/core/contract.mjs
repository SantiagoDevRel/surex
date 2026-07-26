// AUTO-GENERATED — do not edit.
// Vendored from packages/core/src by scripts/sync-core.mjs, because the plugin
// runs on a user's machine with nothing installed. Edit the original and re-run
// `pnpm sync:core`.
// The /v1 contract. FROZEN — 2026-07-25.
//
// Additive changes only. Anything that would break a shipped gate goes to /v2.
// Node stdlib only — vendored into the plugin.

export const API_VERSION = 'v1';
export const CONTRACT_FROZEN_AT = '2026-07-25';

/**
 * Default public base URL — the deployed registry. Must be a host that actually
 * answers: an unreachable default makes every tool call fail open, visibly, and
 * read as broken rather than unconfigured. Overridable with SUREX_API_URL.
 */
export const DEFAULT_API_BASE = 'https://arkiv-surex-api.vercel.app';

export const ROUTES = Object.freeze({
  /** Hot path. Cacheable, must never block on a write. */
  verdict: (fp) => `/${API_VERSION}/verdict?fp=${encodeURIComponent(fp)}`,
  /** SessionStart prefetch — one round trip for every server in the config. */
  verdictBatch: () => `/${API_VERSION}/verdicts/batch`,
  entry: (fp) => `/${API_VERSION}/entry/${encodeURIComponent(fp)}`,
  source: (key) => `/${API_VERSION}/source/${encodeURIComponent(key)}`,
  review: (key) => `/${API_VERSION}/review/${encodeURIComponent(key)}`,
  submissions: () => `/${API_VERSION}/submissions`,
  disputes: () => `/${API_VERSION}/disputes`,
  /** Public feed, for org-level gateways that want to mirror the flags (FR-14). */
  flagged: () => `/${API_VERSION}/flagged`,
  /**
   * The whole registry, every state — what a browse page needs. `flagged` is the
   * wrong shape for browsing: seeded entries are written `unknown`, so a
   * flagged-only feed shows an empty registry.
   */
  registry: (params = {}) => {
    const q = new URLSearchParams();
    if (params.limit) q.set('limit', String(params.limit));
    if (params.state) q.set('state', params.state);
    const qs = q.toString();
    return `/${API_VERSION}/registry${qs ? `?${qs}` : ''}`;
  },
  /** Registry hit rate and friends. */
  stats: () => `/${API_VERSION}/stats`,
});

/**
 * @typedef {Object} VerdictHead   the whole hot-path answer
 * @property {string}  fingerprint
 * @property {string}  state           clean|flagged|disputed|unreviewable|stale|unknown
 * @property {number}  severity        0-4
 * @property {'A'|'B'|'C'} tier
 * @property {string=} reason          licence|source-unavailable|remote-endpoint|no-agreement
 *                                     (the first three mean the code could not be read;
 *                                      `no-agreement` means it was read and the readings
 *                                      did not converge — a review with no verdict)
 * @property {string=} name            display name, e.g. "@acme/mcp-tools@2.1.0"
 * @property {number=} enforceAfter    epoch ms; selects block WORDING, not whether we block
 * @property {string=} reviewedCommit
 * @property {string=} reviewedAt      ISO date
 * @property {string=} modelId
 * @property {string=} promptVersion
 * @property {string=} integrity       npm dist.integrity recorded at review time (Tier A)
 * @property {Object=} capabilities    deterministic scan, not model output
 * @property {Object=} topFinding      {file,line,description,severity,category}
 * @property {string=} concern         the KIND of gap between what the server says and
 *                                     what it does — one of reviewer CONCERNS (rv-7).
 *                                     ADDITIVE: absence means "not stated", never
 *                                     "nothing found".
 * @property {string=} assessment      one or two sentences a developer can act on,
 *                                     from the reading that decided the verdict
 * @property {number=} findingCount    how many findings the published verdict rests on.
 *                                     `topFinding` is the first of these, not the only one.
 * @property {string=} disputeSummary
 * @property {Object=} evidence        {blobId, suiObjectId, registerTx, certifyTx, encodingType}
 * @property {string=} arkivEntityKey
 * @property {string=} updatedAt
 * @property {boolean=} illustrative   TRUE when this row is demo data, never omitted when it is
 */

/** Everything the gate needs, and nothing that needs a second fetch to act on. */
export const VERDICT_HEAD_FIELDS = Object.freeze([
  'fingerprint', 'state', 'severity', 'tier', 'reason', 'name', 'enforceAfter',
  'reviewedCommit', 'reviewedAt', 'modelId', 'promptVersion', 'integrity',
  'capabilities', 'topFinding', 'concern', 'assessment', 'findingCount',
  'disputeSummary', 'evidence', 'arkivEntityKey',
  'updatedAt', 'illustrative',
]);

/** The one shape every error uses, so a client never has to guess. */
export function apiError(code, message, extra = {}) {
  return { error: { code, message, ...extra } };
}

export const ERROR_CODES = Object.freeze({
  BAD_FINGERPRINT: 'bad_fingerprint',
  NOT_FOUND: 'not_found',
  RATE_LIMITED: 'rate_limited',
  UNAUTHENTICATED: 'unauthenticated',
  AGENT_NOT_HUMAN_BACKED: 'agent_not_human_backed',
  UPSTREAM_UNAVAILABLE: 'upstream_unavailable',
  INVALID_BODY: 'invalid_body',
  /**
   * An unexpected fault on our side — never `upstream_unavailable`, which blames
   * the wrong party and misleads a client deciding whether to retry.
   */
  INTERNAL: 'internal',
  /** A route that exists in the contract but is not built in this deployment. */
  NOT_IMPLEMENTED: 'not_implemented',
});

/**
 * The batch envelope. `invalid` exists so one malformed fingerprint cannot fail
 * a whole prefetch: twenty servers with one bad entry must still warm nineteen.
 *
 * @typedef {Object} BatchResponse
 * @property {number}  requested   how many valid fingerprints were asked about
 * @property {Array}   heads       one per valid requested fingerprint, IN REQUEST ORDER
 * @property {string[]} invalid    entries rejected as not-a-fingerprint
 * @property {number}  ttlMs       how long the caller may cache these
 */
export const BATCH_MAX = 100;

const FINGERPRINT_RE = /^sxf1_[0-9a-f]{64}$/;

export function isFingerprint(value) {
  return typeof value === 'string' && FINGERPRINT_RE.test(value);
}

/**
 * Validate a head coming off the wire before the gate acts on it.
 * The gate makes a security decision from this object, so a malformed response
 * must degrade to `unknown` (fail open, visibly) and never to `clean`.
 */
export function parseVerdictHead(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!isFingerprint(raw.fingerprint)) return null;
  if (typeof raw.state !== 'string') return null;

  const severity = Number(raw.severity);
  const head = {
    fingerprint: raw.fingerprint,
    state: raw.state,
    severity: Number.isFinite(severity) ? severity : 0,
    tier: ['A', 'B', 'C', 'MISMATCH'].includes(raw.tier) ? raw.tier : 'C',
  };
  for (const key of VERDICT_HEAD_FIELDS) {
    if (key in head) continue;
    if (raw[key] !== undefined && raw[key] !== null) head[key] = raw[key];
  }
  return head;
}

/** The `unknown` answer, so callers never have to synthesise one inconsistently. */
export function unknownHead(fingerprint) {
  return { fingerprint, state: 'unknown', severity: 0, tier: 'C' };
}

/**
 * A batch response MUST answer for every fingerprint it was asked about, so a
 * caller can tell "the registry says it has no entry for this" from "the
 * registry did not answer for this".
 *
 * Security-relevant: synthesising an `unknown` for an unanswered fingerprint and
 * caching it serves a FLAGGED server out of cache as `unknown` for the whole
 * negative TTL — no lookup, no block. A miss may only be cached when the
 * registry actually said so.
 */
export function partitionBatchResponse(requested, rows) {
  const byFp = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const head = parseVerdictHead(row);
    if (head) byFp.set(head.fingerprint, head);
  }
  const answered = [];
  const unanswered = [];
  for (const fp of requested) {
    if (byFp.has(fp)) answered.push(byFp.get(fp));
    else unanswered.push(fp);
  }
  return { answered, unanswered };
}

/**
 * Cache policy. Sits in the contract because the gate and the API must agree:
 * a positive TTL the server does not honour is a stale block waiting to happen.
 */
export const CACHE = Object.freeze({
  positiveTtlMs: 15 * 60 * 1000,
  negativeTtlMs: 120 * 1000,
  /**
   * A cached `flagged` outlives its TTL when the registry cannot be reached.
   * A network blip must never un-flag a server we already know is bad.
   */
  flaggedGraceMs: 30 * 24 * 60 * 60 * 1000,
});

/** The gate's own budget. Must sit well inside the hook timeout — FRICTION-LOG C1. */
export const GATE_BUDGET = Object.freeze({
  hookTimeoutSeconds: 10,
  networkTimeoutMs: 1500,
  batchNetworkTimeoutMs: 6000,
});
