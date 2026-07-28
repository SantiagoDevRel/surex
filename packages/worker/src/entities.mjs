// The five Arkiv entities, built exactly once, here.
//
// Shapes are tech spec §4.1, and the reader on the other side is
// apps/api/src/arkiv.mjs — every annotation below is one that file reads or a §4.2
// query filters on. An annotation nobody queries is cost, so nothing is speculative.
//
// Three invariants the SDK will not enforce for you:
//
//  1. Every entity carries the project attribute. `updateEntity` is a full
//     replacement, so dropping it on a rewrite makes the entity vanish from every
//     scoped query while still existing on chain — measured, 35 ms to disappear.
//     buildUpdate() refuses to produce an update without it.
//  2. Numeric attribute values must be integers or the SDK throws
//     InvalidAttributeError. Timestamps are epoch milliseconds (verified to
//     round-trip exactly on Braga, 1784950249894 in and out) which also matches
//     the /v1 contract's `enforceAfter`.
//  3. `expiresIn` is seconds and must be a positive even integer.

import { readFileSync } from 'node:fs';

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

/**
 * The fingerprints of servers **we wrote ourselves**.
 *
 * HISTORY, because the shape of this file only makes sense with it: this list used
 * to be the gate on every public accusation — nothing outside it could be published
 * as `flagged` or `disputed`. That rule was narrowed on 2026-07-26 (owner's call):
 * it stopped the harm it was written for and also stopped the product, because it
 * meant every review of a real third-party server published as "we reached no
 * conclusion" when a conclusion had been reached. What gates an accusation now is
 * PROVENANCE — see `buildVerdictHead`.
 *
 * The list is still read, and still enforced wherever a caller asks for it via
 * `requireSelfAuthored`. `scripts/review-and-publish.mjs` does, because a fixture
 * publisher that reached outside the fixture directory would be a bug.
 *
 * Two properties, both load-bearing. The check lives at the write boundary, not in
 * a publishing script, because the worker is the only process with a wallet and a
 * new script would otherwise skip it. And it matches on fingerprints, not names:
 * a name is a label the caller chooses (`totally-not-a-fixture-thirdparty` matches
 * `/fixture/`), a fingerprint is derived from the configuration being judged.
 */
const SELF_AUTHORED_FILE = 'self-authored.json';

let selfAuthoredCache = null;

/** Where the allowlist lives: `packages/worker/state/self-authored.json`. */
export function selfAuthoredPath() {
  return new URL(`../state/${SELF_AUTHORED_FILE}`, import.meta.url);
}

/**
 * Load the allowlist. A missing file means an empty allowlist — nothing may be
 * flagged. Fail closed: a lost file must cost us our own fixtures, not let
 * accusations through.
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
 * Do not add a `recordSelfAuthored` that allowlists a fingerprint because the
 * submitted repo's owner is one of ours. `github.com/<us>/x` is not a namespace
 * only we can publish under: GitHub serves any commit in a repository's fork
 * network from the upstream namespace, so anyone who can push to a fork of one of
 * our public repos gets a sha that `fetchRepoAtCommit` resolves under our owner —
 * reproduced with `codeload.github.com/octocat/Spoon-Knife/tar.gz/<fork-only-sha>`
 * → exit 0. The attacker then chooses the bytes, the `package.json` name the
 * fingerprint derives from, and therefore which fingerprint gets allowlisted, which
 * is exactly the published third-party accusation §4 exists to prevent. A guard
 * consulting state the same request just wrote is not a second opinion.
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
 * So the allowlist stays an artefact a human curates, off the request path
 * (`scripts/allow-self-authored.mjs`), and nothing derives authorship from a
 * submission.
 *
 * THE FORK PROBLEM DID NOT GO AWAY WHEN THE ALLOWLIST STOPPED GATING — it got
 * bigger. While only our own fingerprints could be flagged, a forged commit could
 * at worst mislabel one of our entries. Now that any review publishes, the same
 * forgery decides WHOSE code gets accused: submit `<us>/<repo>` at a sha that
 * exists only in a fork, put any `package.json` name in it, and the fingerprint
 * that gets flagged is the one the submitter chose. Verifying the commit is
 * reachable from a branch of the named repository is now load-bearing and is NOT
 * built. The submit form resolves commits from the repository's own releases,
 * which covers the web path; the `--commit` flag does not go through it.
 */

/** The states that make a public accusation about a named piece of software. */
export const ACCUSING_STATES = Object.freeze(['flagged', 'disputed']);

const projectAttr = (project = PROJECT) => ({ key: 'project', value: project });

/**
 * Assert an integer rather than truncating one. Not `Math.trunc(value)`: severity
 * 1.5 would land on chain as 1, a band below what the caller meant, and the gate's
 * block threshold reads that number.
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
 *
 * `contentSha256` is mandatory — it is the check binding the bytes an aggregator
 * serves to the Arkiv record, and the only one that runs on node's crypto alone.
 * `nShards` is mandatory because blob IDs are deterministic over content and
 * network configuration.
 *
 * A whitelist, not a spread, so an invented field cannot reach the chain. The cost
 * is that a new pointer field is silently dropped until it is named here.
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
  // certified blob gave back — sound, but a weaker statement, so it travels with
  // the pointer rather than being flattened into the first.
  if (pointer.digestFrom) out.digestFrom = pointer.digestFrom;

  // Custody. 'wallet' = ours, so `suiObjectId`, `registerTx` and `certifyTx` are
  // ours to stand behind. 'publisher' = an HTTP publisher's wallet, so there is no
  // register digest, the Sui object is theirs, and `certifyTx` is a certification
  // they pointed at rather than one we sent. Absent on records written before
  // 2026-07-25: read absence as "not stated", never as "ours".
  if (pointer.registeredBy) out.registeredBy = pointer.registeredBy;
  if (pointer.publisher) out.publisher = pointer.publisher;
  // 'alreadyCertified' explains why a publisher-written record has no object id,
  // size or encoding type: the bytes were already stored.
  if (pointer.publisherOutcome) out.publisherOutcome = pointer.publisherOutcome;
  // `!== undefined`, not truthiness: `false` means the read-back was skipped, which
  // must stay distinguishable from "field not applicable".
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

/** SourceRecord — one per version. The code. Immutable. */
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

/** ReviewRecord — one per review run. The verdict. Immutable. N reviews : 1 source. */
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
 * VerdictHead — the mutable pointer the gate reads. One live per fingerprint.
 *
 * `clean` is reachable only from a real review; a seeded entry gets `unknown` and a
 * licence-ineligible one `unreviewable` + `reason: 'licence'`. An entry whose code
 * we have never read must not become the reason someone installs it.
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
  /**
   * OPTIONAL, and off by default since 2026-07-26.
   *
   * Pass `isSelfAuthored` (or any predicate) to re-impose the old rule that only
   * servers SureX wrote may be published as flagged. `scripts/review-and-publish.mjs`
   * passes it, because that script publishes our own fixtures and a fixture run
   * that reached outside the fixture directory would be a bug worth stopping.
   */
  requireSelfAuthored = null,
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

  // The two gates on a public accusation, both here rather than in a calling
  // script: this module is the one the wallet goes through, so it cannot be
  // bypassed by adding a script.
  if (ACCUSING_STATES.includes(state)) {
    /**
     * THE SELF-AUTHORED ALLOWLIST NO LONGER GATES THIS. Owner's decision,
     * 2026-07-26, and it is a deliberate narrowing of the rule rather than a
     * removal of it.
     *
     * The rule was "only servers SureX wrote may be flagged publicly", enforced by
     * a fingerprint allowlist. It stopped the harm it was written for and also
     * stopped the product: a registry that reads public source, reaches a
     * conclusion, and then publishes nothing about it is not reviewing anything a
     * reader can use. Every third-party review came back held, so the honest
     * answer for every real MCP server on the site was a state that reads as "we
     * could not tell".
     *
     * What still gates an accusation is PROVENANCE, immediately below, and it is
     * not a formality: a flag without the model, the prompt version and the exact
     * bytes it read cannot be answered by the person it accuses, and that is the
     * failure this boundary exists to prevent. Together with the 72-hour dispute
     * window and the whole finding travelling with file and line, that is the
     * shape of a claim somebody can argue with.
     *
     * WHAT THIS MAKES LOAD-BEARING, and it was not before: **the commit must
     * really belong to the repository named.** GitHub serves every commit in a
     * fork network from the upstream namespace, so `codeload …/<us>/<repo>/<sha>`
     * succeeds for a sha that lives only in somebody's fork — reproduced against
     * `octocat/Spoon-Knife`. While nothing third-party could be flagged, that only
     * risked mislabelling our own entry. Now it decides whose code gets accused,
     * so verifying the commit is reachable from a branch of the named repository
     * is the next thing this path needs. It is NOT done yet — say so rather than
     * assume the submit form's release picker covers it, because the `--commit`
     * flag bypasses that picker entirely.
     */
    if (typeof requireSelfAuthored === 'function' && !requireSelfAuthored(fingerprint)) {
      throw new Error(
        `refusing to publish state=${state} for ${fingerprint} (${name ?? 'unnamed'}): the caller supplied a ` +
          'self-authorship predicate and it said no.',
      );
    }
    // The copy law requires every verdict to state what was reviewed, when, and by
    // which model and prompt. A flag with no provenance is unanswerable by the
    // person it accuses, so it is refused rather than written.
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
      // Annotation as well as payload field — the gate renders it in a warn line.
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
 * The read → merge → write half of an update. `updateEntity` replaces everything,
 * so this refuses to emit an update whose attribute set has lost the project scope.
 */
export function buildUpdate({ entityKey, attributes, payload, contentType = 'application/json', expiresIn }) {
  if (!entityKey) throw new Error('buildUpdate needs an entityKey');
  const merged = attrs(attributes);
  return { entityKey, attributes: merged, payload, contentType, expiresIn: evenSeconds(expiresIn) };
}
