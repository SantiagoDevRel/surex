// What a review result becomes once it is published — decided in one place, as data.
//
// The write boundary in `entities.mjs` answers "may this be written". This module
// answers the question before it: "given what the model concluded, what is it
// honest to publish".
//
// `planPublication` is total. Every (verdict, reason, ownership) triple maps to a
// head `buildVerdictHead` will accept, and there is no input for which the answer is
// "throw" — a crash after the review record is written leaves the registry with an
// entry and no head, invisible to the listing query, which reads verdictHeads. That
// says less than an honest `unreviewable`.
//
// A flagged review publishes, whoever wrote the server. What keeps the accusation
// answerable is enforced elsewhere and each piece is load-bearing: `buildVerdictHead`
// refuses an accusing state without provenance, the whole finding travels with its
// file and line, and `enforceAfter` holds the block message at unconfirmed for 72
// hours. `withheld` remains the state for a result declined for any other reason.

import { ACCUSING_STATES, isSelfAuthored } from './entities.mjs';

/** A flagged head is contestable for 72 hours before the block message hardens. */
export const DISPUTE_WINDOW_MS = 72 * 3600 * 1000;

/**
 * The finding a reader is shown first, and whole: the contract's shape is
 * `{file, line, category, description, severity}`, and the gate's block message and
 * `/r/<fp>` both render it. Dropping `file`/`line` leaves an accusation a developer
 * cannot locate, so ties break toward the finding that can be located.
 */
export function topFindingOf(findings) {
  const list = (findings ?? []).filter((f) => f && typeof f === 'object');
  if (!list.length) return undefined;
  const locatable = (f) => (typeof f.file === 'string' && f.file ? 1 : 0);
  const best = [...list].sort(
    (a, b) => Number(b.severity ?? 0) - Number(a.severity ?? 0) || locatable(b) - locatable(a),
  )[0];
  if (!best) return undefined;
  const out = { severity: Number(best.severity ?? 0) };
  if (best.category) out.category = String(best.category);
  if (best.file) out.file = String(best.file);
  if (Number.isInteger(best.line)) out.line = best.line;
  if (best.description) out.description = String(best.description);
  return out;
}

/**
 * Why a result was not published as it stood. Carried back so the submitter is told
 * — withholding means the findings are not published and not lost.
 */
const WITHHELD_BECAUSE = Object.freeze({
  thirdParty: 'third-party',
  notAllowlisted: 'not-self-authored',
});

/**
 * One review result → one publishable head.
 *
 * @param {object} args
 * @param {'clean'|'flagged'|'unreviewable'} args.verdict  what the reviewer merged to
 * @param {string|null=} args.reason      the reviewer's reason, when it had one
 * @param {number=} args.severity         the merged severity
 * @param {Array=} args.findings          the merged findings, whole
 * @param {string} args.fingerprint       what the guard checks against
 * @param {boolean=} args.selfOwned       repo is under an owner the operator declared
 *                                        ours (SUREX_SELF_OWNED), never caller-supplied
 * @param {(fp:string)=>boolean=} args.canAccuse  defaults to the same allowlist
 *                                        `buildVerdictHead` reads, so this cannot plan
 *                                        a write the guard will refuse
 * @param {number=} args.now
 * @returns {{state:string, reason:string|undefined, severity:number, findings:Array,
 *            topFinding:object|undefined, enforceAfter:number|undefined,
 *            publishesFindings:boolean, withheld:object|null}}
 */
export function planPublication({
  verdict,
  reason = null,
  severity = 0,
  findings = [],
  concern = null,
  assessment = null,
  statedIntentSummary = null,
  fingerprint,
  selfOwned = false,
  canAccuse = isSelfAuthored,
  now = Date.now(),
}) {
  const merged = Array.isArray(findings) ? findings : [];
  const sev = Number.isFinite(Number(severity)) ? Math.trunc(Number(severity)) : 0;

  if (verdict === 'clean') {
    // The schema refuses a clean verdict with findings, so this carries none and
    // severity is 0 by construction.
    return {
      state: 'clean',
      reason: undefined,
      severity: 0,
      findings: [],
      topFinding: undefined,
      // A clean verdict still says what the server does — the difference between
      // "reviewed, nothing found" and a blank row, and there is no accusation in it.
      concern: 'none',
      assessment,
      statedIntentSummary,
      findingCount: 0,
      enforceAfter: undefined,
      publishesFindings: false,
      withheld: null,
    };
  }

  if (verdict === 'flagged') {
    /**
     * The published severity never outranks the findings it rests on. The model
     * returns a top-level `severity` alongside per-finding severities and the two
     * can disagree — a real record came back at 3 with every one of its seven
     * findings at 2. `decide()` blocks at 3 and warns at 2, so uncapped that record
     * stops a tool call on a number no piece of its own evidence supports, and the
     * maintainer has nothing to answer.
     */
    const evidenced = merged.reduce((max, f) => Math.max(max, Number(f?.severity ?? 0)), 0);
    const published = merged.length ? Math.min(sev, evidenced) : sev;

    return {
      state: 'flagged',
      reason: undefined,
      severity: published,
      findings: merged,
      topFinding: topFindingOf(merged),
      concern,
      assessment,
      statedIntentSummary,
      // `topFinding` is the first of these, not the only one — a surface that
      // captions it "1 of 1" understates every multi-finding review.
      findingCount: merged.length,
      enforceAfter: now + DISPUTE_WINDOW_MS,
      publishesFindings: true,
      withheld: null,
      // Lets a reader tell a self-review from a review of somebody else. It does
      // not change what is published.
      selfOwned: Boolean(selfOwned),
    };
  }

  // Everything else is `unreviewable`, and it always names a reason — the guard
  // requires one. `no-agreement` is the default because a merge whose paraphrased
  // readings did not converge is the only way to arrive here without one.
  //
  // Findings are not published on this path either: an unreviewable verdict is the
  // reviewer saying it established nothing.
  return {
    state: 'unreviewable',
    reason: reason || 'no-agreement',
    severity: 0,
    findings: [],
    topFinding: undefined,
    concern: undefined,
    assessment: undefined,
    statedIntentSummary,
    findingCount: 0,
    enforceAfter: undefined,
    publishesFindings: false,
    withheld: merged.length
      ? { verdict: 'unreviewable', severity: sev, findingCount: merged.length, because: reason || 'no-agreement', findings: merged }
      : null,
  };
}

/**
 * The head that is always writable, for the moment the planned one is not — the
 * guard is the authority and may grow a rule `planPublication` has not been taught.
 * `unreviewable` is not an accusing state, so this shape passes every gate in
 * `buildVerdictHead` by construction: no allowlist check, no provenance requirement,
 * no `latestReviewKey` requirement.
 */
export function fallbackPlan(detail) {
  return {
    state: 'unreviewable',
    reason: 'withheld',
    severity: 0,
    findings: [],
    topFinding: undefined,
    concern: undefined,
    assessment: undefined,
    statedIntentSummary: undefined,
    findingCount: 0,
    enforceAfter: undefined,
    publishesFindings: false,
    withheld: { verdict: 'unknown', severity: 0, findingCount: 0, because: 'refused-at-write-boundary', detail, findings: [] },
  };
}

/**
 * Tier, and the digest that earns it, for a repository submitted at a commit. Not
 * `tierOf` from @surex/core — that answers the gate's question (do the bytes
 * installed here match the ones reviewed), needs two digests, and so can only return
 * B or C from the writer's side. A commit sha is itself a digest over the tree it
 * names, so this path can honestly say Tier A.
 *
 * `integrity` is the delicate half: the gate compares it byte-for-byte against the
 * npm integrity of whatever is installed locally, and a mismatch renders as "THE
 * PUBLISHED ARTIFACT CHANGED AFTER THIS REVIEW". Record it only when it is the same
 * kind of digest the gate will hold:
 *
 *   · reviewed the npm tarball, integrity confirmed → the npm integrity.
 *   · reviewed the git tree, package not on npm → `git:<sha>`. Nothing local can be
 *     compared against it, and `resolveTier` returns C for an unpinned `github:`
 *     install before it looks, so it cannot manufacture a mismatch.
 *   · reviewed the git tree, package is on npm → nothing. The trap: `git:<sha>` here
 *     would sit opposite a real `sha512-…` for anyone who pinned the version, and
 *     the gate would tell them their artifact had changed. Tier B and no digest.
 */
export function submissionPinning({ onNpm, reviewedNpmTarball, npmIntegrity, integrityVerified, commit }) {
  if (reviewedNpmTarball && integrityVerified && npmIntegrity) {
    return { tier: 'A', integrity: npmIntegrity, basis: 'npm-integrity' };
  }
  if (reviewedNpmTarball) {
    // Read the published tarball but could not confirm it was the one npm recorded:
    // same version string, bytes not compared — Tier B verbatim.
    return { tier: 'B', integrity: undefined, basis: 'npm-tarball-unverified' };
  }
  if (!onNpm && /^[0-9a-f]{40}$/.test(String(commit ?? ''))) {
    return { tier: 'A', integrity: `git:${commit}`, basis: 'commit-sha' };
  }
  if (onNpm && /^[0-9a-f]{40}$/.test(String(commit ?? ''))) {
    return { tier: 'B', integrity: undefined, basis: 'commit-sha-but-published-to-npm' };
  }
  return { tier: 'C', integrity: undefined, basis: 'nothing-pinned' };
}

export const WITHHELD_REASONS = WITHHELD_BECAUSE;

/** True when a plan makes a public accusation. Mirrors the guard's own list. */
export function isAccusation(plan) {
  return ACCUSING_STATES.includes(plan?.state);
}
