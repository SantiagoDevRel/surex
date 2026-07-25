// Recomputing a Walrus blob ID from bytes.
//
// This is what makes the chain-of-custody claim a property rather than a
// sentence. A blob ID is NOT sha256 of the payload — it is a commitment over the
// erasure-coded sliver structure, so it cannot be derived with a stdlib hash.
// Measured, on the blob our own probe wrote:
//
//   blob ID          -SzjTmxUSjs01bmC2AZ48iqz-fTCcllwcLu3nc2rb2Y
//   sha256/base64url 8EV8MBKjUbid8poZDYGJWVB0zy_oQ9ha7_gEfMH_Ktc
//
// Deriving it needs the Walrus encoder, which is WASM. The plugin is installed
// straight from a git repo with no npm install, so the encoder is VENDORED —
// 359 KB of wasm plus 17 KB of glue, committed. That keeps "no dependencies to
// install" true while letting the gate check the bytes itself, trusting neither
// the aggregator that served them nor the API that pointed at them.
//
// Verified: recomputing the probe's 129 bytes reproduces the on-chain ID
// exactly, and flipping a single bit produces a completely different one.

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Shard count of the Walrus network the blob was written to. Blob IDs are
 * deterministic over content AND network configuration, so this is part of the
 * address, not a tuning knob. 1000 is Walrus testnet, confirmed by reproducing
 * a real ID; a record written to a different configuration must carry its own.
 */
export const WALRUS_TESTNET_SHARDS = 1000;

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Where the vendored encoder might be. The gate finds it next to itself; the
 * server side resolves the npm package instead of carrying a second copy.
 */
function candidatePaths() {
  return [
    join(HERE, '..', '..', 'plugin', 'lib', 'vendor', 'walrus-wasm', 'walrus_wasm.js'),
    join(HERE, '..', 'vendor', 'walrus-wasm', 'walrus_wasm.js'),
    join(HERE, 'vendor', 'walrus-wasm', 'walrus_wasm.js'),
  ];
}

let cached; // undefined = not tried, null = unavailable

/**
 * Load the encoder, or return null. Never throws: a gate that cannot load the
 * encoder must still block on a flag and simply report the blob-ID check as
 * not-run, rather than crash or — worse — claim a check it did not perform.
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
    // compute_metadata returns the tuple (blob_id, root_hash,
    // unencoded_length, encoding_type) as an array-like, deliberately avoiding
    // serialising ~2k sliver hashes across the JS/WASM boundary.
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
    // The tuple is (blob_id, root_hash, unencoded_length, encoding_type).
    // blob_id arrives as a plain number array; root_hash arrives WRAPPED as
    // `{Digest: [...]}` — the Rust enum leaking through wasm-bindgen. Unwrap it
    // rather than assume, so a shape change is a visible null and not a
    // plausible-looking wrong hash.
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
