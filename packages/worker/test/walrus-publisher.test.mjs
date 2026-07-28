// The HTTP publisher write path, offline. Guards the two things this mode changes:
// who registered the blob, and whether the bytes that come back are the bytes we
// sent.
//
// The two response shapes below were captured from the live testnet publisher, not
// written from the docs — including the asymmetry that `alreadyCertified` carries no
// object id, size or encoding type, and that `newlyCreated` reports
// `certifiedEpoch: null` on a blob it just certified.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  publishersFrom,
  parsePublisherWrite,
  createWalrusWriter,
  DEFAULT_PUBLISHERS,
} from '../src/walrus.mjs';

const NEWLY_CREATED = {
  newlyCreated: {
    blobObject: {
      id: '0x69d36e36e92cddb36e8bc5c3c4787a4c0ab14f1239cb0bbca9b3e5f316f64ad7',
      registeredEpoch: 470,
      blobId: 'wzS6zur2rs0lFQzhtbqVXA8d-S7HluOmS0HEg5nTIt8',
      size: 36,
      encodingType: 'RS2',
      certifiedEpoch: null,
      storage: { id: '0x39ca', startEpoch: 470, endEpoch: 523, storageSize: 66034000 },
      deletable: false,
    },
    resourceOperation: { registerFromScratch: { encodedLength: 66034000, epochsAhead: 53 } },
    cost: 11312154,
  },
};

const ALREADY_CERTIFIED = {
  alreadyCertified: {
    blobId: 'wzS6zur2rs0lFQzhtbqVXA8d-S7HluOmS0HEg5nTIt8',
    event: { txDigest: 'HbxCjCYeGJQdxmV3JXMgAHbnwmpv78jkphPTt7hrLrpt', eventSeq: '0' },
    endEpoch: 523,
  },
};

test('an unset publisher variable leaves the SDK path in place', () => {
  assert.deepEqual(publishersFrom({}), []);
  assert.deepEqual(publishersFrom({ SUREX_WALRUS_PUBLISHER: '' }), []);
  assert.deepEqual(publishersFrom({ SUREX_WALRUS_PUBLISHER: '   ' }), []);
});

test('a truthy flag selects the two publishers that were measured working', () => {
  for (const raw of ['1', 'true', 'TRUE', 'yes', 'on', 'default']) {
    assert.deepEqual(publishersFrom({ SUREX_WALRUS_PUBLISHER: raw }), [...DEFAULT_PUBLISHERS]);
  }
  assert.equal(DEFAULT_PUBLISHERS.length, 2, 'one publisher is a single point of failure');
});

test('an explicit list is taken in order, trimmed, without trailing slashes', () => {
  assert.deepEqual(
    publishersFrom({ SUREX_WALRUS_PUBLISHER: ' https://a.example/ , https://b.example ,, ' }),
    ['https://a.example', 'https://b.example'],
  );
});

test('newlyCreated yields the object id and the encoding, and passes null certifiedEpoch through', () => {
  const parsed = parsePublisherWrite(NEWLY_CREATED);
  assert.equal(parsed.outcome, 'newlyCreated');
  assert.equal(parsed.blobId, 'wzS6zur2rs0lFQzhtbqVXA8d-S7HluOmS0HEg5nTIt8');
  assert.equal(parsed.suiObjectId, '0x69d36e36e92cddb36e8bc5c3c4787a4c0ab14f1239cb0bbca9b3e5f316f64ad7');
  assert.equal(parsed.encodingType, 'RS2');
  assert.equal(parsed.reportedSize, 36);
  assert.equal(parsed.deletable, false, 'permanent=true must come back non-deletable');
  // The publisher certifies and still answers null here.
  assert.equal(parsed.certifiedEpoch, null);
});

test('alreadyCertified is thinner, and the missing fields are null rather than guessed', () => {
  const parsed = parsePublisherWrite(ALREADY_CERTIFIED);
  assert.equal(parsed.outcome, 'alreadyCertified');
  assert.equal(parsed.blobId, 'wzS6zur2rs0lFQzhtbqVXA8d-S7HluOmS0HEg5nTIt8');
  assert.equal(parsed.certifyTx, 'HbxCjCYeGJQdxmV3JXMgAHbnwmpv78jkphPTt7hrLrpt');
  // The three the dedup path does not carry — null, never back-filled from the
  // newlyCreated shape or from our own bytes.
  assert.equal(parsed.suiObjectId, null);
  assert.equal(parsed.encodingType, null);
  assert.equal(parsed.reportedSize, null);
});

test('a 200 with an unrecognised body is not a write', () => {
  for (const body of [{}, { newlyCreated: {} }, { alreadyCertified: {} }, { ok: true }, null]) {
    assert.throws(() => parsePublisherWrite(body), /shape we do not recognise/);
  }
});

const sha = (b) => createHash('sha256').update(b).digest('hex');

/**
 * A writer with no wallet and no network. `keypair` is stubbed because publisher
 * mode must not need our key to write; `client` is stubbed only for `systemState`,
 * a chain read, because the shard count still goes on every record.
 */
async function writerWith({ fetchImpl, publishers = ['https://pub.example'], ...rest }) {
  return createWalrusWriter({
    keypair: { toSuiAddress: () => '0xstub' },
    client: {
      walrus: {
        systemState: async () => ({
          committee: { n_shards: 1000 },
          future_accounting: { length: 53 },
        }),
      },
    },
    expectAddress: false,
    publishers,
    fetchImpl,
    ...rest,
  });
}

/** epochs is supplied so the ceiling read is not part of what these assert. */
const WRITE = { epochs: 53, label: 'test record' };

/**
 * The captured `newlyCreated` shape with `size` set to the bytes a test sends. The
 * size guard fires before the readback, so a test about the readback must agree
 * with the publisher about length or it never reaches what it is testing.
 */
function newlyCreatedFor(bytes) {
  return {
    newlyCreated: {
      ...NEWLY_CREATED.newlyCreated,
      blobObject: { ...NEWLY_CREATED.newlyCreated.blobObject, size: bytes.length },
    },
  };
}

function fakePublisher({ body = NEWLY_CREATED, status = 200, served, calls = [] } = {}) {
  return async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET' });
    if (String(url).includes('/v1/blobs?')) {
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(body),
      };
    }
    // aggregator readback
    return {
      ok: served !== undefined,
      status: served === undefined ? 404 : 200,
      arrayBuffer: async () => served,
    };
  };
}

test('a published record states that a PUBLISHER registered it, and never claims our digests', async () => {
  const bytes = new TextEncoder().encode('the bytes under review\n');
  const calls = [];
  const w = await writerWith({
    fetchImpl: fakePublisher({ body: newlyCreatedFor(bytes), served: bytes, calls }),
  });
  const p = await w.writeRecord(bytes, { ...WRITE });

  assert.equal(p.registeredBy, 'publisher', 'custody must be stated, not inferred');
  assert.equal(p.publisher, 'https://pub.example');
  assert.equal(p.publisherOutcome, 'newlyCreated');
  // Not ours to claim — the register digest does not exist on this path at all.
  assert.equal(p.registerTx, undefined);
  assert.equal(p.certifyTx, undefined);
  // Ours, and the one thing the publisher cannot influence.
  assert.equal(p.contentSha256, sha(bytes));
  assert.equal(p.size, bytes.length);
  assert.equal(p.addressing, 'blob');
  assert.equal(p.digestFrom, 'written');
  assert.equal(p.readbackVerified, true);

  const put = calls.find((c) => c.method === 'PUT');
  assert.match(put.url, /epochs=53/);
  assert.match(put.url, /permanent=true/, 'evidence must not be quietly removable');
});

test('the SDK path is unchanged when no publisher is configured', async () => {
  const w = await writerWith({ fetchImpl: fakePublisher(), publishers: [] });
  assert.deepEqual(w.publishers, []);
});

test('a publisher write never touches our Sui key', async () => {
  // Somebody else's wallet pays, so needing our key for a keyless write is a
  // deployment bug: it fails on a missing secrets file having never touched the
  // network. A keypair that throws on use is how that stays fixed — anything that
  // reads the address, even to log it, fails this test.
  const bytes = new TextEncoder().encode('no key required\n');
  const w = await createWalrusWriter({
    keypair: {
      toSuiAddress() {
        throw new Error('the key was loaded for a write that does not spend');
      },
    },
    client: { walrus: { systemState: async () => ({ committee: { n_shards: 1000 }, future_accounting: { length: 53 } }) } },
    publishers: ['https://pub.example'],
    fetchImpl: fakePublisher({ body: newlyCreatedFor(bytes), served: bytes }),
  });

  const p = await w.writeRecord(bytes, { ...WRITE });
  assert.equal(p.registeredBy, 'publisher');
  // And the getter still resolves on demand, for the paths that do spend.
  assert.throws(() => w.address, /key was loaded/);
});

test('bytes that come back different from what we published are refused', async () => {
  const bytes = new TextEncoder().encode('what we sent\n');
  const tampered = new TextEncoder().encode('what it served\n');
  const w = await writerWith({ fetchImpl: fakePublisher({ body: newlyCreatedFor(bytes), served: tampered }) });
  await assert.rejects(
    () => w.writeRecord(bytes, { ...WRITE }),
    /refusing the pointer/,
    'a publisher in the middle of the write is exactly why this check exists',
  );
});

test('the readback failing to load at all is a failure, not a silent pass', async () => {
  const bytes = new TextEncoder().encode('x\n');
  const w = await writerWith({ fetchImpl: fakePublisher({ body: newlyCreatedFor(bytes), served: undefined }) });
  await assert.rejects(() => w.writeRecord(bytes, { ...WRITE }), /aggregator answered 404/);
});

test('a size the publisher disagrees with is refused before anything is recorded', async () => {
  const bytes = new TextEncoder().encode('twelve bytes');
  const w = await writerWith({
    // NEWLY_CREATED says 36 B; we are sending 12.
    fetchImpl: fakePublisher({ body: NEWLY_CREATED, served: bytes }),
  });
  await assert.rejects(() => w.writeRecord(bytes, { ...WRITE }), /we sent 12 B/);
});

test('the second publisher is tried when the first refuses, and both failures are reported', async () => {
  const bytes = new TextEncoder().encode('failover\n');
  const seen = [];
  const fetchImpl = async (url, init) => {
    if (String(url).includes('/v1/blobs?')) {
      seen.push(String(url));
      if (String(url).startsWith('https://down.example')) {
        // An out-of-range epochs comes back as a 500 wrapping a Move abort, so the
        // body is what tells you what happened (S2).
        return { ok: false, status: 500, text: async () => 'EInvalidEpochsAhead' };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(ALREADY_CERTIFIED) };
    }
    return { ok: true, status: 200, arrayBuffer: async () => bytes };
  };

  const w = await writerWith({
    fetchImpl,
    publishers: ['https://down.example', 'https://up.example'],
  });
  const p = await w.writeRecord(bytes, { ...WRITE });

  assert.equal(seen.length, 2, 'the second publisher must actually be tried');
  assert.equal(p.publisher, 'https://up.example');
  assert.equal(p.publisherOutcome, 'alreadyCertified');
  // Thinner provenance survives as absent; the certification event digest — real,
  // just not ours — is kept.
  assert.equal(p.suiObjectId, undefined);
  assert.equal(p.certifyTx, 'HbxCjCYeGJQdxmV3JXMgAHbnwmpv78jkphPTt7hrLrpt');
  assert.equal(p.encodingType, null);
  assert.equal(p.registeredBy, 'publisher');
});

test('every publisher failing names each one, so the reason is in the error', async () => {
  const w = await writerWith({
    fetchImpl: async (url) =>
      String(url).includes('/v1/blobs?')
        ? { ok: false, status: 503, text: async () => 'upstream busy' }
        : { ok: true, status: 200, arrayBuffer: async () => new Uint8Array() },
    publishers: ['https://a.example', 'https://b.example'],
  });
  await assert.rejects(
    () => w.writeRecord(new TextEncoder().encode('x'), { ...WRITE }),
    (err) => {
      assert.match(err.message, /no publisher accepted/);
      assert.match(err.message, /a\.example/);
      assert.match(err.message, /b\.example/);
      assert.match(err.message, /503/);
      return true;
    },
  );
});

test('a publisher that never answers is abandoned, and the timer does not outlive the call', async () => {
  // If the timeout is not cleared in a `finally`, the un-cleared AbortController
  // timer keeps the node:test worker alive past its own completion (V3).
  const w = await writerWith({
    publishTimeoutMs: 40,
    fetchImpl: (url, init) =>
      new Promise((_, reject) => {
        if (!String(url).includes('/v1/blobs?')) return reject(new Error('unexpected'));
        init.signal.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      }),
  });
  await assert.rejects(
    () => w.writeRecord(new TextEncoder().encode('x'), { ...WRITE }),
    /no answer in 40 ms/,
  );
});

test('the readback can be turned off, but then the pointer says so', async () => {
  const bytes = new TextEncoder().encode('unverified\n');
  let readbacks = 0;
  const w = await writerWith({
    verifyPublished: false,
    fetchImpl: async (url) => {
      if (String(url).includes('/v1/blobs?')) {
        return { ok: true, status: 200, text: async () => JSON.stringify(NEWLY_CREATED) };
      }
      readbacks += 1;
      return { ok: true, status: 200, arrayBuffer: async () => bytes };
    },
  });
  // Size check still applies; use bytes the fixture agrees with.
  const p = await w.writeRecord(new Uint8Array(36), { ...WRITE });
  assert.equal(readbacks, 0, 'opting out must actually skip the fetch');
  assert.equal(p.readbackVerified, false);
  assert.equal(p.registeredBy, 'publisher');
});
