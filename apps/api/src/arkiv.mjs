// The read client. READ ONLY — there is no wallet in this process.
//
// The API cannot write. Only the worker's wallet writes verdicts, and the two
// never share a process: an API that could write is an API whose compromise
// rewrites the registry. There is deliberately no private key here and no
// createWalletClient import; do not add one.
//
// SDK 0.7.0 specifics, measured (AGENTS.md §7, probes/arkiv-write-read.mjs):
//   · 0.7.0 no longer re-exports viem → `http` comes from 'viem' directly.
//   · `orderBy` is accepted silently and does NOTHING. Sort client-side, always.
//   · `.createdBy(WRITER)` on EVERY consumer read. Never `ownedBy` — ownership is
//     transferable via changeOwnership, so ownedBy is attacker-influenceable and
//     using it is a silent authorisation bypass.
//   · One fetch() returns ONE cursor page. Anything that lists must paginate.

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
 * This filter is load-bearing SECURITY, not tidiness. Braga is a shared public
 * testnet with no uniqueness constraint on our attributes: without it, anyone can
 * write a colliding fingerprint under `project=surex-*` with `state=clean` and the
 * gate reads their verdict instead of ours. Proven both ways in
 * probes/arkiv-write-read.mjs — the unfiltered query returns 2, `.createdBy`
 * partitions them cleanly.
 */
export const DEFAULT_WRITER_ADDRESS = '0xBD33E1855F68Ce2DF1979377f3bc9fCaCd0015e6';

/** Scope attribute. Must match whatever the worker writes — keep them in sync. */
export const DEFAULT_PROJECT = 'surex-lisbon';

/** Hard cap on pages walked by a listing query, so one bad filter cannot hang a request. */
const MAX_PAGES = 25;
/**
 * Page size for any listing query. Must be set EXPLICITLY: `QueryResult` computes
 * `_endOfIteration = !limit || entities.length < limit`, so a query with no limit
 * reports itself finished after one page and `next()` throws
 * `NoCursorOrLimitError`. Pagination without a limit does not exist. (A6)
 */
const PAGE_SIZE = 100;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * How many heads a single-fingerprint read will look at before choosing.
 *
 * One live head per fingerprint is the invariant, so in practice this is 1. It is
 * not 1 in the QUERY because the invariant is the worker's promise, not the
 * chain's guarantee, and reading exactly one row makes a broken promise
 * unobservable — which is how the API served a stale verdict while the registry
 * list served the current one.
 */
const HEAD_FANOUT = 25;

/**
 * When two heads exist for one fingerprint, which one is current.
 *
 * Newest wins, by `lastModifiedAtBlock`. On a TIE the more restrictive state wins:
 * the comment beside the batch reader has always said "never prefer the more
 * permissive one" and the code did not do it, so two heads written in the same
 * block could have resolved to `clean` over `flagged` depending on return order.
 * A registry that can round a flag down to a pass in a tie has the failure mode
 * that matters pointing the wrong way.
 */
const STATE_RESTRICTIVENESS = { flagged: 0, disputed: 1, stale: 2, unreviewable: 3, unknown: 4, clean: 5 };

/**
 * Many head entities → one head per fingerprint, the current one.
 *
 * Every listing route needs this and none of them had it: `listRegistry` and
 * `listFlagged` mapped each row straight to a head, so a fingerprint with two live
 * heads appeared TWICE — and since the two rows can carry different states, the
 * registry could show the same server as both `flagged` and `clean`, one above the
 * other, sorted apart by the state rank.
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
    // A record whose payload is not JSON is a worker bug, not a reason to 500 the
    // hot path — the annotations alone are enough to decide.
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
 * A verdictHead entity → the frozen head shape.
 *
 * Everything the gate needs is an annotation by design (tech spec §4.1), so this
 * reads annotations first and only then fills display-only extras from the
 * payload. It ends in parseVerdictHead so a malformed row degrades to something
 * the gate can safely treat as unknown rather than as clean.
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
  // A state we do not recognise must not be passed through as if it were
  // meaningful — the gate treats unknown states as warn, and so do we.
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
 * Read the whole result set, page by page.
 *
 * Three sharp edges in 0.7.0's `QueryResult`, all of which cost us a live failure
 * before this shape was right (FRICTION-LOG A6):
 *
 *   1. `hasNextPage` is a METHOD, not a getter. `while (result.hasNextPage)` reads
 *      a function reference — always truthy — and loops forever.
 *   2. `next()` MUTATES the result in place and returns `undefined`. The natural
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
  // Default to the GATE's own hot-path network budget, not something longer.
  // The gate gives up at GATE_BUDGET.networkTimeoutMs and fails open; an RPC
  // timeout above that means every slow read is work nobody is still waiting for.
  // Measured Braga reads are ~100–180 ms, so this is ~8x headroom.
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
       * `cache: 'no-store'` on the JSON-RPC fetch itself.
       *
       * Today this process runs on Vercel's Node runtime with undici's plain
       * `fetch`, which caches nothing, so this changes no behaviour here. It is
       * still the right default and it is cheap: the moment this store is
       * constructed inside a Next.js server component — the obvious next step for
       * a page that wants to read the registry without a hop through this API —
       * the global `fetch` becomes Next's, which caches POST-less requests and
       * would serve a verdict read from its Data Cache. A read of a mutable chain
       * pointer must never be answered from a cache the caller cannot see.
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
      .createdBy(writerAddress) // NEVER ownedBy — see the header of this file.
      .withAttributes(true)
      .withMetadata(true);
    if (payload) q = q.withPayload(true);
    if (limit) q = q.limit(limit);
    return q;
  };

  /**
   * The hot path. One query, one page — and then the SAME choice the batch makes.
   *
   * This was `.limit(1)` and `entities[0]`, which is not "the head" but "whichever
   * head the node happened to return first". One live fingerprint with two heads —
   * a republish leaves one, and `orderBy` is a documented no-op on 0.7.0 so
   * nothing on the server side is sorting them — served the OLD verdict here and
   * the new one from `getVerdictHeads`, so `/r/<fp>` and the registry list
   * disagreed about the same entry at the same moment.
   *
   * The fix is not a better sort in two places; it is one function both callers
   * use, because two implementations of "which head is current" is what produced
   * the disagreement in the first place.
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
   * The SessionStart prefetch. ONE round trip for a whole config — the fingerprints
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
    // One live head per fingerprint is the invariant; if the worker ever leaves
    // two, `newestHead` decides — the same function the single-fingerprint read
    // uses, so the batch and `/r/<fp>` cannot answer differently for one entry.
    const byFp = new Map();
    for (const head of dedupeHeads(entities)) byFp.set(head.fingerprint, head);
    return byFp;
  }

  /** Entry + version history + review history. Sorted here, because orderBy is a no-op. */
  async function getEntry(fp) {
    if (!isFingerprint(fp)) return null;
    const [entryRes, sourceRes, reviewRes, head] = await Promise.all([
      // Not `.limit(1)` — the same mistake that was just fixed one function below
      // for heads. The submit pipeline CREATES a registryEntry on every run and
      // never updates one, so a resubmitted package has several, and `entities[0]`
      // is whichever the node returned first. The newest is the one that describes
      // the current entry.
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
   * A direct key read. `getEntity` has NO creator filter, so the provenance check
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
   * The whole registry, every state.
   *
   * Added after the web lane found the gap: `/v1/flagged` is the right shape for
   * an org gateway mirroring the flags, but it is the wrong shape for a browse
   * page. Seeded entries are written `unknown` and never `clean`, so a
   * flagged-only feed shows an EMPTY registry the moment seeding is the only
   * thing populating it — which reads as "nothing here" rather than "nothing
   * flagged".
   *
   * Sorted so the states that matter are at the top and `unknown` — which is
   * most of a freshly seeded registry — is last.
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
          // Within a state, MOST RECENTLY ADDED first, not alphabetical.
          //
          // Alphabetical put `@adeu/mcp-server` and `@agentutility/mcp-bestiary` on
          // the first screen and the servers people have actually heard of under
          // "@m", which made a registry of real data read as placeholder data —
          // the first question it drew was "are these placeholders?". Recency is a
          // fact about the registry rather than an editorial ranking, and it puts
          // the newest work where a visitor looks first.
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

    // `unknown` is counted too. Leaving it out is what let a consumer compute
    // "reviewed = entries - unreviewable" and publish 41 reviewed when ONE server
    // had been reviewed. A number a consumer needs and cannot get is a number
    // they will guess.
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
