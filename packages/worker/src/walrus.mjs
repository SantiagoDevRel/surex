// The Walrus writer. Record bodies in, evidence pointers out.
//
// Everything here follows probes/walrus-write.mjs, which is a proven write on
// testnet. The patterns that are NOT negotiable, each because it was measured:
//
//  · Step the flow by hand — encode → register → upload → certify. The
//    convenience wrapper `executeCertify()` DISCARDS the certify digest, and a
//    record whose provenance is half-recorded is not provenance (FRICTION-LOG S4).
//  · Read the epoch ceiling off chain. Testnet max is 53, not the 183 in every
//    doc; `epochs=183` comes back as HTTP 500 wrapping a raw EInvalidEpochsAhead
//    Move abort (S2).
//  · Read package / object / exchange IDs at runtime. Testnet has been redeployed
//    before, so a hardcoded ID is a time bomb (§5).
//  · Blobs are owned + permanent (`deletable: false`). The registry's evidence
//    must not be quietly removable — including by us.
//  · `contentSha256` on EVERY record. A Walrus blob ID is not sha256(bytes) (it is
//    a commitment over the erasure-coded sliver structure), so the digest that
//    binds served bytes to the Arkiv record is a separate field we compute here.
//    packages/core/src/blob.mjs verifyEvidenceBytes() is the consumer.
//  · `nShards` on every record too. Blob IDs are deterministic over content AND
//    network configuration; without the shard count a future mismatch is
//    unexplainable rather than merely explained.
//
// Cost, measured: one standalone blob = TWO Sui transactions, and cost is per
// blob rather than per byte. `alreadyCertified` dedup is PUBLISHER behaviour, not
// protocol — this SDK re-registers, re-certifies and RE-CHARGES for bytes already
// certified (S3), so a re-run is not free and the seed checkpoints instead.
//
// ── PUBLISHER MODE (SUREX_WALRUS_PUBLISHER) ─────────────────────────────────
// The SDK write path is not portable across uplinks. It uploads slivers directly
// to all 101 committee members in parallel, and a residential connection does not
// complete that: the same code, same wallet, minutes apart, succeeds in 32 s from
// a European business line and fails 4/4 with NotEnoughBlobConfirmationsError from
// the DGX (FRICTION-LOG S11 — balance, Node version, IPv6 and file descriptors
// were each ruled out with their own test; do not re-derive it). The HTTP
// publisher works from the same machine at the same moment.
//
// So: when SUREX_WALRUS_PUBLISHER is set the record goes over HTTP, and when it
// is not the SDK path runs exactly as before. Three things this mode must be
// honest about, because it changes what a record may CLAIM:
//
//  · The PUBLISHER's wallet registers the blob. `suiObjectId` and any digest are
//    theirs, so "our wallet registered this" stops being true. Every pointer now
//    carries `registeredBy: 'wallet' | 'publisher'` EXPLICITLY, on both paths —
//    a reader must never infer custody from a missing field.
//  · The publisher returns NO register/certify digests on a fresh write, and on a
//    repeat it returns a certification event digest but no `suiObjectId`, no size
//    and no encoding type. Thinner provenance is recorded as thinner, never
//    padded out with a value we were not told.
//  · The publisher DOES dedupe identical bytes for free, which the SDK does not
//    (S3 has this backwards from what you would expect of a paid vs free path).
//
// The property the gate actually relies on — fetch the bytes back and recompute
// the blob ID — is unaffected by who paid. Because a third party is now in the
// middle of the write, this mode VERIFIES that property at write time by default
// rather than assuming it: publish, read back from the aggregator, compare
// digests, and refuse the pointer if they differ.

import { createHash } from 'node:crypto';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { walrus, TESTNET_WALRUS_PACKAGE_CONFIG, WalrusFile } from '@mysten/walrus';
import { SUI_FULLNODE, EXPECTED_SUI_ADDRESS, loadSuiSecret } from './config.mjs';

export const DEFAULT_AGGREGATOR = 'https://aggregator.walrus-testnet.walrus.space';

/**
 * Both measured returning HTTP 200 from the DGX on 2026-07-25 — 14.5 s and 8.4 s
 * for the same bytes (S11). Order is failover order.
 */
export const DEFAULT_PUBLISHERS = Object.freeze([
  'https://publisher.walrus-testnet.walrus.space',
  'https://walrus-testnet-publisher.nodes.guru',
]);

/**
 * Resolve publisher mode from the environment.
 *
 * `SUREX_WALRUS_PUBLISHER` unset or empty → [] → the SDK path, unchanged.
 * A truthy flag (`1` / `true` / `default`) → the two verified public publishers.
 * Otherwise a comma-separated list of base URLs, tried in order.
 *
 * Returning a LIST rather than a boolean is deliberate: one publisher is a single
 * point of failure for the only write path a residential box has.
 */
export function publishersFrom(env = process.env) {
  const raw = String(env.SUREX_WALRUS_PUBLISHER ?? '').trim();
  if (!raw) return [];
  if (/^(1|true|yes|on|default)$/i.test(raw)) return [...DEFAULT_PUBLISHERS];
  return raw
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/**
 * Normalise a publisher's PUT response into the fields a pointer may claim.
 *
 * Both shapes are VERIFIED against the live testnet publisher (2026-07-25), and
 * they are not symmetric — which is the whole reason this is a named, tested
 * function rather than three lines inline:
 *
 *   newlyCreated     → { blobObject: { id, blobId, size, encodingType,
 *                        registeredEpoch, certifiedEpoch, deletable, storage } }
 *   alreadyCertified → { blobId, event: { txDigest, eventSeq }, endEpoch }
 *
 * `alreadyCertified` carries NO object id, NO size and NO encoding type. Each is
 * therefore null rather than guessed, and `outcome` is recorded so a reader knows
 * WHY they are null instead of suspecting a bug.
 *
 * Note also that `newlyCreated.blobObject.certifiedEpoch` comes back **null** even
 * though the publisher certified the blob before answering — so it is passed
 * through as null and no surface may render a certified epoch from a publisher
 * write.
 */
export function parsePublisherWrite(json) {
  const fresh = json?.newlyCreated?.blobObject;
  if (fresh?.blobId) {
    return {
      outcome: 'newlyCreated',
      blobId: fresh.blobId,
      suiObjectId: fresh.id ?? null,
      certifyTx: null,
      encodingType: normaliseEncodingType(fresh.encodingType),
      certifiedEpoch: fresh.certifiedEpoch ?? null,
      registeredEpoch: fresh.registeredEpoch ?? null,
      endEpoch: fresh.storage?.endEpoch ?? null,
      deletable: fresh.deletable ?? null,
      reportedSize: typeof fresh.size === 'number' ? fresh.size : null,
    };
  }

  const known = json?.alreadyCertified;
  if (known?.blobId) {
    return {
      outcome: 'alreadyCertified',
      blobId: known.blobId,
      suiObjectId: null,
      certifyTx: known.event?.txDigest ?? null,
      encodingType: null,
      certifiedEpoch: null,
      registeredEpoch: null,
      endEpoch: known.endEpoch ?? null,
      deletable: null,
      reportedSize: null,
    };
  }

  // A 200 whose body we do not recognise is not a write. Saying so here is what
  // stops an unrecognised shape becoming a record with an undefined blob id.
  throw new Error(
    `publisher answered 200 with a shape we do not recognise: ${JSON.stringify(json).slice(0, 300)}`,
  );
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * `encoding_type` arrives as a string, a BCS enum object, or a raw number
 * depending on which read path produced the blob object. Normalise, and when the
 * number is not one we recognise say so rather than guessing a label — a wrong
 * encoding label on a record makes a future blob-ID mismatch unexplainable.
 */
export function normaliseEncodingType(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value === 1 ? 'RS2' : `enum:${value}`;
  if (typeof value === 'object') {
    const key = Object.keys(value).find((k) => value[k]);
    return key ?? null;
  }
  return null;
}

/** Turn a JSON record body into deterministic bytes. Sorted keys, trailing LF. */
export function recordBytes(body) {
  return new TextEncoder().encode(`${JSON.stringify(body, Object.keys(body).sort())}\n`);
}

/**
 * @typedef {Object} EvidencePointer  what a record stores about its own bytes
 * @property {string}  blobId
 * @property {string=} suiObjectId    absent for a quilt patch — see `patchId`
 * @property {string=} registerTx
 * @property {string=} certifyTx
 * @property {string=} encodingType
 * @property {number=} nShards
 * @property {string}  contentSha256
 * @property {number}  size
 * @property {'blob'|'quilt-patch'} addressing
 * @property {string=} patchId        quilt patch id, when addressing is quilt-patch
 * @property {string=} quiltBlobId    the containing quilt, when addressing is quilt-patch
 * @property {'wallet'|'publisher'} registeredBy  WHOSE wallet registered the blob.
 *   `wallet` = ours, and suiObjectId + both digests are ours to stand behind.
 *   `publisher` = a public HTTP publisher's, so the object and any digest are
 *   THEIRS. Always present on both paths — custody is never inferred from a
 *   missing field.
 * @property {string=} publisher          base URL, when registeredBy is publisher
 * @property {'newlyCreated'|'alreadyCertified'=} publisherOutcome
 * @property {boolean=} readbackVerified  the aggregator was asked for the bytes
 *   back and they hashed to contentSha256, at write time
 */

export async function createWalrusWriter(options = {}) {
  const fullnode = options.fullnode ?? SUI_FULLNODE;
  const log = options.log ?? (() => {});

  /**
   * The key is loaded ON DEMAND, not at construction.
   *
   * Publisher mode does not need a Sui wallet at all — that is the point of it,
   * the publisher's wallet pays — and a writer that demands a key before it will
   * do a keyless write is a writer that cannot be deployed anywhere the key is
   * not. Found the hard way: the first publisher run on the DGX died on a missing
   * secrets file having never touched the network.
   *
   * The address assertion moves in here with it, so it still fires before any
   * write that actually spends, and never for one that does not.
   */
  let signerCache = options.keypair ?? null;
  let addressCache = null;
  function signer() {
    if (!signerCache) signerCache = Ed25519Keypair.fromSecretKey(loadSuiSecret());
    return signerCache;
  }
  function addressOf() {
    if (addressCache) return addressCache;
    const resolved = signer().toSuiAddress();
    if (
      options.expectAddress !== false &&
      EXPECTED_SUI_ADDRESS &&
      resolved.toLowerCase() !== EXPECTED_SUI_ADDRESS
    ) {
      throw new Error(
        `loaded Sui key is ${resolved}, expected ${EXPECTED_SUI_ADDRESS}. ` +
          'Writing from an unfunded address stalls one transaction in; refusing.',
      );
    }
    addressCache = resolved;
    return addressCache;
  }

  /** [] = the SDK write path. Non-empty = HTTP publisher mode. See the header. */
  const publishers = options.publishers ?? publishersFrom(options.env ?? process.env);
  const aggregator = (options.aggregator ?? DEFAULT_AGGREGATOR).replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const publishTimeoutMs = options.publishTimeoutMs ?? 90_000;
  /** The readback is the point of the mode; turning it off has to be deliberate. */
  const verifyPublished = options.verifyPublished !== false;

  const client =
    options.client ?? new SuiGrpcClient({ network: 'testnet', baseUrl: fullnode }).$extend(walrus());

  /** Cached, because every write needs it and it changes once a day. */
  let system = null;
  async function systemState() {
    if (!system) system = await client.walrus.systemState();
    return system;
  }

  async function balances() {
    const { balances: list } = await client.core.listBalances({ owner: addressOf() });
    const of = (suffix) => BigInt(list.find((b) => b.coinType.endsWith(suffix))?.balance ?? 0n);
    return { sui: of('::sui::SUI'), wal: of('::wal::WAL'), raw: list };
  }

  /** The on-chain ceiling, never a constant from a doc. Testnet reads 53. */
  async function maxEpochs() {
    return (await systemState()).future_accounting.length;
  }

  async function nShards() {
    return (await systemState()).committee.n_shards;
  }

  async function quote(size, epochs) {
    return client.walrus.storageCost(size, epochs ?? (await maxEpochs()));
  }

  /** Unwrap the tagged union, surface the digest, wait for finality. */
  async function execute(transaction, label) {
    transaction.setSenderIfNotSet(addressOf());
    const result = await signer().signAndExecuteTransaction({ transaction, client });
    if (result.FailedTransaction) {
      throw new Error(
        `${label} failed (${result.FailedTransaction.digest}): ${result.FailedTransaction.status.error?.message}`,
      );
    }
    const { digest } = result.Transaction;
    await client.core.waitForTransaction({ digest });
    log(`    ${label} tx ${digest}`);
    return digest;
  }

  /**
   * Swap SUI for WAL only if the wallet has none. The exchange PACKAGE id is
   * derived from the on-chain type of the exchange OBJECT, so nothing is pinned
   * by hand here either.
   */
  async function ensureWal({ suiToSpend = 500_000_000 } = {}) {
    const before = await balances();
    if (before.wal > 0n) return { swapped: false, wal: before.wal };
    const exchangeId = TESTNET_WALRUS_PACKAGE_CONFIG.exchangeIds[0];
    const { object: exchange } = await client.core.getObject({ objectId: exchangeId });
    const exchangePackageId = exchange.type.split('::')[0];
    const tx = new Transaction();
    const payment = tx.splitCoins(tx.gas, [suiToSpend]);
    const wal = tx.moveCall({
      target: `${exchangePackageId}::wal_exchange::exchange_all_for_wal`,
      arguments: [tx.object(exchangeId), payment],
    });
    tx.transferObjects([wal], addressOf());
    const digest = await execute(tx, 'exchange');
    const after = await balances();
    return { swapped: true, wal: after.wal, digest };
  }

  /**
   * Fetch bytes back from the aggregator and hand them to the caller to judge.
   *
   * Separate from the write so the check is testable on its own, and so a
   * verification failure reads as a verification failure rather than as a write
   * that half-happened.
   */
  async function fetchPublished(blobId) {
    const res = await fetchImpl(`${aggregator}/v1/blobs/${encodeURIComponent(blobId)}`);
    if (!res.ok) throw new Error(`aggregator answered ${res.status} for blob ${blobId}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  /**
   * PUT the bytes to a publisher, first one that answers wins.
   *
   * `permanent=true` mirrors the SDK path's `deletable: false` — the registry's
   * evidence must not be quietly removable, including by us, and including by
   * whoever's wallet paid for it.
   *
   * The timeout is cleared in a `finally` and not on the happy path alone: an
   * un-cleared AbortController timer is what held a process open for 120 s after
   * its work was done (FRICTION-LOG V3).
   */
  async function putToPublishers(payload, term, label) {
    const failures = [];
    for (const base of publishers) {
      const url = `${base}/v1/blobs?epochs=${term}&permanent=true`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), publishTimeoutMs);
      const startedAt = Date.now();
      try {
        const res = await fetchImpl(url, {
          method: 'PUT',
          body: payload,
          headers: { 'content-type': 'application/octet-stream' },
          signal: controller.signal,
        });
        const text = await res.text();
        if (!res.ok) {
          // S2: an out-of-range `epochs` comes back as a 500 wrapping a raw Move
          // abort, so the body is worth far more than the status here.
          failures.push(`${base} → HTTP ${res.status} ${text.slice(0, 200)}`);
          continue;
        }
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          failures.push(`${base} → 200 with a body that is not JSON: ${text.slice(0, 200)}`);
          continue;
        }
        const parsed = parsePublisherWrite(json);
        log(
          `  walrus publish ${label} via ${base} · ${parsed.outcome} · ${Date.now() - startedAt} ms`,
        );
        return { ...parsed, publisher: base };
      } catch (err) {
        const why = err?.name === 'AbortError' ? `no answer in ${publishTimeoutMs} ms` : (err?.message ?? String(err));
        failures.push(`${base} → ${why}`);
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error(
      `no publisher accepted ${label}: ${failures.join(' · ')}`,
    );
  }

  /**
   * The publisher write. Same contract as the SDK's writeRecord — an
   * EvidencePointer — with custody stated rather than implied.
   *
   * @returns {Promise<EvidencePointer>}
   */
  async function writeRecordViaPublisher(payload, { term, shards, label }) {
    const localSha = sha256Hex(payload);
    const published = await putToPublishers(payload, term, label);

    // The publisher tells us the size it stored. When it disagrees with what we
    // sent, the pointer would bind this record to bytes that are not this
    // record's — refuse rather than write it.
    if (published.reportedSize !== null && published.reportedSize !== payload.length) {
      throw new Error(
        `publisher ${published.publisher} stored ${published.reportedSize} B for ${label}, we sent ${payload.length} B`,
      );
    }

    if (verifyPublished) {
      // The property the gate relies on, checked at write time because a third
      // party is now in the middle of the write. A publisher that truncated,
      // re-encoded or simply lied about the blob id fails HERE, once, rather than
      // in the gate, later, against a record that already claims to be evidence.
      const served = await fetchPublished(published.blobId);
      const servedSha = sha256Hex(served);
      if (servedSha !== localSha) {
        throw new Error(
          `blob ${published.blobId} serves ${servedSha}, we published ${localSha} — refusing the pointer`,
        );
      }
      log(`    readback verified: aggregator serves the bytes we published`);
    }

    return {
      blobId: published.blobId,
      // Absent rather than null, so it drops out of the serialised record the
      // same way the SDK path's optional fields do — and never our address: on
      // this path the blob object belongs to the PUBLISHER's wallet.
      suiObjectId: published.suiObjectId ?? undefined,
      // The publisher reports neither digest on a fresh write. `alreadyCertified`
      // reports the certification EVENT's digest, which is a real Sui transaction
      // and is recorded as certifyTx — it is just not one we sent.
      registerTx: undefined,
      certifyTx: published.certifyTx ?? undefined,
      encodingType: published.encodingType,
      nShards: shards,
      // Ours, computed from the bytes we sent. This is the field that binds the
      // record to its Arkiv entity, and it is the one thing the publisher cannot
      // influence — which is why the mode is sound despite the thinner custody.
      contentSha256: localSha,
      size: payload.length,
      addressing: 'blob',
      epochs: term,
      digestFrom: 'written',
      certifiedEpoch: published.certifiedEpoch,
      deletable: published.deletable,
      // ── custody, stated ──────────────────────────────────────────────────
      registeredBy: 'publisher',
      publisher: published.publisher,
      publisherOutcome: published.outcome,
      readbackVerified: verifyPublished,
    };
  }

  /**
   * One standalone certified blob: owned, permanent, both digests captured.
   *
   * This is the write for anything whose per-record citability is the point — a
   * source tree, a review, a dispute submission. Seed-time registry metadata does
   * NOT come through here; it goes into a quilt (writeQuiltOfRecords) because 50
   * standalone blobs is 100 Sui transactions for no citation anyone needs.
   *
   * In publisher mode the same call writes over HTTP instead, because the SDK
   * path cannot complete from a residential uplink (S11). The pointer says which
   * path produced it.
   *
   * @returns {Promise<EvidencePointer>}
   */
  async function writeRecord(bytes, { epochs, label = 'record' } = {}) {
    const payload = bytes instanceof Uint8Array ? bytes : recordBytes(bytes);
    const term = epochs ?? (await maxEpochs());
    const shards = await nShards();

    if (publishers.length) {
      return writeRecordViaPublisher(payload, { term, shards, label });
    }

    log(`  walrus write ${label} (${payload.length} B, ${term} epochs)`);
    const flow = client.walrus.writeBlobFlow({ blob: payload });
    const encoded = await flow.encode();
    const registerTx = await execute(
      flow.register({ epochs: term, owner: addressOf(), deletable: false }),
      'register',
    );
    const uploaded = await flow.upload({ digest: registerTx });
    const certifyTx = await execute(flow.certify(), 'certify');
    const blob = await flow.getBlob();

    return {
      blobId: encoded.blobId,
      suiObjectId: uploaded.blobObjectId,
      registerTx,
      certifyTx,
      encodingType: normaliseEncodingType(blob.blobObject?.encoding_type),
      nShards: shards,
      contentSha256: sha256Hex(payload),
      size: payload.length,
      addressing: 'blob',
      epochs: term,
      digestFrom: 'written',
      certifiedEpoch: blob.blobObject?.certified_epoch ?? null,
      deletable: blob.blobObject?.deletable ?? null,
      // Stated on BOTH paths so custody is read, never inferred from which
      // fields happen to be present.
      registeredBy: 'wallet',
    };
  }

  /**
   * ONE quilt holding many small record bodies. Two Sui transactions total, no
   * matter how many records go in (Quilt batches up to 660 small blobs into one
   * storage unit).
   *
   * The trade, recorded rather than papered over: a quilted record is addressed
   * as (quilt blob, patch id) and has NO certified Sui object of its own, so it
   * has no per-record explorer link. Every pointer returned here carries
   * `addressing: 'quilt-patch'`, its own `patchId`, and the containing
   * `quiltBlobId`, so a consumer can tell the difference without being told.
   * `contentSha256` is per PATCH — the patch's own bytes — which is what binds a
   * single record to its Arkiv entity even though the certification is shared.
   *
   * @param {{identifier:string, body:object|Uint8Array, tags?:Record<string,string>}[]} items
   * @returns {Promise<{quilt: object, patches: Map<string, EvidencePointer>}>}
   */
  async function writeQuiltOfRecords(items, { epochs, label = 'quilt' } = {}) {
    if (!items.length) throw new Error('writeQuiltOfRecords called with no items');
    if (items.length > 660) throw new Error(`quilt holds at most 660 patches, got ${items.length}`);
    const term = epochs ?? (await maxEpochs());
    const shards = await nShards();

    const seen = new Set();
    const prepared = items.map((item) => {
      const identifier = String(item.identifier);
      if (seen.has(identifier)) throw new Error(`duplicate quilt identifier ${identifier}`);
      seen.add(identifier);
      const contents = item.body instanceof Uint8Array ? item.body : recordBytes(item.body);
      return { identifier, contents, tags: item.tags };
    });

    const totalBytes = prepared.reduce((n, p) => n + p.contents.length, 0);
    log(`  walrus quilt ${label}: ${prepared.length} patches, ${totalBytes} B, ${term} epochs`);

    const files = prepared.map((p) =>
      WalrusFile.from({ contents: p.contents, identifier: p.identifier, tags: p.tags }),
    );
    const flow = client.walrus.writeFilesFlow({ files });
    const encoded = await flow.encode();
    const registerTx = await execute(
      flow.register({ epochs: term, owner: addressOf(), deletable: false }),
      'register',
    );
    const uploaded = await flow.upload({ digest: registerTx });
    const certifyTx = await execute(flow.certify(), 'certify');

    // ── mapping identifier → patch id ──────────────────────────────────────
    //
    // `listFiles()` gives the patch ids and NOTHING ELSE — no identifier field —
    // and it does NOT return them in the order the files went in. Measured on a
    // real 50-patch quilt: positional mapping was correct for 1 of 50, and
    // "sorted by identifier" for 5 of 50, so the order is neither. Assuming
    // either produces 50 records each pointing at another record's bytes, which
    // reads as tampering and is undetectable without fetching.
    //
    // `writeQuilt()` DOES return `index.patches[]` with both `patchId` and
    // `identifier` — but it discards the register/certify digests, the same way
    // `executeCertify()` does (FRICTION-LOG S4). So no single SDK call gives both
    // provenance and per-patch addressing.
    //
    // The mapping is therefore read back from the certified quilt and verified,
    // never inferred: each patch's own identifier comes from the quilt index, and
    // each patch's bytes are hashed and compared against what we hashed locally.
    // Nothing is returned until the mapping is a proven bijection.
    const listed = await flow.listFiles();
    const patchIds = listed.map((f) => f.id);
    const readBack = await client.walrus.getFiles({ ids: patchIds });
    const patchIdByIdentifier = new Map();
    const shaByIdentifier = new Map();
    for (let i = 0; i < readBack.length; i += 1) {
      const identifier = await readBack[i].getIdentifier();
      if (!identifier) throw new Error(`quilt patch ${patchIds[i]} came back with no identifier`);
      if (patchIdByIdentifier.has(identifier)) {
        throw new Error(`quilt returned two patches for identifier ${identifier}`);
      }
      patchIdByIdentifier.set(identifier, patchIds[i]);
      shaByIdentifier.set(identifier, sha256Hex(Buffer.from(await readBack[i].bytes())));
    }
    if (patchIdByIdentifier.size !== prepared.length) {
      throw new Error(
        `quilt has ${patchIdByIdentifier.size} addressable patches, wrote ${prepared.length}`,
      );
    }
    log(`    mapped ${patchIdByIdentifier.size} patches by identifier read back from the quilt index`);

    const quilt = {
      blobId: encoded.blobId,
      suiObjectId: uploaded.blobObjectId,
      registerTx,
      certifyTx,
      encodingType: normaliseEncodingType(listed[0]?.blobObject?.encoding_type),
      nShards: shards,
      size: totalBytes,
      patchCount: prepared.length,
      epochs: term,
    };

    const patches = new Map();
    for (const p of prepared) {
      const patchId = patchIdByIdentifier.get(p.identifier);
      if (!patchId) throw new Error(`no patch id came back for ${p.identifier}`);
      const localSha = sha256Hex(p.contents);
      const remoteSha = shaByIdentifier.get(p.identifier);
      if (remoteSha !== localSha) {
        // The pointer would bind this record's Arkiv entity to bytes that are not
        // this record's. Refuse rather than write it.
        throw new Error(
          `quilt patch ${patchId} for ${p.identifier} hashes to ${remoteSha}, we wrote ${localSha}`,
        );
      }
      patches.set(p.identifier, {
        // A quilt patch id IS the read address, so it is recorded as `blobId`'s
        // sibling rather than in place of it: `blobId` stays the quilt's, which
        // is what has on-chain certification, and `patchId` is what fetches THIS
        // record. Collapsing the two would imply a certification that this
        // record does not individually have.
        blobId: encoded.blobId,
        quiltBlobId: encoded.blobId,
        patchId,
        suiObjectId: uploaded.blobObjectId,
        registerTx,
        certifyTx,
        encodingType: quilt.encodingType,
        nShards: shards,
        contentSha256: localSha,
        size: p.contents.length,
        addressing: 'quilt-patch',
        epochs: term,
        // Set explicitly rather than left to be inferred from absence: a reader
        // must never have to guess whether a digest describes the bytes we sent or
        // the bytes something gave back.
        digestFrom: 'written',
        // Quilts are SDK-only. There is no publisher endpoint that writes one, so
        // this path is not portable to a residential uplink — writeRecord is.
        registeredBy: 'wallet',
      });
    }

    return { quilt, patches };
  }

  /**
   * Read a set of quilt patches back and report, per patch, the identifier the
   * QUILT INDEX gives it and the sha256 of the bytes it actually serves.
   *
   * `patchIds` must be supplied. A WalrusFile exposes `getIdentifier()` but not its
   * own patch id, and there is no public encoder from (blobId, index range) to a
   * patch id — so the ids have to come from the write-time `flow.listFiles()`
   * output, which is what the seed checkpoint stores. Their ORDER is meaningless;
   * only the set matters, which is the whole point of this function.
   */
  async function readQuiltPatches(patchIds) {
    if (!Array.isArray(patchIds) || !patchIds.length) {
      throw new Error('readQuiltPatches needs patch ids (from flow.listFiles() at write time)');
    }
    const files = await client.walrus.getFiles({ ids: patchIds });
    const out = [];
    for (let i = 0; i < files.length; i += 1) {
      const bytes = Buffer.from(await files[i].bytes());
      out.push({
        patchId: patchIds[i],
        identifier: await files[i].getIdentifier(),
        tags: await files[i].getTags(),
        bytes,
        contentSha256: sha256Hex(bytes),
      });
    }
    return out;
  }

  /**
   * Rebuild the identifier → patch pointer map for a quilt that is ALREADY
   * certified.
   *
   * This exists so a mapping recorded wrong can be repaired without paying for a
   * second quilt — `alreadyCertified` dedup is publisher behaviour, so re-writing
   * the same bytes through the SDK re-charges (S3).
   *
   * `items` is optional. When given, each patch's served bytes are hashed and
   * compared against the bytes the caller believes it wrote, which is the strong
   * check. When omitted, the digest recorded is the digest of the bytes the
   * certified quilt served — which is sound, because a Walrus blob ID is a
   * commitment over the blob's content, so bytes that come out of a certified
   * quilt are the bytes that went into it. It is a weaker STATEMENT, though, so
   * the pointer is marked `digestFrom: 'served'` rather than `'written'` and no
   * surface may claim otherwise.
   *
   * @param {{blobId:string, suiObjectId?:string, registerTx?:string, certifyTx?:string,
   *          encodingType?:string, nShards?:number, epochs?:number}} quilt
   * @param {{patchIds:string[], items?:{identifier:string, body:object|Uint8Array}[]}} opts
   */
  async function mapCertifiedQuilt(quilt, { patchIds, items } = {}) {
    const shards = quilt.nShards ?? (await nShards());
    const read = await readQuiltPatches(patchIds);

    const byIdentifier = new Map();
    for (const patch of read) {
      if (!patch.identifier) continue;
      if (byIdentifier.has(patch.identifier)) {
        throw new Error(`quilt ${quilt.blobId} returned two patches for identifier ${patch.identifier}`);
      }
      byIdentifier.set(patch.identifier, patch);
    }

    const wanted = items
      ? items.map((i) => ({ identifier: String(i.identifier), body: i.body }))
      : [...byIdentifier.keys()].map((identifier) => ({ identifier, body: null }));

    const patches = new Map();
    for (const want of wanted) {
      const found = byIdentifier.get(want.identifier);
      if (!found) throw new Error(`quilt ${quilt.blobId} has no patch for ${want.identifier}`);
      let digestFrom = 'served';
      if (want.body) {
        const localBytes = want.body instanceof Uint8Array ? want.body : recordBytes(want.body);
        const localSha = sha256Hex(localBytes);
        if (localSha !== found.contentSha256) {
          throw new Error(
            `quilt patch for ${want.identifier} serves ${found.contentSha256}, the body we have hashes to ${localSha}`,
          );
        }
        digestFrom = 'written';
      }
      patches.set(want.identifier, {
        blobId: quilt.blobId,
        quiltBlobId: quilt.blobId,
        patchId: found.patchId,
        suiObjectId: quilt.suiObjectId,
        registerTx: quilt.registerTx,
        certifyTx: quilt.certifyTx,
        encodingType: quilt.encodingType,
        nShards: shards,
        contentSha256: found.contentSha256,
        size: found.bytes.length,
        addressing: 'quilt-patch',
        epochs: quilt.epochs,
        digestFrom,
        registeredBy: 'wallet',
      });
    }
    return { patches, read };
  }

  return {
    /**
     * A GETTER, because reading it loads the key. Publisher mode never needs one,
     * so a caller that logs the address "for context" would turn a keyless write
     * into a hard requirement for a key — which is precisely the bug this
     * lazy-loading exists to prevent. Read it only where you mean to spend.
     */
    get address() {
      return addressOf();
    },
    client,
    systemState,
    balances,
    maxEpochs,
    nShards,
    quote,
    ensureWal,
    writeRecord,
    writeQuiltOfRecords,
    readQuiltPatches,
    mapCertifiedQuilt,
    fetchPublished,
    sha256Hex,
    recordBytes,
    /** [] when the SDK path is in use. Callers log which write they are about to do. */
    publishers,
  };
}
