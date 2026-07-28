// The read client. Read-only — there is no wallet in this process.
//
// Only the worker's wallet writes verdicts, and the two never share a process: an
// API that could write is an API whose compromise rewrites the registry. There is
// deliberately no private key here and no createWalletClient import; do not add one.
//
// SDK 0.7.0 specifics, measured (AGENTS.md §7, probes/arkiv-write-read.mjs):
//   · 0.7.0 no longer re-exports viem → `http` comes from 'viem' directly.
//   · `orderBy` is accepted silently and does nothing. Sort client-side, always.
//   · `.createdBy(WRITER)` on every consumer read. Never `ownedBy` — ownership is
//     transferable via changeOwnership, so ownedBy is attacker-influenceable and
//     using it is a silent authorisation bypass.
//   · One fetch() returns one cursor page. Anything that lists must paginate.

import { createPublicClient } from '@arkiv-network/sdk';
import { braga } from '@arkiv-network/sdk/chains';
import { eq, or } from '@arkiv-network/sdk/query';
import { http } from 'viem';
import { parseVerdictHead, unknownHead, isFingerprint, STATES, GATE_BUDGET } from '@surex/core';
import { withLinks } from './links.mjs';

export const DEFAULT_RPC = 'https://braga.hoodi.arkiv.network/rpc';
export const BRAGA_CHAIN_ID = 60138453102;

/**
 * The writer whose entities are the only ones this API will ever return.
 *
 * Load-bearing security, not tidiness: Braga is a shared public testnet with no
 * uniqueness constraint on our attributes, so without this filter anyone can write
 * a colliding fingerprint under `project=surex-*` with `state=clean` and the gate
 * reads their verdict instead of ours.
 */
export const DEFAULT_WRITER_ADDRESS = '0xBD33E1855F68Ce2DF1979377f3bc9fCaCd0015e6';

/** Scope attribute. Must match whatever the worker writes — keep them in sync. */
export const DEFAULT_PROJECT = 'surex-lisbon';

/** Hard cap on pages walked by a listing query, so one bad filter cannot hang a request. */
const MAX_PAGES = 25;
/**
 * Page size for any listing query. Must be set explicitly: `QueryResult` computes
 * `_endOfIteration = !limit || entities.length < limit`, so a query with no limit
 * reports itself finished after one page and `next()` throws `NoCursorOrLimitError`.
 */
const PAGE_SIZE = 100;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * How many heads a single-fingerprint read looks at before choosing. One live head
 * per fingerprint is the worker's promise, not the chain's guarantee, so a `.limit(1)`
 * query would make a broken promise unobservable and serve a stale verdict.
 */
const HEAD_FANOUT = 25;

/**
 * When two heads exist for one fingerprint, which one is current: newest by
 * `lastModifiedAtBlock`, and on a tie the more restrictive state wins. Never prefer
 * the more permissive one — a registry that rounds a flag down to a pass in a tie
 * has the failure mode that matters pointing the wrong way.
 */
const STATE_RESTRICTIVENESS = { flagged: 0, disputed: 1, stale: 2, unreviewable: 3, unknown: 4, clean: 5 };

/**
 * Many head entities → one head per fingerprint, the current one. Every listing
 * route needs it: mapping each row straight to a head shows a fingerprint with two
 * live heads twice, and the two rows can carry different states.
 */
export function dedupeHeads(entities) {
  const grouped = new Map();
  for (const entity of entities ?? []) {
    const fp = (entity?.attributes ?? []).find((a) => a.key === 'fingerprint')?.value;
    if (!fp) continue;
    if (!grouped.has(fp)) grouped.set(fp, []);
    grouped.get(fp).push(entity);
  }
  const heads = [];
  for (const group of grouped.values()) {
    const head = entityToHead(newestHead(group));
    if (head) heads.push(head);
  }
  return heads;
}

/**
 * Newest by block, for entity types that carry no `state` to break a tie with.
 * `orderBy` is a documented no-op on 0.7.0, so every "the current one" question
 * has to be answered here rather than by the query.
 */
export function newestBlock(entities) {
  let best = null;
  let bestBlock = -1;
  for (const entity of entities ?? []) {
    if (!entity) continue;
    const block = Number(entity.lastModifiedAtBlock ?? entity.createdAtBlock ?? 0);
    if (block >= bestBlock) {
      best = entity;
      bestBlock = block;
    }
  }
  return best;
}

export function newestHead(entities) {
  let best = null;
  let bestBlock = -1;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const entity of entities ?? []) {
    if (!entity) continue;
    const block = Number(entity.lastModifiedAtBlock ?? entity.createdAtBlock ?? 0);
    const state = (entity.attributes ?? []).find((a) => a.key === 'state')?.value;
    const rank = STATE_RESTRICTIVENESS[state] ?? 4;
    if (block > bestBlock || (block === bestBlock && rank < bestRank)) {
      best = entity;
      bestBlock = block;
      bestRank = rank;
    }
  }
  return best;
}

function attrsToObject(entity) {
  const out = {};
  for (const a of entity?.attributes ?? []) out[a.key] = a.value;
  return out;
}

function payloadToObject(entity) {
  if (!entity?.payload) return {};
  try {
    const body = entity.toJson?.();
    return body && typeof body === 'object' ? body : {};
  } catch {
    // A payload that is not JSON is a worker bug, not a reason to 500 the hot path
    // — the annotations alone are enough to decide.
    return {};
  }
}

/** `{id,…}` (tech spec) or `{blobId,…}` (contract) → always the contract shape. */
function normaliseEvidence(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const blobId = raw.blobId ?? raw.id ?? null;
  if (!blobId) return undefined;
  const out = { blobId };
  if (raw.suiObjectId) out.suiObjectId = raw.suiObjectId;
  const register = raw.registerTx ?? raw.registerTxDigest;
  const certify = raw.certifyTx ?? raw.certifyTxDigest;
  if (register) out.registerTx = register;
  if (certify) out.certifyTx = certify;
  if (raw.encodingType) out.encodingType = raw.encodingType;
  if (raw.contentSha256) out.contentSha256 = raw.contentSha256;
  return out;
}

/**
 * A verdictHead entity → the frozen head shape. Everything the gate needs is an
 * annotation by design (tech spec §4.1), so annotations are read first and the
 * payload only fills display-only extras. Ends in parseVerdictHead so a malformed
 * row degrades to unknown rather than to clean.
 */
export function entityToHead(entity) {
  const a = attrsToObject(entity);
  const p = payloadToObject(entity);

  const raw = {
    fingerprint: a.fingerprint,
    state: a.state,
    severity: a.severity,
    tier: a.tier,
    reason: a.reason && a.reason !== 'null' ? a.reason : undefined,
    name: a.name ?? p.name,
    enforceAfter: a.enforceAfter !== undefined ? Number(a.enforceAfter) : undefined,
    reviewedCommit: p.reviewedCommit,
    reviewedAt: p.reviewedAt ?? p.analyzedAt,
    modelId: p.modelId,
    promptVersion: p.promptVersion,
    integrity: p.integrity,
    capabilities: p.capabilities,
    topFinding: p.topFinding,
    concern: p.concern,
    assessment: p.assessment,
    findingCount: p.findingCount,
    disputeSummary: p.disputeSummary,
    evidence: normaliseEvidence(p.evidence ?? p.blob) ??
      (p.evidenceBlobId ? { blobId: p.evidenceBlobId } : undefined),
    arkivEntityKey: entity?.key ? String(entity.key) : undefined,
    updatedAt: p.updatedAt,
  };

  const head = parseVerdictHead(raw);
  if (!head) return null;
  // An unrecognised state must not pass through as if it were meaningful — the
  // gate treats unknown states as warn, and so do we.
  if (!STATES.includes(head.state)) head.state = 'unknown';
  return head;
}

function recordFrom(entity, kind) {
  const a = attrsToObject(entity);
  const p = payloadToObject(entity);
  return {
    entityType: kind,
    key: entity?.key ? String(entity.key) : null,
    createdAtBlock: entity?.createdAtBlock !== undefined ? Number(entity.createdAtBlock) : undefined,
    expiresAtBlock: entity?.expiresAtBlock !== undefined ? Number(entity.expiresAtBlock) : undefined,
    ...a,
    ...p,
    // Whichever shape the worker wrote, expose the contract one.
    ...(normaliseEvidence(p.blob ?? p.evidence) ? { evidence: normaliseEvidence(p.blob ?? p.evidence) } : {}),
  };
}

/**
 * Read the whole result set, page by page. Three sharp edges in 0.7.0's
 * `QueryResult`:
 *
 *   1. `hasNextPage` is a method, not a getter. `while (result.hasNextPage)` reads
 *      a function reference — always truthy — and loops forever.
 *   2. `next()` mutates the result in place and returns `undefined`. The natural
 *      `result = await result.next()` throws on the following line.
 *   3. Pagination requires an explicit `.limit()`. Without one the result declares
 *      itself finished, and calling `next()` anyway throws NoCursorOrLimitError.
 *
 * Capped, so a pathological filter degrades to an answer flagged `truncated`
 * rather than to a hung request.
 */
async function fetchAllPages(builder, { maxPages = MAX_PAGES, pageSize = PAGE_SIZE } = {}) {
  const result = await builder.limit(pageSize).fetch();
  const entities = [...result.entities];
  let pages = 1;
  while (result.hasNextPage() && pages < maxPages) {
    await result.next(); // mutates `result`; returns undefined
    entities.push(...result.entities);
    pages += 1;
  }
  return { entities, pages, truncated: result.hasNextPage() };
}

export function createArkivStore(options = {}) {
  const env = options.env ?? process.env;
  const rpcUrl = options.rpcUrl ?? env.ARKIV_RPC_URL ?? DEFAULT_RPC;
  const project = options.project ?? env.SUREX_ARKIV_PROJECT ?? DEFAULT_PROJECT;
  const writerAddress = options.writerAddress ?? env.SUREX_WRITER_ADDRESS ?? DEFAULT_WRITER_ADDRESS;
  // Default to the gate's own hot-path network budget, not something longer: the
  // gate gives up at GATE_BUDGET.networkTimeoutMs and fails open, so anything above
  // that is work nobody is still waiting for. Braga reads measure ~100–180 ms.
  const timeoutMs = Number(options.timeoutMs ?? env.SUREX_ARKIV_TIMEOUT_MS ?? GATE_BUDGET.networkTimeoutMs);

  // Fail closed at construction. An API that starts with no writer filter would
  // happily serve an attacker's verdict, so there is no "unfiltered" mode.
  if (!ADDRESS_RE.test(String(writerAddress))) {
    throw new Error(
      `SUREX_WRITER_ADDRESS is not a 20-byte address (${writerAddress}). Every consumer read must be ` +
        'filtered by .createdBy(writer); refusing to start without one.',
    );
  }

  const client =
    options.client ??
    createPublicClient({
      chain: braga,
      /**
       * `cache: 'no-store'` on the JSON-RPC fetch itself. A no-op under undici, but
       * the moment this store is constructed inside a Next.js server component the
       * global `fetch` becomes Next's, which caches POST-less requests — and a read
       * of a mutable chain pointer must never be answered from a cache the caller
       * cannot see.
       */
      transport: http(rpcUrl, {
        timeout: timeoutMs,
        retryCount: 1,
        fetchOptions: { cache: 'no-store' },
      }),
    });

  const scope = (extra = []) => [eq('project', project), ...extra];

  const scoped = (predicates, { payload = true, limit } = {}) => {
    let q = client
      .buildQuery()
      .where(scope(predicates))
      .createdBy(writerAddress) // Never ownedBy — see the header of this file.
      .withAttributes(true)
      .withMetadata(true);
    if (payload) q = q.withPayload(true);
    if (limit) q = q.limit(limit);
    return q;
  };

  /**
   * The hot path. One query, one page — and then the same choice the batch makes,
   * through `newestHead`. Never `.limit(1)` + `entities[0]`: that is not "the head"
   * but "whichever head the node returned first", and `/r/<fp>` and the registry
   * list then disagree about one entry at the same moment.
   */
  async function getVerdictHead(fp) {
    if (!isFingerprint(fp)) return null;
    const res = await scoped(
      [eq('entityType', 'verdictHead'), eq('fingerprint', fp)],
      { limit: HEAD_FANOUT },
    ).fetch();
    const winner = newestHead(res.entities);
    return winner ? entityToHead(winner) : null;
  }

  /**
   * The SessionStart prefetch. One round trip for a whole config — the fingerprints
   * are OR-ed into a single predicate rather than looped. (`or()` accepts both an
   * array and varargs on 0.7.0; the array form is used here.)
   */
  async function getVerdictHeads(fps) {
    const valid = fps.filter(isFingerprint);
    if (!valid.length) return new Map();
    const predicate =
      valid.length === 1 ? eq('fingerprint', valid[0]) : or(valid.map((fp) => eq('fingerprint', fp)));
    const { entities } = await fetchAllPages(
      scoped([eq('entityType', 'verdictHead'), predicate]),
    );
    // `newestHead` decides, the same function the single-fingerprint read uses, so
    // the batch and `/r/<fp>` cannot answer differently for one entry.
    const byFp = new Map();
    for (const head of dedupeHeads(entities)) byFp.set(head.fingerprint, head);
    return byFp;
  }

  /** Entry + version history + review history. Sorted here, because orderBy is a no-op. */
  async function getEntry(fp) {
    if (!isFingerprint(fp)) return null;
    const [entryRes, sourceRes, reviewRes, head] = await Promise.all([
      // Not `.limit(1)`: the submit pipeline creates a registryEntry on every run
      // and never updates one, so a resubmitted package has several and only the
      // newest describes the current entry.
      scoped([eq('entityType', 'registryEntry'), eq('fingerprint', fp)], { limit: HEAD_FANOUT }).fetch(),
      fetchAllPages(scoped([eq('entityType', 'source'), eq('fingerprint', fp)])),
      fetchAllPages(scoped([eq('entityType', 'review'), eq('fingerprint', fp)])),
      getVerdictHead(fp),
    ]);

    const newestEntry = newestBlock(entryRes.entities);
    const entry = newestEntry ? recordFrom(newestEntry, 'registryEntry') : null;
    if (!entry && !head && !sourceRes.entities.length) return null;

    const sources = sourceRes.entities
      .map((e) => recordFrom(e, 'source'))
      .sort((a, b) => Number(b.fetchedAt ?? 0) - Number(a.fetchedAt ?? 0));
    const reviews = reviewRes.entities
      .map((e) => recordFrom(e, 'review'))
      .sort((a, b) => Number(b.analyzedAt ?? 0) - Number(a.analyzedAt ?? 0));

    return {
      fingerprint: fp,
      entry: entry ? withLinks(entry, env) : null,
      head: head ?? unknownHead(fp),
      sources: sources.map((s) => withLinks(s, env)),
      reviews: reviews.map((r) => withLinks(r, env)),
      truncated: sourceRes.truncated || reviewRes.truncated || undefined,
    };
  }

  /**
   * A direct key read. `getEntity` has no creator filter, so the provenance check
   * that `.createdBy` does for queries has to be done by hand here — otherwise
   * /v1/source/<key> is a hole straight through the writer filter: anyone could
   * write an entity, hand us its key, and have the API serve it as ours.
   */
  async function getByKey(key, expectedType) {
    if (!key || typeof key !== 'string') return null;
    let entity;
    try {
      entity = await client.getEntity(key);
    } catch {
      return null;
    }
    if (!entity) return null;
    if (String(entity.creator ?? '').toLowerCase() !== String(writerAddress).toLowerCase()) return null;
    const a = attrsToObject(entity);
    if (a.project !== project) return null;
    if (expectedType && a.entityType !== expectedType) return null;
    return withLinks(recordFrom(entity, expectedType ?? a.entityType), env);
  }

  const getSource = (key) => getByKey(key, 'source');
  const getReview = (key) => getByKey(key, 'review');

  /**
   * The public feed. Both blocking states, because an org-level gateway mirroring
   * "the flags" wants everything that stops a call — and a dispute does not
   * unblock anything (tech spec §9).
   */
  async function listFlagged({ limit = 100 } = {}) {
    const { entities, truncated } = await fetchAllPages(
      scoped([eq('entityType', 'verdictHead'), or([eq('state', 'flagged'), eq('state', 'disputed')])]),
    );
    const heads = dedupeHeads(entities).sort(
      (a, b) =>
        Number(b.severity ?? 0) - Number(a.severity ?? 0) ||
        String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')),
    );
    return { heads: heads.slice(0, limit), total: heads.length, truncated: truncated || undefined };
  }

  /**
   * The whole registry, every state — sorted so the states that matter are at the
   * top and `unknown`, which is most of a freshly seeded registry, is last.
   */
  async function listRegistry({ limit = 200, state = null } = {}) {
    const predicates = [eq('entityType', 'verdictHead')];
    if (state) predicates.push(eq('state', state));
    const { entities, truncated } = await fetchAllPages(scoped(predicates));

    const RANK = { flagged: 0, disputed: 1, stale: 2, unreviewable: 3, clean: 4, unknown: 5 };
    const heads = dedupeHeads(entities)
      .sort(
        (a, b) =>
          (RANK[a.state] ?? 9) - (RANK[b.state] ?? 9) ||
          Number(b.severity ?? 0) - Number(a.severity ?? 0) ||
          // Within a state, most recently added first, not alphabetical.
          String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')) ||
          String(a.name ?? a.fingerprint).localeCompare(String(b.name ?? b.fingerprint)),
      );

    const byState = {};
    for (const h of heads) byState[h.state] = (byState[h.state] ?? 0) + 1;
    return {
      heads: heads.slice(0, limit),
      total: heads.length,
      byState,
      truncated: truncated || undefined,
    };
  }

  /**
   * Registry hit rate first (failure-modes §3.1). Counts come from the chain via
   * the query builder's own count(); the hit rate is passed in by the caller
   * because it is observed traffic, not chain state.
   */
  async function stats() {
    const countFor = (predicates) =>
      client.buildQuery().where(scope(predicates)).createdBy(writerAddress).count();

    // `unknown` is counted too: leaving it out lets a consumer compute
    // "reviewed = entries - unreviewable" and publish 41 reviewed when one server
    // was reviewed. A number a consumer needs and cannot get is one they guess.
    const states = ['clean', 'flagged', 'disputed', 'unreviewable', 'stale', 'unknown'];
    const [totalHeads, totalEntries, ...perState] = await Promise.all([
      countFor([eq('entityType', 'verdictHead')]),
      countFor([eq('entityType', 'registryEntry')]),
      ...states.map((s) => countFor([eq('entityType', 'verdictHead'), eq('state', s)])),
    ]);

    const byState = {};
    states.forEach((s, i) => {
      byState[s] = Number(perState[i]);
    });

    return {
      source: 'arkiv',
      chainId: BRAGA_CHAIN_ID,
      project,
      writerAddress,
      entries: Number(totalEntries),
      verdictHeads: Number(totalHeads),
      byState,
    };
  }

  /** For /healthz and the boot log. Cheap; also proves the RPC is reachable. */
  async function health() {
    const t0 = Date.now();
    const chainId = await client.getChainId();
    return { ok: chainId === BRAGA_CHAIN_ID, chainId, rpcUrl, ms: Date.now() - t0 };
  }

  return {
    mode: 'live',
    illustrative: false,
    project,
    writerAddress,
    rpcUrl,
    chainId: BRAGA_CHAIN_ID,
    client,
    getVerdictHead,
    getVerdictHeads,
    getEntry,
    getSource,
    getReview,
    listFlagged,
    listRegistry,
    stats,
    health,
  };
}
