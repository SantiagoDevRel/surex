// Recomputing a Walrus blob ID from bytes.
//
// A blob ID is NOT sha256 of the payload — it is a commitment over the
// erasure-coded sliver structure, so it cannot be derived with a stdlib hash.
// Deriving it needs the Walrus encoder, which is WASM; the plugin installs
// straight from a git repo with no npm install, so the encoder is VENDORED.

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Shard count of the Walrus network the blob was written to. Blob IDs are
 * deterministic over content AND network configuration, so this is part of the
 * address, not a tuning knob — a record written to a different configuration
 * must carry its own. 1000 is Walrus testnet.
 */
export const WALRUS_TESTNET_SHARDS = 1000;

const HERE = dirname(fileURLToPath(import.meta.url));

/** Where the vendored encoder might be — the gate finds it next to itself. */
function candidatePaths() {
  return [
    join(HERE, '..', '..', 'plugin', 'lib', 'vendor', 'walrus-wasm', 'walrus_wasm.js'),
    join(HERE, '..', 'vendor', 'walrus-wasm', 'walrus_wasm.js'),
    join(HERE, 'vendor', 'walrus-wasm', 'walrus_wasm.js'),
  ];
}

let cached; // undefined = not tried, null = unavailable

/**
 * Load the encoder, or return null. Never throws — a gate that cannot load it
 * must still block on a flag and report the blob-ID check as not-run, rather
 * than crash or claim a check it did not perform.
 */
export function loadEncoder(opts = {}) {
  if (cached !== undefined && !opts.reload) return cached;
  const require_ = createRequire(import.meta.url);
  const paths = [...(opts.paths ?? []), ...candidatePaths()];

  for (const path of paths) {
    if (!existsSync(path)) continue;
    try {
      const mod = require_(path);
      if (mod?.BlobEncoder) {
        cached = { BlobEncoder: mod.BlobEncoder, from: path };
        return cached;
      }
    } catch {
      // Try the next candidate.
    }
  }
  // Fall back to the published package, for anything that does npm install.
  try {
    const mod = require_('@mysten/walrus-wasm');
    if (mod?.BlobEncoder) {
      cached = { BlobEncoder: mod.BlobEncoder, from: '@mysten/walrus-wasm' };
      return cached;
    }
  } catch {
    /* not installed */
  }
  cached = null;
  return cached;
}

export function encoderAvailable() {
  return loadEncoder() !== null;
}

/**
 * Blob ID for these bytes, base64url, as it appears on chain.
 * @param {Uint8Array|Buffer} bytes
 * @param {{nShards?: number}} [opts]
 * @returns {string|null} null when no encoder is available
 */
export function computeBlobId(bytes, opts = {}) {
  const encoder = loadEncoder(opts);
  if (!encoder) return null;
  const nShards = opts.nShards ?? WALRUS_TESTNET_SHARDS;
  const instance = new encoder.BlobEncoder(nShards);
  try {
    // compute_metadata returns the tuple (blob_id, root_hash, unencoded_length,
    // encoding_type) as an array-like.
    const meta = instance.compute_metadata(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    return Buffer.from(meta[0]).toString('base64url');
  } finally {
    instance.free?.();
  }
}

/** Everything the encoder can tell us about these bytes. */
export function computeBlobMetadata(bytes, opts = {}) {
  const encoder = loadEncoder(opts);
  if (!encoder) return null;
  const instance = new encoder.BlobEncoder(opts.nShards ?? WALRUS_TESTNET_SHARDS);
  try {
    const meta = instance.compute_metadata(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    // Tuple: (blob_id, root_hash, unencoded_length, encoding_type). root_hash
    // arrives WRAPPED as `{Digest: [...]}` — the Rust enum leaking through
    // wasm-bindgen. Unwrap rather than assume, so a shape change surfaces as a
    // null and not a plausible-looking wrong hash.
    const rootBytes = Array.isArray(meta[1]) || ArrayBuffer.isView(meta[1])
      ? meta[1]
      : meta[1]?.Digest ?? null;
    return {
      blobId: Buffer.from(meta[0]).toString('base64url'),
      rootHash: rootBytes ? Buffer.from(rootBytes).toString('hex') : null,
      unencodedLength: Number(meta[2]),
      encodingType: meta[3],
      nShards: opts.nShards ?? WALRUS_TESTNET_SHARDS,
    };
  } finally {
    instance.free?.();
  }
}
