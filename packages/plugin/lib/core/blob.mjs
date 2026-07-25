// AUTO-GENERATED — do not edit.
// Vendored from packages/core/src by scripts/sync-core.mjs, because the plugin
// runs on a user's machine with nothing installed. Edit the original and re-run
// `pnpm sync:core`.
// Fetching the evidence, and checking it is the evidence that was judged.
//
// This is the load-bearing half of the chain-of-custody claim. Arkiv decides on
// the hot path — one annotation read, no blob fetch — but when SureX actually
// blocks a call, it goes and gets the reviewed bytes from Walrus and checks
// them. If nobody ever reads the blob, "the verdict points at the exact bytes it
// judged" is a sentence in a README rather than a property of the system.
//
// Node stdlib only — vendored into the plugin.

import { createHash } from 'node:crypto';

/**
 * Public testnet aggregators. Read in order; the first that answers wins.
 * Not hardcoded package or object IDs — those must be read at runtime (§5) —
 * these are just HTTP read endpoints and are safe to list.
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
 * Fetch a blob by ID, trying each aggregator until one answers.
 * Returns the raw bytes plus which aggregator served them — the second half
 * matters, because "which node told you this" is part of the provenance.
 */
export async function fetchBlob(blobId, opts = {}) {
  const aggregators = opts.aggregators ?? DEFAULT_AGGREGATORS;
  const timeoutMs = opts.timeoutMs ?? 4000;
  const errors = [];

  for (const base of aggregators) {
    const url = `${base.replace(/\/+$/, '')}/v1/blobs/${encodeURIComponent(blobId)}`;
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
 *
 * Two independent checks, deliberately reported separately rather than collapsed
 * into one boolean, because they promise different things:
 *
 *  - `content-sha256` binds the bytes to the **Arkiv record**. The worker hashed
 *    the body at write time and stored the digest as an annotation, so a
 *    mismatch means the bytes an aggregator just served are not the bytes the
 *    verdict was written against. This is the check that makes a swapped or
 *    truncated blob detectable, and it runs with nothing but node's crypto.
 *
 *  - `blob-id` binds the bytes to **Walrus's own content address**. A Walrus
 *    blob ID is not sha256(bytes): it is a hash over a Merkle tree of erasure-
 *    coded sliver commitments, so recomputing it requires the Walrus encoder.
 *    The plugin ships with zero dependencies and therefore cannot recompute it
 *    unless an encoder is injected. When it cannot, this check reports
 *    `asserted` — NOT `passed` — and the UI must say so. Claiming a check we did
 *    not run is exactly the kind of thing this product exists to object to.
 *
 * @param {Object} args
 * @param {Buffer} args.bytes
 * @param {Object} args.evidence  {blobId, contentSha256}
 * @param {(bytes: Buffer) => Promise<string>|string} [args.computeBlobId]
 */
export async function verifyEvidenceBytes({ bytes, evidence, computeBlobId } = {}) {
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

  if (evidence?.blobId) {
    if (typeof computeBlobId === 'function') {
      try {
        const recomputed = await computeBlobId(bytes);
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
    // `strong` means at least one check actually ran and passed, rather than
    // everything being merely asserted.
    strong: checks.some((c) => c.status === 'passed') && failed.length === 0,
    sha256: actualSha,
    checks,
  };
}

/**
 * Fetch and check in one call, then parse the body.
 * Never throws on a verification failure — a failed check is *information the
 * user must see*, not an exception that silently drops the evidence panel.
 */
export async function loadEvidence(evidence, opts = {}) {
  try {
    const { bytes, servedBy, url } = await fetchBlob(evidence.blobId, opts);
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
