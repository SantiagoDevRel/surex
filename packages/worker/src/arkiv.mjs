// The Arkiv writer. The only process in this repo that holds a wallet.
//
// SDK 0.7.0 specifics, all measured (AGENTS.md §7, probes/arkiv-write-read.mjs):
//  · 0.7.0 no longer re-exports viem — `http` from 'viem', `privateKeyToAccount`
//    from 'viem/accounts'. The `@arkiv-network/sdk/accounts` subpath is gone, so
//    every 0.6.x snippet on the internet fails at the import line (A1).
//  · `createEntity()` AWAITS THE RECEIPT: ~4.6 s per call. That, not index lag, is
//    the cost of a seed. Batch via `mutateEntities({creates:[…]})`.
//  · Index lag after the receipt is ~40 ms to getEntity, ~80 ms to the query index
//    (A4) — poll, but do not budget seconds for it.
//  · `orderBy` is accepted silently and does nothing (A2). Sort client-side.
//  · `updateEntity` is a full replacement (see entities.mjs buildUpdate).
//  · Consumer reads filter on `createdBy`, NEVER `ownedBy` — ownership is
//    transferable via changeOwnership, so ownedBy is attacker-influenceable (A5).
//    The writer's readBack() below therefore checks `creator`, not `owner`.

import { createPublicClient, createWalletClient } from '@arkiv-network/sdk';
import { braga } from '@arkiv-network/sdk/chains';
import { eq } from '@arkiv-network/sdk/query';
import { jsonToPayload } from '@arkiv-network/sdk/utils';
import { http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  ARKIV_RPC,
  BRAGA_CHAIN_ID,
  PROJECT,
  EXPECTED_ARKIV_WRITER,
  loadArkivWriterKey,
} from './config.mjs';

/**
 * Arkiv accepts 1000 operations per mutateEntities transaction, but a seed wants a
 * chunk small enough that one failure loses little and the checkpoint stays
 * meaningful. Tech spec §4.3 says 50–100; 50 is the default here.
 */
export const DEFAULT_CHUNK = 50;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Plain-object payload → the bytes the SDK wants. */
function encode(built) {
  return {
    payload: jsonToPayload(built.payload ?? {}),
    attributes: built.attributes,
    contentType: built.contentType ?? 'application/json',
    expiresIn: built.expiresIn,
  };
}

export function createArkivWriter(options = {}) {
  const rpcUrl = options.rpcUrl ?? ARKIV_RPC;
  const project = options.project ?? PROJECT;
  const log = options.log ?? (() => {});
  const account = options.account ?? privateKeyToAccount(loadArkivWriterKey());

  if (
    options.expectAddress !== false &&
    EXPECTED_ARKIV_WRITER &&
    account.address.toLowerCase() !== EXPECTED_ARKIV_WRITER
  ) {
    // Writing from an address nobody reads is a silent no-op that looks exactly
    // like a successful seed, because every consumer read is `.createdBy`-scoped.
    throw new Error(
      `loaded Arkiv key is ${account.address}, but every consumer read filters on ` +
        `${EXPECTED_ARKIV_WRITER}. Entities written from another address are invisible to the gate.`,
    );
  }

  const transport = http(rpcUrl, { timeout: Number(options.timeoutMs ?? 30000), retryCount: 2 });
  const wallet = createWalletClient({ chain: braga, account, transport });
  const pub = createPublicClient({ chain: braga, transport });

  async function health() {
    const t0 = Date.now();
    const chainId = await pub.getChainId();
    const balance = await pub.getBalance({ address: account.address });
    return { ok: chainId === BRAGA_CHAIN_ID, chainId, balance, rpcUrl, ms: Date.now() - t0 };
  }

  /** One entity. Returns {entityKey, txHash}. ~4.6 s — it waits for the receipt. */
  async function create(built) {
    return wallet.createEntity(encode(built));
  }

  async function update(built) {
    if (!built.entityKey) throw new Error('update needs an entityKey');
    return wallet.updateEntity({ entityKey: built.entityKey, ...encode(built) });
  }

  /**
   * Many entities, chunked. One transaction per chunk, so 100 entities is 2
   * receipts rather than 100.
   *
   * `onChunk` fires after every successful chunk — the seed uses it to checkpoint,
   * which is the difference between a faucet stall at record 40 costing four
   * minutes and costing the whole run.
   */
  async function createMany(builtList, { chunk = DEFAULT_CHUNK, onChunk } = {}) {
    const created = [];
    const txHashes = [];
    for (let i = 0; i < builtList.length; i += chunk) {
      const slice = builtList.slice(i, i + chunk);
      const t0 = Date.now();
      const res = await wallet.mutateEntities({ creates: slice.map(encode) });
      const keys = res.createdEntities ?? [];
      if (keys.length !== slice.length) {
        // Do not paper over a short result: the caller is about to record these
        // keys against specific records, and a silent off-by-N misattributes
        // every entity after the gap.
        throw new Error(
          `mutateEntities created ${keys.length} of ${slice.length} entities (tx ${res.txHash})`,
        );
      }
      log(`  arkiv chunk ${i / chunk + 1}: ${keys.length} entities in ${Date.now() - t0} ms · tx ${res.txHash}`);
      for (let j = 0; j < keys.length; j += 1) created.push({ key: keys[j], built: slice[j] });
      txHashes.push(res.txHash);
      if (onChunk) await onChunk({ txHash: res.txHash, keys, from: i, count: keys.length });
    }
    return { created, txHashes };
  }

  /**
   * Many full-replacement updates, chunked into `mutateEntities({updates})`.
   *
   * Each `built` must be a COMPLETE entity — attributes and payload — because
   * updateEntity replaces, it does not merge. entities.mjs refuses to build one
   * without the project attribute, which is the failure this would otherwise
   * cause: the entity stays on chain and silently leaves every scoped query.
   */
  async function updateMany(items, { chunk = DEFAULT_CHUNK } = {}) {
    const txHashes = [];
    const updated = [];
    for (let i = 0; i < items.length; i += chunk) {
      const slice = items.slice(i, i + chunk);
      const res = await wallet.mutateEntities({
        updates: slice.map((it) => ({ entityKey: it.entityKey, ...encode(it.built) })),
      });
      const keys = res.updatedEntities ?? [];
      if (keys.length !== slice.length) {
        throw new Error(`mutateEntities updated ${keys.length} of ${slice.length} entities (tx ${res.txHash})`);
      }
      txHashes.push(res.txHash);
      updated.push(...keys);
      log(`  arkiv update chunk: ${keys.length} entities · tx ${res.txHash}`);
    }
    return { updated, txHashes };
  }

  /**
   * Prove a write landed the way a consumer will see it: the same
   * `.createdBy(writer)` scoped query the API and the gate run, not getEntity.
   * getEntity has NO creator filter, so it would pass even for an entity written
   * from the wrong wallet — exactly the failure this check exists to catch.
   */
  async function readBackScoped({ entityType, fingerprint, limit = 1 }) {
    const where = [eq('project', project), eq('entityType', entityType)];
    if (fingerprint) where.push(eq('fingerprint', fingerprint));
    const res = await pub
      .buildQuery()
      .where(where)
      .createdBy(account.address)
      .withAttributes(true)
      .withMetadata(true)
      .withPayload(true)
      .limit(limit)
      .fetch();
    return res.entities;
  }

  /**
   * Every page of a scoped query. `fetch()` returns ONE cursor page, so anything
   * that verifies a whole seed has to walk the cursor or it silently checks the
   * first page and calls it complete.
   *
   * Three things about 0.7.0 pagination, all measured, all easy to get wrong:
   *
   *  1. `hasNextPage` is a **METHOD**, not a property. `while (result.hasNextPage)`
   *     tests a function object and is ALWAYS true, so the loop runs until it
   *     throws. It must be `result.hasNextPage()`.
   *  2. `next()` **mutates the QueryResult in place and returns `undefined`**.
   *     `result = await result.next()` therefore sets `result` to undefined and the
   *     next line throws on `.entities`. Call it for effect, then re-read
   *     `result.entities`.
   *  3. `.limit()` is not optional. Without it `_limit` is undefined and `next()`
   *     throws `NoCursorOrLimitError`, so a builder that looks paginable is not.
   */
  async function readAllScoped({ entityType, extra = [], pageSize = 100, maxPages = 50 }) {
    const builder = pub
      .buildQuery()
      .where([eq('project', project), eq('entityType', entityType), ...extra])
      .createdBy(account.address)
      .withAttributes(true)
      .withMetadata(true)
      .withPayload(true)
      .limit(pageSize);
    const result = await builder.fetch();
    const entities = [...result.entities];
    let pages = 1;
    while (result.hasNextPage() && pages < maxPages) {
      await result.next(); // mutates `result`; returns undefined
      entities.push(...result.entities);
      pages += 1;
    }
    return { entities, pages, truncated: result.hasNextPage() };
  }

  /** Poll the scoped query until the write is visible. ~80 ms in practice. */
  async function waitForIndexed(args, { timeoutMs = 15000, intervalMs = 200 } = {}) {
    const t0 = Date.now();
    for (;;) {
      try {
        const entities = await readBackScoped(args);
        if (entities.length) return { ms: Date.now() - t0, entities };
      } catch {
        /* not indexed yet */
      }
      if (Date.now() - t0 > timeoutMs) return { ms: null, entities: [] };
      await sleep(intervalMs);
    }
  }

  /** Count, scoped and creator-filtered. Used by the seed's own final tally. */
  async function count(entityType, extra = []) {
    return pub
      .buildQuery()
      .where([eq('project', project), eq('entityType', entityType), ...extra])
      .createdBy(account.address)
      .count();
  }

  return {
    address: account.address,
    project,
    rpcUrl,
    chainId: BRAGA_CHAIN_ID,
    publicClient: pub,
    walletClient: wallet,
    health,
    create,
    update,
    createMany,
    updateMany,
    readBackScoped,
    readAllScoped,
    waitForIndexed,
    count,
  };
}
