// The entity builders, offline.
//
// These guard the three things the SDK will not: the project attribute cannot be
// dropped, numeric attributes must be integers, and a seeded head can never be
// `clean`. Each of those has a measured failure behind it.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  setSelfAuthored,
  buildRegistryEntry,
  buildVerdictHead,
  buildSourceRecord,
  buildReviewRecord,
  buildDispute,
  buildUpdate,
  evidenceOf,
} from '../src/entities.mjs';
import { evenSeconds } from '../src/config.mjs';

const POINTER = {
  blobId: 'FakeBlobIdForATestOnly_0000000000000000000',
  suiObjectId: '0xtest',
  registerTx: 'reg',
  certifyTx: 'cert',
  encodingType: 'RS2',
  nShards: 1000,
  contentSha256: 'a'.repeat(64),
  size: 128,
  addressing: 'blob',
};

const attrsOf = (built) => Object.fromEntries(built.attributes.map((a) => [a.key, a.value]));

test('every entity carries project and entityType', () => {
  const built = [
    buildRegistryEntry({ fingerprint: 'sxf1_x', name: 'n', tier: 'C', blob: POINTER }),
    buildVerdictHead({ fingerprint: 'sxf1_x', state: 'unknown', tier: 'C' }),
    buildSourceRecord({ fingerprint: 'sxf1_x', versionString: '1.0.0', licence: 'MIT', blob: POINTER }),
    buildReviewRecord({ fingerprint: 'sxf1_x', sourceKey: '0xs', verdict: 'clean', blob: POINTER }),
    buildDispute({ fingerprint: 'sxf1_x', reviewKey: '0xr', contestantType: 'human', blob: POINTER }),
  ];
  for (const b of built) {
    const a = attrsOf(b);
    assert.equal(a.project, 'surex-lisbon');
    assert.ok(a.entityType);
    assert.equal(b.expiresIn % 2, 0, 'expiresIn must be even — 0.7.0 throws on odd');
  }
});

test('an evidence pointer without contentSha256 or nShards is refused', () => {
  assert.throws(() => evidenceOf({ blobId: 'x', nShards: 1000 }), /contentSha256/);
  assert.throws(() => evidenceOf({ blobId: 'x', contentSha256: 'a' }), /nShards/);
  assert.throws(() => evidenceOf({ contentSha256: 'a', nShards: 1 }), /blobId/);
});

/**
 * Custody has to reach the RECORD, not just the pointer. `evidenceOf` is a
 * whitelist, so a pointer field it does not name is silently dropped — which is how
 * a `registeredBy: 'publisher'` pointer once produced an on-chain payload that could
 * not say whose wallet registered its evidence.
 */
test('a publisher-written pointer carries its custody into the payload', () => {
  const e = evidenceOf({
    ...POINTER,
    suiObjectId: '0xtheirs',
    registerTx: undefined,
    certifyTx: undefined,
    registeredBy: 'publisher',
    publisher: 'https://publisher.walrus-testnet.walrus.space',
    publisherOutcome: 'newlyCreated',
    readbackVerified: true,
  });
  assert.equal(e.registeredBy, 'publisher');
  assert.equal(e.publisher, 'https://publisher.walrus-testnet.walrus.space');
  assert.equal(e.publisherOutcome, 'newlyCreated');
  assert.equal(e.readbackVerified, true);
  assert.equal(e.registerTx, undefined, 'we signed nothing on this path');
});

test('a wallet-written pointer says so too, so custody is never inferred', () => {
  const e = evidenceOf({ ...POINTER, registeredBy: 'wallet' });
  assert.equal(e.registeredBy, 'wallet');
  assert.equal(e.publisher, undefined);
  assert.equal(e.registerTx, 'reg', 'the digests on this path are ours');
});

test('readbackVerified:false survives — a skipped check is not the same as no check', () => {
  const e = evidenceOf({ ...POINTER, registeredBy: 'publisher', readbackVerified: false });
  assert.equal(e.readbackVerified, false);
  assert.ok('readbackVerified' in e, 'false must not be erased into absence by a truthiness guard');
});

test('a pointer written before custody was recorded stays silent rather than claiming ours', () => {
  const e = evidenceOf(POINTER);
  assert.equal(e.registeredBy, undefined);
  assert.ok(!('readbackVerified' in e));
});

test('a quilt patch pointer keeps its addressing, patch id and quilt blob visible', () => {
  const e = evidenceOf({
    ...POINTER,
    addressing: 'quilt-patch',
    patchId: 'patch-1',
    quiltBlobId: POINTER.blobId,
  });
  assert.equal(e.addressing, 'quilt-patch');
  assert.equal(e.patchId, 'patch-1');
  assert.equal(e.quiltBlobId, POINTER.blobId);
});

test('a seeded head can never be clean', () => {
  assert.throws(
    () => buildVerdictHead({ fingerprint: 'sxf1_x', state: 'clean', tier: 'C' }),
    /latestReviewKey/,
  );
  // With a real review key it is allowed — that is the only route to clean.
  const ok = buildVerdictHead({ fingerprint: 'sxf1_x', state: 'clean', tier: 'B', latestReviewKey: '0xr' });
  assert.equal(attrsOf(ok).state, 'clean');
});

test('unreviewable needs a reason', () => {
  assert.throws(() => buildVerdictHead({ fingerprint: 'sxf1_x', state: 'unreviewable', tier: 'C' }), /reason/);
  const ok = buildVerdictHead({
    fingerprint: 'sxf1_x',
    state: 'unreviewable',
    reason: 'licence',
    tier: 'C',
  });
  assert.equal(attrsOf(ok).reason, 'licence');
});

test('needsReanalysis is a string, and severity/enforceAfter stay integers', () => {
  // About attribute ENCODING, but a `flagged` head has to clear the two
  // write-boundary gates first — allowlist and provenance. Those rules are tested
  // in accusation-gate.test.mjs; satisfying them here does not weaken this test.
  setSelfAuthored(['sxf1_x']);
  const head = buildVerdictHead({
    fingerprint: 'sxf1_x',
    state: 'flagged',
    tier: 'B',
    severity: 4,
    needsReanalysis: true,
    enforceAfter: 1784950249894,
    modelId: 'qwen3-coder-next:surex32k',
    promptVersion: 'rv-4',
    reviewedCommit: 'a'.repeat(40),
  });
  const a = attrsOf(head);
  assert.equal(a.needsReanalysis, 'true');
  assert.equal(a.severity, 4);
  assert.equal(a.enforceAfter, 1784950249894);
  assert.equal(Number.isInteger(a.enforceAfter), true);
});

test('a non-integer numeric attribute is refused before the SDK sees it', () => {
  assert.throws(
    () => buildVerdictHead({ fingerprint: 'sxf1_x', state: 'unknown', tier: 'C', severity: 1.5 }),
    /integer/,
  );
});

test('an update that lost the project attribute is refused', () => {
  assert.throws(
    () =>
      buildUpdate({
        entityKey: '0xk',
        attributes: [{ key: 'entityType', value: 'verdictHead' }],
        payload: {},
        expiresIn: 100,
      }),
    /project/,
  );
});

test('an unknown state or verdict is refused', () => {
  assert.throws(() => buildVerdictHead({ fingerprint: 'sxf1_x', state: 'ok', tier: 'C' }), /state/);
  assert.throws(
    () => buildReviewRecord({ fingerprint: 'sxf1_x', sourceKey: '0xs', verdict: 'fine', blob: POINTER }),
    /verdict/,
  );
  assert.throws(
    () => buildDispute({ fingerprint: 'sxf1_x', reviewKey: '0xr', contestantType: 'bot', blob: POINTER }),
    /contestantType/,
  );
});

test('evenSeconds rounds up, never to zero', () => {
  assert.equal(evenSeconds(3601), 3602);
  assert.equal(evenSeconds(3600), 3600);
  assert.equal(evenSeconds(1), 2);
  assert.equal(evenSeconds(0), 2);
});
