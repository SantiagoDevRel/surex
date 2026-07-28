// The Walrus writer. Record bodies in, evidence pointers out.
//
// Not negotiable, each because it was measured:
//
//  · Step the flow by hand — encode → register → upload → certify. The convenience
//    wrapper `executeCertify()` discards the certify digest (FRICTION-LOG S4).
//  · Read the epoch ceiling off chain. Testnet max is 53, not the 183 in every doc;
//    `epochs=183` comes back as HTTP 500 wrapping a raw EInvalidEpochsAhead Move
//    abort (S2).
//  · Read package / object / exchange IDs at runtime — testnet has been redeployed
//    before, so a hardcoded ID is a time bomb.
//  · Blobs are owned + permanent (`deletable: false`). The registry's evidence must
//    not be quietly removable, including by us.
//  · `contentSha256` on every record. A Walrus blob ID is not sha256(bytes) — it is
//    a commitment over the erasure-coded sliver structure — so the digest binding
//    served bytes to the Arkiv record is a separate field computed here, consumed by
//    verifyEvidenceBytes() in packages/core/src/blob.mjs.
//  · `nShards` on every record too. Blob IDs are deterministic over content and
//    network configuration; without the shard count a mismatch is unexplainable.
//
// Cost: one standalone blob = two Sui transactions, priced per blob rather than per
// byte. `alreadyCertified` dedup is publisher behaviour, not protocol — this SDK
// re-registers, re-certifies and re-charges for bytes already certified (S3), so a
// re-run is not free and the seed checkpoints instead.
//
// Publisher mode (SUREX_WALRUS_PUBLISHER). The SDK uploads slivers directly to all
// 101 committee members in parallel, which a residential uplink does not complete —
// 4/4 NotEnoughBlobConfirmationsError from the DGX where the HTTP publisher succeeds
// at the same moment (S11: balance, Node version, IPv6 and file descriptors were
// each ruled out; do not re-derive it). Set the variable and the record goes over
// HTTP. Three things change about what a record may claim:
//
//  · The publisher's wallet registers the blob, so `suiObjectId` and any digest are
//    theirs. `registeredBy: 'wallet' | 'publisher'` is set explicitly on both paths
//    — a reader must never infer custody from a missing field.
//  · No register/certify digests on a fresh write; on a repeat, a certification
//    event digest but no `suiObjectId`, size or encoding type. Thinner provenance is
//    recorded as thinner, never padded out with a value we were not told.
//  · The publisher dedupes identical bytes for free, which the SDK does not.
//
// A third party is now in the middle of the write, so this mode re-fetches the bytes
// from the aggregator and compares digests at write time by default, refusing the
// pointer if they differ.

import { createHash } from 'node:crypto';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { walrus, TESTNET_WALRUS_PACKAGE_CONFIG, WalrusFile } from '@mysten/walrus';
import { SUI_FULLNODE, EXPECTED_SUI_ADDRESS, loadSuiSecret } from './config.mjs';

export const DEFAULT_AGGREGATOR = 'https://aggregator.walrus-testnet.walrus.space';

/** Tried in order — this is the failover order. */
export const DEFAULT_PUBLISHERS = Object.freeze([
  'https://publisher.walrus-testnet.walrus.space',
  'https://walrus-testnet-publisher.nodes.guru',
]);

/**
 * Resolve publisher mode from the environment.
 *
 * `SUREX_WALRUS_PUBLISHER` unset or empty → [] → the SDK path, unchanged.
 * A truthy flag (`1` / `true` / `default`) → the two default public publishers.
 * Otherwise a comma-separated list of base URLs, tried in order.
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
 * Normalise a publisher's PUT response into the fields a pointer may claim. The two
 * wire shapes are not symmetric:
 *
 *   newlyCreated     → { blobObject: { id, blobId, size, encodingType,
 *                        registeredEpoch, certifiedEpoch, deletable, storage } }
 *   alreadyCertified → { blobId, event: { txDigest, eventSeq }, endEpoch }
 *
 * `alreadyCertified` carries no object id, no size and no encoding type — each is
 * null rather than guessed, and `outcome` records why. `newlyCreated.blobObject
 * .certifiedEpoch` also comes back **null** even though the publisher certified
 * before answering, so no surface may render a certified epoch from a publisher
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

  // A 200 whose body we do not recognise is not a write — throwing here is what
  // stops an unrecognised shape becoming a record with an undefined blob id.
  throw new Error(
    `publisher answered 200 with a shape we do not recognise: ${JSON.stringify(json).slice(0, 300)}`,
  );
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * `encoding_type` arrives as a string, a BCS enum object or a raw number depending
 * on which read path produced the blob object. An unrecognised number keeps an
 * `enum:N` label rather than a guessed one — a wrong label on a record makes a
 * future blob-ID mismatch unexplainable.
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

/**
 * Turn a JSON record body into deterministic bytes. Sorted keys, trailing LF.
 *
 * Never `JSON.stringify(body, Object.keys(body).sort())`. An array replacer is a
 * property allowlist applied recursively, not a key ordering: every nested object
 * silently keeps only the properties whose names are also top-level keys of `body`,
 * and the hash then commits to the gutted version.
 *
 * The blob ID derives from these bytes, so two runs producing the same record must
 * produce the same ID or the registry stores — and pays for — one fact twice.
 */
export function recordBytes(body) {
  return new TextEncoder().encode(`${JSON.stringify(sortDeep(body))}\n`);
}

/**
 * Order every object's keys, at every depth, without dropping any of them.
 * Arrays keep their order — a findings list is a sequence, not a set.
 */
function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortDeep(value[key]);
    return out;
  }
  return value;
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
 * @property {'wallet'|'publisher'} registeredBy  whose wallet registered the blob;
 *   under `publisher` the object and any digest are theirs, not ours. Always
 *   present on both paths — custody is never inferred from a missing field.
 * @property {string=} publisher          base URL, when registeredBy is publisher
 * @property {'newlyCreated'|'alreadyCertified'=} publisherOutcome
 * @property {boolean=} readbackVerified  the aggregator was asked for the bytes
 *   back and they hashed to contentSha256, at write time
 */

export async function createWalrusWriter(options = {}) {
  const fullnode = options.fullnode ?? SUI_FULLNODE;
  const log = options.log ?? (() => {});

  /**
   * The key loads on demand, not at construction: publisher mode needs no Sui
   * wallet, so constructing the writer must not require a key. The address
   * assertion rides along, firing before any write that spends and never for one
   * that does not.
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

  /** [] = the SDK write path. Non-empty = HTTP publisher mode. */
  const publishers = options.publishers ?? publishersFrom(options.env ?? process.env);
  const aggregator = (options.aggregator ?? DEFAULT_AGGREGATOR).replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const publishTimeoutMs = options.publishTimeoutMs ?? 90_000;
  const verifyPublished = options.verifyPublished !== false;

  const client =
    options.client ?? new SuiGrpcClient({ network: 'testnet', baseUrl: fullnode }).$extend(walrus());

  /** Cached — every write needs it and it changes about once a day. */
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

  /** Swap SUI for WAL only if the wallet has none. */
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

  /** Fetch bytes back from the aggregator and hand them to the caller to judge. */
  async function fetchPublished(blobId) {
    const res = await fetchImpl(`${aggregator}/v1/blobs/${encodeURIComponent(blobId)}`);
    if (!res.ok) throw new Error(`aggregator answered ${res.status} for blob ${blobId}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  /**
   * PUT the bytes to a publisher, first one that answers wins.
   *
   * `permanent=true` mirrors the SDK path's `deletable: false` — evidence must not
   * be quietly removable by anyone, including whoever's wallet paid for it. The
   * timeout clears in a `finally` and not on the happy path alone: an un-cleared
   * AbortController timer holds the process open for its full duration (V3).
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
          // An out-of-range `epochs` comes back as a 500 wrapping a raw Move abort,
          // so the body carries far more than the status (S2).
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
   * The publisher write. Same contract as writeRecord, with custody stated.
   *
   * @returns {Promise<EvidencePointer>}
   */
  async function writeRecordViaPublisher(payload, { term, shards, label }) {
    const localSha = sha256Hex(payload);
    const published = await putToPublishers(payload, term, label);

    // A stored size that disagrees with what we sent means the pointer would bind
    // this record to bytes that are not this record's. Refuse rather than write it.
    if (published.reportedSize !== null && published.reportedSize !== payload.length) {
      throw new Error(
        `publisher ${published.publisher} stored ${published.reportedSize} B for ${label}, we sent ${payload.length} B`,
      );
    }

    if (verifyPublished) {
      // A publisher that truncated, re-encoded or lied about the blob id fails
      // here rather than later in the gate, against a record already published as
      // evidence.
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
      // undefined, not null, so it drops out of the serialised record the way the
      // SDK path's optional fields do. Never our address — on this path the blob
      // object belongs to the publisher's wallet.
      suiObjectId: published.suiObjectId ?? undefined,
      // No digest on a fresh write. `alreadyCertified` gives the certification
      // event's digest — a real Sui transaction, just not one we sent.
      registerTx: undefined,
      certifyTx: published.certifyTx ?? undefined,
      encodingType: published.encodingType,
      nShards: shards,
      // Ours, computed from the bytes we sent. This binds the record to its Arkiv
      // entity and is the one field the publisher cannot influence.
      contentSha256: localSha,
      size: payload.length,
      addressing: 'blob',
      epochs: term,
      digestFrom: 'written',
      certifiedEpoch: published.certifiedEpoch,
      deletable: published.deletable,
      registeredBy: 'publisher',
      publisher: published.publisher,
      publisherOutcome: published.outcome,
      readbackVerified: verifyPublished,
    };
  }

  /**
   * One standalone certified blob: owned, permanent, both digests captured. Use it
   * where per-record citability is the point — a source tree, a review, a dispute
   * submission. Seed-time registry metadata goes through writeQuiltOfRecords
   * instead, because 50 standalone blobs is 100 Sui transactions.
   *
   * In publisher mode this writes over HTTP; the pointer says which path produced
   * it.
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
      // Stated on both paths — custody is never inferred from absent fields.
      registeredBy: 'wallet',
    };
  }

  /**
   * One quilt holding many small record bodies. Two Sui transactions total, no
   * matter how many records go in; a quilt takes at most 660 patches.
   *
   * The trade: a quilted record is addressed as (quilt blob, patch id) and has no
   * certified Sui object of its own. Every pointer carries `addressing:
   * 'quilt-patch'`, its own `patchId` and the containing `quiltBlobId` so a
   * consumer can tell. `contentSha256` is per patch — that is what binds a single
   * record to its Arkiv entity even though the certification is shared.
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

    // Mapping identifier → patch id, read back and checked rather than inferred.
    // `listFiles()` gives patch ids and no identifier field, in an order that is
    // neither input order nor sorted-by-identifier (measured on a 50-patch quilt:
    // 1/50 and 5/50 respectively). Assuming either yields 50 records each pointing
    // at another record's bytes, undetectable without fetching. `writeQuilt()` does
    // return `index.patches[]` with both, but discards the register/certify digests
    // (S4) — so no single SDK call gives provenance and per-patch addressing.
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
        // this record's. Refuse.
        throw new Error(
          `quilt patch ${patchId} for ${p.identifier} hashes to ${remoteSha}, we wrote ${localSha}`,
        );
      }
      patches.set(p.identifier, {
        // `blobId` stays the quilt's — that is what carries the on-chain
        // certification — and `patchId` is what fetches this record. Collapsing the
        // two would imply a certification this record does not individually have.
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
        // Explicit: a reader must never guess whether a digest describes the bytes
        // we sent or the bytes something gave back.
        digestFrom: 'written',
        // Quilts are SDK-only — no publisher endpoint writes one, so this path is
        // not portable to a residential uplink the way writeRecord is.
        registeredBy: 'wallet',
      });
    }

    return { quilt, patches };
  }

  /**
   * Read a set of quilt patches back and report, per patch, the identifier the
   * quilt index gives it and the sha256 of the bytes it actually serves.
   *
   * `patchIds` must be supplied: a WalrusFile exposes `getIdentifier()` but not its
   * own patch id, and there is no public encoder from (blobId, index range) to one,
   * so the ids come from write-time `flow.listFiles()` (what the seed checkpoint
   * stores). Their order is meaningless — only the set matters.
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
   * Rebuild the identifier → patch pointer map for a quilt that is already
   * certified, so a mapping recorded wrong is repairable without paying for a
   * second quilt (the SDK re-charges for identical bytes, S3).
   *
   * `items` is optional and decides what the pointer may claim. Given, each patch's
   * served bytes are hashed against the bytes the caller believes it wrote →
   * `digestFrom: 'written'`. Omitted, the digest is of whatever the certified quilt
   * served → `digestFrom: 'served'`, and no surface may claim otherwise.
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
     * A getter, because reading it loads the key. Publisher mode needs no key, so
     * logging the address "for context" turns a keyless write into one that fails
     * without a secrets file. Read it only where you mean to spend.
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
    /** [] when the SDK path is in use. */
    publishers,
  };
}
