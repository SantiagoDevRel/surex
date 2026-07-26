// AUTO-GENERATED — do not edit.
// Vendored from packages/core/src by scripts/sync-core.mjs, because the plugin
// runs on a user's machine with nothing installed. Edit the original and re-run
// `pnpm sync:core`.
// Fetching the evidence, and checking it is the evidence that was judged.
//
// Node stdlib only — vendored into the plugin.

import { createHash } from 'node:crypto';
import { computeBlobId as recomputeBlobId, encoderAvailable } from './blobid.mjs';

/**
 * Public testnet aggregators. Read in order; the first that answers wins.
 * HTTP read endpoints only — package and object IDs must be read at runtime (§5).
 */
export const DEFAULT_AGGREGATORS = Object.freeze([
  'https://aggregator.walrus-testnet.walrus.space',
  'https://wal-aggregator-testnet.staketab.org',
  'https://walrus-testnet-aggregator.nodes.guru',
]);

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Is this evidence pointer a patch inside a Quilt rather than a blob of its own?
 * A quilted record is addressed as (quilt blob, patch id) and gets NO certified
 * Sui object of its own.
 */
export function isQuiltPatch(evidence) {
  return Boolean(evidence?.patchId || evidence?.addressing === 'quilt-patch');
}

/**
 * Fetch a blob by ID, trying each aggregator until one answers. Returns the raw
 * bytes plus which aggregator served them — "which node told you this" is part
 * of the provenance.
 *
 * A quilt patch takes a different route (`/v1/blobs/by-quilt-patch-id/<patchId>`):
 * a patch id on the plain blob route is a 400, and fetching the QUILT for a patch
 * returns ~9x the bytes, whose digest then fails the content check on a record
 * that is perfectly fine.
 */
export async function fetchBlob(blobId, opts = {}) {
  const aggregators = opts.aggregators ?? DEFAULT_AGGREGATORS;
  const timeoutMs = opts.timeoutMs ?? 4000;
  const patchId = opts.patchId ?? null;
  const errors = [];

  for (const base of aggregators) {
    const url = patchId
      ? `${base.replace(/\/+$/, '')}/v1/blobs/by-quilt-patch-id/${encodeURIComponent(patchId)}`
      : `${base.replace(/\/+$/, '')}/v1/blobs/${encodeURIComponent(blobId)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
      if (!res.ok) {
        errors.push(`${base} → HTTP ${res.status}`);
        continue;
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      return { bytes, servedBy: base, url };
    } catch (err) {
      errors.push(`${base} → ${err.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : err.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  const err = new Error(`no aggregator served blob ${blobId}: ${errors.join('; ')}`);
  err.attempts = errors;
  throw err;
}

/**
 * Check fetched bytes against what the on-chain record says they should be.
 * Two checks, reported separately rather than collapsed into one boolean,
 * because they promise different things:
 *
 *  - `content-sha256` binds the bytes to the **Arkiv record** — the digest the
 *    worker stored as an annotation at write time. Catches a swapped or
 *    truncated blob, using nothing but node's crypto.
 *
 *  - `blob-id` binds them to **Walrus's own content address**, which is not
 *    sha256(bytes) but a commitment over the erasure-coded sliver structure, so
 *    it needs the vendored WASM encoder (see blobid.mjs). This one relies on
 *    neither the aggregator that served the bytes nor the API that pointed at
 *    them.
 *
 * With no encoder the blob-ID check reports `asserted` — NOT `passed` — and
 * every surface must say so. A check we did not run is never claimed as one.
 *
 * @param {Object} args
 * @param {Buffer} args.bytes
 * @param {Object} args.evidence  {blobId, contentSha256, nShards}
 * @param {(bytes: Buffer) => Promise<string>|string} [args.computeBlobId]
 */
export async function verifyEvidenceBytes({ bytes, evidence, computeBlobId } = {}) {
  const recompute =
    computeBlobId ??
    (encoderAvailable() ? (b) => recomputeBlobId(b, { nShards: evidence?.nShards }) : null);
  const checks = [];

  const actualSha = sha256Hex(bytes);
  if (evidence?.contentSha256) {
    const passed = actualSha === evidence.contentSha256;
    checks.push({
      name: 'content-sha256',
      status: passed ? 'passed' : 'failed',
      detail: passed
        ? `bytes match the digest recorded on the Arkiv entity (${actualSha.slice(0, 12)}…)`
        : `served bytes hash to ${actualSha.slice(0, 12)}…, the record says ${String(evidence.contentSha256).slice(0, 12)}…`,
    });
  } else {
    checks.push({
      name: 'content-sha256',
      status: 'unavailable',
      detail: 'the record carries no content digest, so the bytes cannot be bound to it',
    });
  }

  // A quilted record cannot recompute to its own blob ID: the certified Sui
  // object commits to the whole quilt. The one structural check that IS
  // available: the patch id must be addressed within the quilt blob id named.
  if (isQuiltPatch(evidence)) {
    const quiltId = evidence.quiltBlobId ?? evidence.blobId;
    const inQuilt = Boolean(quiltId && String(evidence.patchId ?? '').startsWith(String(quiltId)));
    checks.push({
      name: 'patch-in-quilt',
      status: inQuilt ? 'passed' : 'failed',
      detail: inQuilt
        ? `patch is addressed inside certified quilt ${String(quiltId).slice(0, 12)}…`
        : `patch id ${String(evidence.patchId).slice(0, 16)}… is not addressed inside ${String(quiltId).slice(0, 12)}…`,
    });
    checks.push({
      name: 'blob-id',
      status: 'asserted',
      detail:
        'this record is a quilt patch, so it has no certified blob of its own — the Sui object ' +
        'certifies the whole quilt. Batching is what made seeding affordable; per-record certification ' +
        'is what it cost.',
    });
    const failedEarly = checks.filter((c) => c.status === 'failed');
    return {
      ok: failedEarly.length === 0,
      strong: checks.some((c) => c.status === 'passed') && failedEarly.length === 0,
      sha256: actualSha,
      quilted: true,
      checks,
    };
  }

  if (evidence?.blobId) {
    if (typeof recompute === 'function') {
      try {
        const recomputed = await recompute(bytes);
        const passed = recomputed === evidence.blobId;
        checks.push({
          name: 'blob-id',
          status: passed ? 'passed' : 'failed',
          detail: passed
            ? 'blob ID recomputed from the bytes and it matches the record'
            : `recomputed ${String(recomputed).slice(0, 12)}…, record says ${String(evidence.blobId).slice(0, 12)}…`,
        });
      } catch (err) {
        checks.push({ name: 'blob-id', status: 'unavailable', detail: `encoder failed: ${err.message}` });
      }
    } else {
      checks.push({
        name: 'blob-id',
        status: 'asserted',
        detail: 'requested by blob ID from a content-addressed store; not recomputed locally (no encoder)',
      });
    }
  }

  const failed = checks.filter((c) => c.status === 'failed');
  return {
    ok: failed.length === 0,
    // `strong`: at least one check actually ran and passed, not merely asserted.
    strong: checks.some((c) => c.status === 'passed') && failed.length === 0,
    sha256: actualSha,
    checks,
  };
}

/**
 * Fetch and check in one call, then parse the body. Never throws on a
 * verification failure — a failed check is information the caller must show,
 * not an exception that silently drops the evidence panel.
 */
export async function loadEvidence(evidence, opts = {}) {
  try {
    const { bytes, servedBy, url } = await fetchBlob(evidence.blobId, {
      ...opts,
      // Route to the patch when quilted, or we fetch the whole quilt and fail
      // our own content check on a good record.
      patchId: isQuiltPatch(evidence) ? evidence.patchId : opts.patchId,
    });
    const verification = await verifyEvidenceBytes({ bytes, evidence, computeBlobId: opts.computeBlobId });
    let body = null;
    try {
      body = JSON.parse(bytes.toString('utf8'));
    } catch {
      /* not JSON — a source tree archive, for instance. Leave it as bytes. */
    }
    return { ok: true, bytes, body, servedBy, url, verification };
  } catch (err) {
    return { ok: false, error: err.message, attempts: err.attempts ?? [] };
  }
}

/** One line for the terminal, honest about which checks actually ran. */
export function verificationLine(verification) {
  if (!verification) return 'evidence not fetched';
  const parts = verification.checks.map((c) => {
    const mark = { passed: '✓', failed: '✗', asserted: '~', unavailable: '?' }[c.status] ?? '?';
    return `${mark} ${c.name}`;
  });
  return parts.join('  ');
}
