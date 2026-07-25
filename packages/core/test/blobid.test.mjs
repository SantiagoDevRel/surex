import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBlobId, computeBlobMetadata, encoderAvailable, WALRUS_TESTNET_SHARDS } from '../src/blobid.mjs';
import { verifyEvidenceBytes, sha256Hex } from '../src/blob.mjs';

/**
 * A REAL blob, written and certified by probes/walrus-write.mjs on Walrus
 * testnet on 2026-07-25. Nothing here is synthetic — that is the point: the
 * check is only worth anything if it reproduces an identifier that a Sui
 * transaction already committed to.
 *
 *   blobId       -SzjTmxUSjs01bmC2AZ48iqz-fTCcllwcLu3nc2rb2Y
 *   suiObjectId  0xe0ad0c98f40f23b5990ea5bee344e6fbb245366507910f93120975b25c6af5e8
 *   register tx  2s1ogVLi6Gc2uEY3ZB4Ztb52DNxyHqftMa4aVrTRqeND
 *   certify tx   7BiSZkhzAjucM2PNY8bMVi9cWBvtiLDBE6T8AEtm1tkq
 */
const REAL_BYTES = Buffer.from(
  'SureX Walrus probe | ETHGlobal Lisbon 2026 | nonce=6f2a91c4d0e75b38 | ' +
    'one blob write = two Sui transactions (register + certify)\n',
  'utf8',
);
const REAL_BLOB_ID = '-SzjTmxUSjs01bmC2AZ48iqz-fTCcllwcLu3nc2rb2Y';
const REAL_SHA256 = 'f0457c3012a351b89df29a190d8189595074cf2fe843d85aeff8047cc1ff2ad7';

test('the vendored encoder is present — the gate ships it, it is not installed', () => {
  assert.equal(encoderAvailable(), true, 'lib/vendor/walrus-wasm must be committed');
});

test('recomputing a real blob ID from its bytes reproduces the on-chain value', () => {
  assert.equal(REAL_BYTES.length, 129);
  assert.equal(computeBlobId(REAL_BYTES), REAL_BLOB_ID);
});

test('a blob ID is NOT sha256 of the bytes — which is why the encoder is needed', () => {
  assert.equal(sha256Hex(REAL_BYTES), REAL_SHA256);
  assert.notEqual(Buffer.from(REAL_SHA256, 'hex').toString('base64url'), REAL_BLOB_ID);
});

test('flipping one bit changes the blob ID completely', () => {
  const tampered = Buffer.from(REAL_BYTES);
  tampered[0] ^= 1;
  const id = computeBlobId(tampered);
  assert.notEqual(id, REAL_BLOB_ID);
  assert.equal(id.length, REAL_BLOB_ID.length);
});

test('the shard count is part of the address, not a tuning knob', () => {
  assert.equal(WALRUS_TESTNET_SHARDS, 1000);
  // A different network configuration yields a different ID for identical bytes,
  // which is why encodingType and network are recorded on every record: a future
  // mismatch can then be explained rather than read as tampering.
  assert.notEqual(computeBlobId(REAL_BYTES, { nShards: 667 }), REAL_BLOB_ID);
});

test('metadata carries the encoding type the record must store', () => {
  const meta = computeBlobMetadata(REAL_BYTES);
  assert.equal(meta.blobId, REAL_BLOB_ID);
  assert.equal(meta.unencodedLength, 129);
  assert.equal(meta.encodingType, 'RS2');
  assert.match(meta.rootHash, /^[0-9a-f]{64}$/);
});

test('verification PASSES both checks on the real blob — not "asserted"', async () => {
  const result = await verifyEvidenceBytes({
    bytes: REAL_BYTES,
    evidence: { blobId: REAL_BLOB_ID, contentSha256: REAL_SHA256 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.strong, true);
  const byName = Object.fromEntries(result.checks.map((c) => [c.name, c]));
  assert.equal(byName['content-sha256'].status, 'passed');
  assert.equal(byName['blob-id'].status, 'passed', 'the encoder is vendored, so this must really run');
  assert.match(byName['blob-id'].detail, /recomputed/);
});

test('swapped bytes FAIL the blob-id check, even if a digest was never recorded', async () => {
  const swapped = Buffer.from('completely different evidence', 'utf8');
  const result = await verifyEvidenceBytes({
    bytes: swapped,
    evidence: { blobId: REAL_BLOB_ID }, // no contentSha256 at all
  });
  assert.equal(result.ok, false);
  const blobCheck = result.checks.find((c) => c.name === 'blob-id');
  assert.equal(blobCheck.status, 'failed');
});

test('truncated bytes FAIL, which is the aggregator-lied case', async () => {
  const result = await verifyEvidenceBytes({
    bytes: REAL_BYTES.subarray(0, 100),
    evidence: { blobId: REAL_BLOB_ID, contentSha256: REAL_SHA256 },
  });
  assert.equal(result.ok, false);
  assert.equal(result.checks.filter((c) => c.status === 'failed').length, 2, 'both checks must catch it');
});

test('with no encoder the check reports asserted, never passed', async () => {
  const result = await verifyEvidenceBytes({
    bytes: REAL_BYTES,
    evidence: { blobId: REAL_BLOB_ID, contentSha256: REAL_SHA256 },
    // An explicit thrower stands in for "encoder unavailable".
    computeBlobId: () => { throw new Error('no encoder here'); },
  });
  const blobCheck = result.checks.find((c) => c.name === 'blob-id');
  assert.equal(blobCheck.status, 'unavailable');
  assert.notEqual(blobCheck.status, 'passed');
  // content-sha256 still ran, so the result is still ok — but not by luck.
  assert.equal(result.ok, true);
});
