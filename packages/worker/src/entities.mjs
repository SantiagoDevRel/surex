// The five Arkiv entities, built exactly once, here.
//
// Shapes are tech spec §4.1, and the reader on the other side is
// apps/api/src/arkiv.mjs — every annotation below is one that file actually
// reads, or one a query in §4.2 filters on. Nothing is annotated speculatively:
// annotations are the hot path, and an annotation nobody queries is cost.
//
// Three invariants the SDK will not enforce for you:
//
//  1. EVERY entity carries the project attribute. `updateEntity` is a FULL
//     REPLACEMENT, so dropping it on a rewrite makes the entity vanish from every
//     scoped query while still existing on chain — measured, 35 ms to disappear.
//     buildUpdate() refuses to produce an update without it.
//  2. Numeric attribute values must be INTEGERS or the SDK throws
//     InvalidAttributeError. Timestamps are epoch MILLISECONDS (verified to
//     round-trip exactly on Braga, 1784950249894 in and out) which also matches
//     the /v1 contract's `enforceAfter`.
//  3. `expiresIn` is SECONDS and must be a positive EVEN integer.
//
// Copy law: `assertCopy` runs over text THIS WORKER authors. It deliberately does
// NOT run over a third party's own description pulled from the MCP registry — that
// is quoted data, not a SureX claim about a server, and censoring it would both
// misrepresent the source and reject perfectly ordinary servers whose blurb says
// "secrets".

import { readFileSync } from 'node:fs';

import { assertCopy } from '@surex/core';
import { PROJECT, EXPIRES, evenSeconds } from './config.mjs';

export const ENTITY_TYPES = Object.freeze([
  'registryEntry',
  'source',
  'review',
  'verdictHead',
  'dispute',
]);

/** Seeded entries are never `clean`. See buildVerdictHead. */
export const SEED_STATE = 'unknown';

// ---------------------------------------------------------------------------
// who may be publicly flagged — enforced HERE, at the write boundary
// ---------------------------------------------------------------------------

/**
 * The fingerprints of servers **we wrote ourselves**, and the only ones that may
 * ever be published as `flagged` or `disputed`.
 *
 * AGENTS.md §4 forbids publicly flagging a real third-party project on an
 * unaudited model verdict. That rule used to live in the publishing *scripts* —
 * one of them tested the server's NAME against `/fixture|mal-|ambiguous-|honest-/`.
 * Two things are wrong with that, and a code review caught both:
 *
 *   1. **It is not at the write boundary.** Any new script that calls
 *      `buildVerdictHead` — and this session added two — skips the check
 *      entirely. The worker is the only process with a wallet; the policy
 *      belongs where the wallet is.
 *   2. **A name regex is not an identity.** `totally-not-a-fixture-thirdparty`
 *      matches `/fixture/`. A name is a label the caller chooses; a fingerprint
 *      is derived from the configuration being judged.
 *
 * So the allowlist is fingerprints, written by the script that computes them
 * from our own fixture directory, and this file reads it. An entry that is not
 * on the list cannot be flagged, whatever it calls itself.
 */
const SELF_AUTHORED_FILE = 'self-authored.json';

let selfAuthoredCache = null;

/** Where the allowlist lives: `packages/worker/state/self-authored.json`. */
export function selfAuthoredPath() {
  return new URL(`../state/${SELF_AUTHORED_FILE}`, import.meta.url);
}

/**
 * Load the allowlist. A missing file means an EMPTY allowlist — nothing may be
 * flagged — which is the safe direction: the failure mode of a lost file is
 * "we cannot publish our own fixtures", not "we can publish accusations".
 */
export function loadSelfAuthored({ reload = false } = {}) {
  if (selfAuthoredCache && !reload) return selfAuthoredCache;
  let list = [];
  try {
    const text = readFileSync(selfAuthoredPath(), 'utf8');
    const parsed = JSON.parse(text);
    list = Array.isArray(parsed) ? parsed : (parsed?.fingerprints ?? []);
  } catch {
    list = [];
  }
  selfAuthoredCache = new Set(list.map((f) => String(f)));
  return selfAuthoredCache;
}

/** For tests and for the publisher, which regenerates the list before writing. */
export function setSelfAuthored(fingerprints) {
  selfAuthoredCache = new Set([...(fingerprints ?? [])].map((f) => String(f)));
  return selfAuthoredCache;
}

export function isSelfAuthored(fingerprint) {
  return loadSelfAuthored().has(String(fingerprint));
}

/**
 * WHY THERE IS NO `recordSelfAuthored`, and why one was written and then deleted.
 *
 * The gap is real: the allowlist is regenerated from our fixture DIRECTORY, and a
 * submitted repository is never a fixture directory — so `SUREX_SELF_OWNED`, the
 * env that names the GitHub owners whose flags may publish, decided nothing. A
 * self-owned submission could not publish a flag about its own code.
 *
 * The obvious fix was to let the pipeline add the fingerprint when the submitted
 * repo's owner is one of ours, on the argument that `github.com/<us>/x` is a
 * namespace nobody else can publish under, so the owner is a fact rather than a
 * claim. **That argument is false, and a security review reproduced it:**
 *
 *   curl -sSL --fail https://codeload.github.com/octocat/Spoon-Knife/tar.gz/f675b3f7…
 *   → exit 0, and the tree it returns exists only in a FORK.
 *
 * GitHub serves any commit in a repository's fork network from the upstream
 * namespace. Anyone who can push to a fork of one of our public repos — which is
 * anyone — obtains a sha that `fetchRepoAtCommit` resolves under our owner. They
 * choose the bytes, the `package.json` name (which is what the fingerprint is
 * derived from), and therefore which fingerprint gets allowlisted. The result is a
 * published `flagged` verdict, with findings, for a fingerprint the attacker
 * selected: our own real server, or — via the npm path, where the reviewed bytes
 * come from the registry rather than the repo — somebody else's package entirely.
 *
 * That is the exact outcome AGENTS.md §4 exists to prevent, reached *through* the
 * guard written to prevent it. And it collapses the two locks into one: a guard
 * that consults state the same request just wrote is not a second opinion.
 *
 * So the allowlist stays what it was — an artefact a human curates, off the
 * request path. `scripts/allow-self-authored.mjs` adds a fingerprint deliberately,
 * with a note saying why; until an operator runs it, a self-owned flag is WITHHELD,
 * which is the safe direction and an honest published state. Fixing this properly
 * means proving the commit is reachable from a branch of the named repository, and
 * that is a real piece of work rather than a line in the ingest.
 */

/** The states that make a public accusation about a named piece of software. */
export const ACCUSING_STATES = Object.freeze(['flagged', 'disputed']);

const projectAttr = (project = PROJECT) => ({ key: 'project', value: project });

/**
 * Assert an integer rather than truncating one.
 *
 * The tempting version of this is `Math.trunc(value)`, and it is wrong: severity
 * 1.5 would land on chain as 1, quietly one band lower than the caller meant,
 * and the gate's block threshold reads that number. A caller that has a
 * non-integer has a bug, and the bug should surface here rather than as a
 * severity nobody can explain later.
 */
function int(value, name) {
  if (value === undefined || value === null) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n)) {
    throw new Error(`${name} must be an integer, got ${value} (Arkiv rejects non-integer numeric attributes)`);
  }
  return n;
}

/** Drop undefined/null, coerce, and refuse a non-integer number early. */
function attrs(list) {
  const out = [];
  for (const a of list) {
    if (!a) continue;
    const { key, value } = a;
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'number') {
      if (!Number.isInteger(value)) {
        throw new Error(
          `attribute ${key} is ${value}; Arkiv numeric attributes must be integers ` +
            '(scale it, or pass a string and lose numeric comparison)',
        );
      }
      out.push({ key, value });
    } else {
      out.push({ key, value: String(value) });
    }
  }
  const hasProject = out.some((a) => a.key === 'project');
  if (!hasProject) throw new Error('refusing to build an entity with no project attribute');
  const hasType = out.some((a) => a.key === 'entityType');
  if (!hasType) throw new Error('refusing to build an entity with no entityType attribute');
  return out;
}

/**
 * A record body's evidence pointer, as it goes into a payload.
 * `contentSha256` is mandatory: it is the check that binds the bytes an
 * aggregator serves to the Arkiv record, and the only one that runs with nothing
 * but node's crypto. `nShards` is mandatory for the same reason a serial number
 * is — blob IDs are deterministic over content AND network configuration.
 *
 * This is a WHITELIST, not a spread, so a field the writer invents does not
 * silently become part of the on-chain record. The consequence is that a new
 * pointer field is invisible until it is named here — measured on 2026-07-25,
 * when a blob written through the HTTP publisher carried `registeredBy:
 * 'publisher'` all the way to this function and arrived on chain without it,
 * leaving a record that could not say whose wallet had registered its evidence.
 */
export function evidenceOf(pointer) {
  if (!pointer) return undefined;
  if (!pointer.blobId) throw new Error('evidence pointer has no blobId');
  if (!pointer.contentSha256) throw new Error('evidence pointer has no contentSha256 — never omit it');
  if (!pointer.nShards) throw new Error('evidence pointer has no nShards — never omit it');
  const out = {
    blobId: pointer.blobId,
    contentSha256: pointer.contentSha256,
    nShards: pointer.nShards,
    size: pointer.size,
    // 'blob' means its own certified Sui object; 'quilt-patch' means it shares
    // one with the rest of its quilt and has no per-record explorer link.
    addressing: pointer.addressing ?? 'blob',
  };
  if (pointer.suiObjectId) out.suiObjectId = pointer.suiObjectId;
  if (pointer.registerTx) out.registerTx = pointer.registerTx;
  if (pointer.certifyTx) out.certifyTx = pointer.certifyTx;
  if (pointer.encodingType) out.encodingType = pointer.encodingType;
  if (pointer.patchId) out.patchId = pointer.patchId;
  if (pointer.quiltBlobId) out.quiltBlobId = pointer.quiltBlobId;
  if (pointer.epochs) out.epochs = pointer.epochs;
  // 'written' = we hashed the bytes we sent. 'served' = we hashed the bytes a
  // certified blob gave back. The second is sound (a blob ID commits to content)
  // but it is a weaker statement, so it travels with the pointer rather than
  // being flattened into the first.
  if (pointer.digestFrom) out.digestFrom = pointer.digestFrom;

  // ── custody: WHOSE wallet registered this blob ─────────────────────────────
  //
  // 'wallet' means ours — we reserved the space, signed both transactions and
  // paid, so `suiObjectId`, `registerTx` and `certifyTx` above are ours to stand
  // behind. 'publisher' means an HTTP publisher's wallet did all of that, which
  // is how the always-on writer stores anything at all: the SDK's direct-to-node
  // upload cannot complete from a residential uplink (FRICTION-LOG S11). On that
  // path there is no register digest, the Sui object is the publisher's, and a
  // `certifyTx` is the certification the publisher POINTED AT rather than one we
  // sent. Carried here so a reader never has to infer custody from which fields
  // happen to be absent.
  //
  // What is unaffected, and it is the part the gate acts on: a blob ID is derived
  // from the bytes. Fetch the blob, recompute the ID, compare — that check does
  // not care who paid.
  //
  // Absent on records written before 2026-07-25: read absence as "not stated",
  // never as "ours".
  if (pointer.registeredBy) out.registeredBy = pointer.registeredBy;
  if (pointer.publisher) out.publisher = pointer.publisher;
  // 'alreadyCertified' explains, rather than leaves a reader to wonder, why a
  // publisher-written record has no object id, size or encoding type: these bytes
  // were already stored, so the write cost nothing and returned almost nothing.
  if (pointer.publisherOutcome) out.publisherOutcome = pointer.publisherOutcome;
  // Explicitly `!== undefined`: `false` means "we skipped the read-back", which a
  // truthiness guard would erase into the same absence as "field not applicable".
  // A check we did not run must never be indistinguishable from one that did.
  if (pointer.readbackVerified !== undefined) out.readbackVerified = pointer.readbackVerified;
  return out;
}

/** RegistryEntry — identity. One per fingerprint. */
export function buildRegistryEntry({
  fingerprint,
  name,
  tier,
  blob,
  project = PROJECT,
  expiresIn = EXPIRES.registryEntry,
}) {
  return {
    attributes: attrs([
      projectAttr(project),
      { key: 'entityType', value: 'registryEntry' },
      { key: 'fingerprint', value: fingerprint },
      { key: 'name', value: name },
      { key: 'tier', value: tier },
    ]),
    payload: { fingerprint, name, tier, blob: evidenceOf(blob) },
    contentType: 'application/json',
    expiresIn: evenSeconds(expiresIn),
  };
}

/** SourceRecord — one per version. The CODE. Immutable. */
export function buildSourceRecord({
  fingerprint,
  versionString,
  fetchedAt = Date.now(),
  licence,
  repo,
  commit,
  normalisedTreeSha256,
  integrity,
  schemaHash,
  blob,
  project = PROJECT,
  expiresIn = EXPIRES.source,
}) {
  return {
    attributes: attrs([
      projectAttr(project),
      { key: 'entityType', value: 'source' },
      { key: 'fingerprint', value: fingerprint },
      { key: 'versionString', value: versionString },
      { key: 'fetchedAt', value: int(fetchedAt, 'fetchedAt') },
      { key: 'licence', value: licence },
    ]),
    payload: {
      blob: evidenceOf(blob),
      repo,
      commit,
      normalisedTreeSha256,
      integrity,
      schemaHash,
      versionString,
      licence,
      fetchedAt: new Date(fetchedAt).toISOString(),
    },
    contentType: 'application/json',
    expiresIn: evenSeconds(expiresIn),
  };
}

/** ReviewRecord — one per review run. The VERDICT. Immutable. N reviews : 1 source. */
export function buildReviewRecord({
  fingerprint,
  sourceKey,
  verdict,
  severity = 0,
  analyzedAt = Date.now(),
  reviewedSourceBlobId,
  supersedes,
  modelId,
  promptVersion,
  blob,
  project = PROJECT,
  expiresIn = EXPIRES.review,
}) {
  if (!['clean', 'flagged', 'unreviewable'].includes(verdict)) {
    throw new Error(`review verdict must be clean|flagged|unreviewable, got ${verdict}`);
  }
  return {
    attributes: attrs([
      projectAttr(project),
      { key: 'entityType', value: 'review' },
      { key: 'fingerprint', value: fingerprint },
      { key: 'sourceKey', value: sourceKey },
      { key: 'verdict', value: verdict },
      { key: 'severity', value: int(severity, 'severity') },
      { key: 'analyzedAt', value: int(analyzedAt, 'analyzedAt') },
    ]),
    payload: {
      blob: evidenceOf(blob),
      reviewedSourceBlobId,
      supersedes,
      modelId,
      promptVersion,
      sourceKey,
      verdict,
      severity: int(severity, 'severity'),
      analyzedAt: new Date(analyzedAt).toISOString(),
    },
    contentType: 'application/json',
    expiresIn: evenSeconds(expiresIn),
  };
}

/**
 * VerdictHead — the mutable pointer the gate reads. ONE live per fingerprint.
 *
 * `clean` is reachable ONLY from a real review. A seeded entry gets `unknown`,
 * and a licence-ineligible one gets `unreviewable` + `reason: 'licence'`. This is
 * the rule that stops the registry from laundering a listing into a legitimacy
 * claim: an entry we have never read the code of must not be the reason someone
 * installs it.
 */
export function buildVerdictHead({
  fingerprint,
  state,
  reason,
  tier,
  severity = 0,
  needsReanalysis = false,
  enforceAfter,
  name,
  latestReviewKey,
  sourceKey,
  reviewedSourceBlobId,
  reviewedCommit,
  reviewedAt,
  modelId,
  promptVersion,
  integrity,
  capabilities,
  topFinding,
  concern,
  assessment,
  findingCount,
  disputeKey,
  disputeSummary,
  evidence,
  seedSource,
  updatedAt = new Date().toISOString(),
  project = PROJECT,
  expiresIn = EXPIRES.verdictHead,
  requireReviewForClean = true,
}) {
  const STATES = ['clean', 'flagged', 'disputed', 'unreviewable', 'stale', 'unknown'];
  if (!STATES.includes(state)) throw new Error(`unknown head state ${state}`);
  if (requireReviewForClean && state === 'clean' && !latestReviewKey) {
    throw new Error(
      'refusing to write state=clean with no latestReviewKey. A seeded entry that ' +
        'inherits an existing backdoor must not gain legitimacy from being listed.',
    );
  }
  if (state === 'unreviewable' && !reason) {
    throw new Error('state=unreviewable needs a reason (licence|source-unavailable|remote-endpoint|no-agreement|withheld)');
  }

  // ── the two gates on a public accusation ─────────────────────────────────
  //
  // Both are HERE and not in the calling script, because this module is the one
  // the wallet goes through. A script can be added; this cannot be bypassed.
  if (ACCUSING_STATES.includes(state)) {
    if (!isSelfAuthored(fingerprint)) {
      throw new Error(
        `refusing to publish state=${state} for ${fingerprint} (${name ?? 'unnamed'}): it is not on the ` +
          'self-authored allowlist. AGENTS.md §4 — the only servers SureX flags publicly are the ones it ' +
          'wrote itself, and the check is on the FINGERPRINT because a name is whatever the caller types.',
      );
    }
    // Provenance is not decoration on an accusation. The copy law requires every
    // verdict to state what was reviewed, when, by which model and prompt — and
    // the live `@surex/mal-*` heads were written without a commit, so the block
    // message rendered "commit —". A flag with no provenance is unanswerable by
    // the person it accuses, so it is refused rather than written.
    const missing = [];
    if (!modelId) missing.push('modelId');
    if (!promptVersion) missing.push('promptVersion');
    if (!reviewedCommit && !integrity && !reviewedSourceBlobId) {
      missing.push('reviewedCommit or integrity or reviewedSourceBlobId — what exactly was read');
    }
    if (missing.length) {
      throw new Error(
        `refusing to publish state=${state} for ${fingerprint} without provenance: missing ${missing.join(', ')}. ` +
          'A finding nobody can trace to specific bytes cannot be answered, and an unanswerable accusation is ' +
          'the thing this registry exists not to make.',
      );
    }
  }

  return {
    attributes: attrs([
      projectAttr(project),
      { key: 'entityType', value: 'verdictHead' },
      { key: 'fingerprint', value: fingerprint },
      { key: 'state', value: state },
      { key: 'reason', value: reason },
      { key: 'tier', value: tier },
      { key: 'severity', value: int(severity, 'severity') },
      { key: 'needsReanalysis', value: needsReanalysis ? 'true' : 'false' },
      { key: 'enforceAfter', value: int(enforceAfter, 'enforceAfter') },
      // `name` is an annotation as well as a payload field: the gate renders it in
      // a warn line, and reading it from the annotation set costs nothing extra.
      { key: 'name', value: name },
    ]),
    payload: {
      latestReviewKey,
      sourceKey,
      reviewedSourceBlobId,
      reviewedCommit,
      reviewedAt,
      modelId,
      promptVersion,
      integrity,
      capabilities,
      topFinding,
      concern,
      assessment,
      findingCount,
      disputeKey,
      disputeSummary,
      seedSource,
      name,
      updatedAt,
      evidence: evidence ? evidenceOf(evidence) : undefined,
    },
    contentType: 'application/json',
    expiresIn: evenSeconds(expiresIn),
  };
}

/** Dispute — lifecycle. Evidence body lives in its own certified blob. */
export function buildDispute({
  fingerprint,
  reviewKey,
  status = 'open',
  contestantType,
  submittedAt = Date.now(),
  blob,
  project = PROJECT,
  expiresIn = EXPIRES.dispute,
}) {
  if (!['open', 'under_review', 'upheld', 'overturned'].includes(status)) {
    throw new Error(`unknown dispute status ${status}`);
  }
  if (!['human', 'agent'].includes(contestantType)) {
    throw new Error(`contestantType must be human|agent, got ${contestantType}`);
  }
  return {
    attributes: attrs([
      projectAttr(project),
      { key: 'entityType', value: 'dispute' },
      { key: 'fingerprint', value: fingerprint },
      { key: 'reviewKey', value: reviewKey },
      { key: 'status', value: status },
      { key: 'contestantType', value: contestantType },
    ]),
    payload: {
      blob: evidenceOf(blob),
      reviewKey,
      status,
      contestantType,
      submittedAt: new Date(submittedAt).toISOString(),
    },
    contentType: 'application/json',
    expiresIn: evenSeconds(expiresIn),
  };
}

/**
 * The read → merge → write half of an update, made explicit.
 * `updateEntity` replaces everything, so this refuses to emit an update whose
 * attribute set has lost the project scope.
 */
export function buildUpdate({ entityKey, attributes, payload, contentType = 'application/json', expiresIn }) {
  if (!entityKey) throw new Error('buildUpdate needs an entityKey');
  const merged = attrs(attributes);
  return { entityKey, attributes: merged, payload, contentType, expiresIn: evenSeconds(expiresIn) };
}

/** Copy law over text the worker itself authored. Never over a quoted description. */
export function assertWorkerCopy(text, where) {
  if (typeof text === 'string' && text.trim()) assertCopy(text, where);
}
