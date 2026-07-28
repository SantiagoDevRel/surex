/**
 * Probe: write a blob through the product's publisher mode, from wherever you run it.
 *
 *   SUREX_WALRUS_PUBLISHER=1 node probes/walrus-publish.mjs
 *
 * The counterpart to `probes/walrus-write.mjs`, which exercises the SDK path. That
 * path uploads slivers directly to all 101 committee members and cannot complete
 * from a residential uplink (FRICTION-LOG S11); publisher mode is how the always-on
 * writer gets to write at all.
 *
 * Imports `createWalrusWriter` from the worker package rather than reimplementing
 * the write — the question is whether the shipped code works from this machine.
 *
 * What it proves, in order:
 *   1. the publisher accepts the bytes from this uplink, and which publisher did
 *   2. the pointer states the publisher's custody rather than implying ours
 *   3. the bytes come back from the aggregator and recompute to the same digest —
 *      the property the gate relies on, unaffected by whose wallet paid
 *   4. a second identical write dedupes (publisher behaviour the SDK lacks, S3)
 *
 * Nothing here is product data: the payload is a probe string and no Arkiv head
 * points at it.
 */

import { createWalrusWriter, publishersFrom } from '../packages/worker/src/walrus.mjs';

const log = (...a) => console.log(...a);

const publishers = publishersFrom();
if (!publishers.length) {
  console.error(
    'SUREX_WALRUS_PUBLISHER is not set, so this would take the SDK path and prove nothing.\n' +
      '  SUREX_WALRUS_PUBLISHER=1 node probes/walrus-publish.mjs',
  );
  process.exit(2);
}

// Unique per run: a fixed payload would dedupe on the first write and the probe
// would never exercise the fresh-write branch. Step 4 re-sends these same bytes.
const nonce = process.argv[2] ?? `${Date.now().toString(36)}-${process.pid.toString(36)}`;
const PAYLOAD = new TextEncoder().encode(
  `SureX publisher probe | ETHGlobal Lisbon 2026 | nonce=${nonce} | the publisher's wallet registers this, not ours\n`,
);

log('# 0. mode');
log('  publishers :', publishers.join(', '));
log('  payload    :', PAYLOAD.length, 'B');

const walrus = await createWalrusWriter({ log: (m) => log(m) });
// Deliberately not logging walrus.address: reading it loads the Sui key, and the
// property demonstrated here is that publisher mode needs no key at all.
log('  our Sui key:', 'not loaded — the publisher\'s wallet pays for this write');

log('\n# 1. write');
const started = Date.now();
const pointer = await walrus.writeRecord(PAYLOAD, { label: 'publisher probe' });
log(`  wrote in ${Date.now() - started} ms`);

log('\n# 2. custody, as recorded');
log('  registeredBy     :', pointer.registeredBy);
log('  publisher        :', pointer.publisher);
log('  publisherOutcome :', pointer.publisherOutcome);
log('  suiObjectId      :', pointer.suiObjectId ?? '(none — the publisher did not report one)');
log('  registerTx       :', pointer.registerTx ?? '(none — not produced on this path)');
log('  certifyTx        :', pointer.certifyTx ?? '(none on a fresh write)');
if (pointer.registeredBy !== 'publisher') {
  throw new Error(`pointer says registeredBy=${pointer.registeredBy}; publisher mode must say 'publisher'`);
}

log('\n# 3. the property the gate relies on');
log('  blobId        :', pointer.blobId);
log('  contentSha256 :', pointer.contentSha256);
log('  readback verified at write time:', pointer.readbackVerified);
// Asked again independently of the writer's own check.
const served = await walrus.fetchPublished(pointer.blobId);
const servedSha = walrus.sha256Hex(served);
const roundTrips = servedSha === pointer.contentSha256 && served.length === PAYLOAD.length;
log('  aggregator serves:', served.length, 'B · sha256', servedSha);
log('  round-trips      :', roundTrips ? 'YES' : 'NO');
if (!roundTrips) throw new Error('the aggregator served different bytes than we published');

log('\n# 4. the same bytes again (publisher dedup — S3)');
const again = await walrus.writeRecord(PAYLOAD, { label: 'publisher probe (repeat)' });
log('  outcome     :', again.publisherOutcome);
log('  same blobId :', again.blobId === pointer.blobId ? 'YES' : 'NO');
log('  certifyTx   :', again.certifyTx ?? '(none)');
log('  suiObjectId :', again.suiObjectId ?? '(none — alreadyCertified carries no object id)');

log('\n================ CAPTURED ================');
log('blobId        :', pointer.blobId);
log('registeredBy  :', pointer.registeredBy, '·', pointer.publisher);
log('contentSha256 :', pointer.contentSha256);
log('nShards       :', pointer.nShards, '| epochs:', pointer.epochs, '| encoding:', pointer.encodingType);
log('aggregator    : https://aggregator.walrus-testnet.walrus.space/v1/blobs/' + pointer.blobId);
if (pointer.suiObjectId) log('explorer      : https://suiscan.xyz/testnet/object/' + pointer.suiObjectId);
log('round-trips   :', roundTrips);
log('==========================================');
