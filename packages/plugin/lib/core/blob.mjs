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
import { computeBlobId as recomputeBlobId, encoderAvailable } from './blobid.mjs';

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
 * Is this evidence pointer a patch inside a Quilt rather than a blob of its own?
 *
 * Quilt batches many small records into one storage unit, which is what made
 * seeding affordable at all — 50 standalone blobs would have cost 100 Sui
 * transactions and more WAL than the wallet held. The trade-off, which the spec
 * called and which shows up here, is that a quilted record is addressed as
 * (quilt blob, patch id) and does NOT get its own certified Sui object.
 */
export function isQuiltPatch(evidence) {
  return Boolean(evidence?.patchId || evidence?.addressing === 'quilt-patch');
}

/**
 * Fetch a blob by ID, trying each aggregator until one answers.
 * Returns the raw bytes plus which aggregator served them — the second half
 * matters, because "which node told you this" is part of the provenance.
 *
 * A quilt patch is a different route: `/v1/blobs/by-quilt-patch-id/<patchId>`.
 * Asking for a patch id on the plain blob route is a 400, and asking for the
 * QUILT when the record is a patch returns ~9x the bytes — whose digest then
 * fails the content check and reports "evidence did not match the record" about
 * a record that is perfectly fine. A false alarm here costs as much as a miss.
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
 *    blob ID is not sha256(bytes): it is a commitment over the erasure-coded
 *    sliver structure, so recomputing it requires the Walrus encoder. The
 *    encoder is WASM and is vendored (see blobid.mjs), so this check really runs
 *    and really passes — it is the one that needs to trust neither the
 *    aggregator that served the bytes nor the API that pointed at them.
 *
 *    If the encoder cannot be loaded, this reports `asserted` — NOT `passed` —
 *    and every surface must say so. Claiming a check we did not run is exactly
 *    the kind of thing this product exists to object to.
 *
 * @param {Object} args
 * @param {Buffer} args.bytes
 * @param {Object} args.evidence  {blobId, contentSha256, nShards}
 * @param {(bytes: Buffer) => Promise<string>|string} [args.computeBlobId]
 */
export async function verifyEvidenceBytes({ bytes, evidence, computeBlobId } = {}) {
  // Default to the vendored encoder. An explicit function still wins, so a
  // caller can supply a different network configuration or a test double.
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

  // A quilted record cannot recompute to its own blob ID — the certified Sui
  // object commits to the whole quilt, and the patch is addressed within it. Say
  // exactly that, and run the one structural check that IS available: the patch
  // id must be addressed within the quilt blob id the record names.
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
    const { bytes, servedBy, url } = await fetchBlob(evidence.blobId, {
      ...opts,
      // Route to the patch when the record is quilted, or we fetch the whole
      // quilt and fail our own content check on a good record.
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
