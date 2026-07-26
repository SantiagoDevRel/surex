// What a review RESULT becomes once it is published — decided in one place, as data.
//
// The write boundary in `entities.mjs` answers "may this be written". This module
// answers the question BEFORE it: "given what the model concluded, what is it
// honest to publish". Those are different jobs, and keeping them apart is the
// whole point of this file.
//
// It exists because they were not kept apart, and the failure was measured. The
// submit pipeline computed a state, then wrote the head with
//
//     state: o.state === 'clean' ? 'clean' : 'unreviewable'
//     reason: o.state === 'clean' ? undefined : o.reason
//
// which for a `flagged` result produced `state=unreviewable` with `reason=undefined`
// — a combination `buildVerdictHead` refuses. The guard did its job; the pipeline
// died of it. Two real submissions on the DGX (`ing_60b23f6f3ee96740da`,
// `ing_cce408c05b3462b9ce`, 2026-07-26) reached stage `arkiv (7/8)`, wrote the
// review record and the Walrus blob, and then exited 1 at the head. The maintainer
// saw a spinner stop. The registry got an entry with no head — invisible to the
// listing query, which reads verdictHeads.
//
// So: this function is TOTAL. Every (verdict, reason, ownership) triple maps to a
// head that `buildVerdictHead` will accept. There is no input for which the honest
// answer is "throw", because a crash is the one outcome that leaves a submission
// with no entry at all, and an absent entry says less than an honest `unreviewable`.
//
// THE RULE IT ENFORCES — AGENTS.md §4:
//
//   Never publicly flag a real, named third-party project on the strength of an
//   unaudited model verdict. The only servers SureX flags publicly are the ones it
//   wrote itself.
//
// A maintainer who submits a repository consented to a REVIEW. They did not consent
// to an accusation published under their project's name by a model nobody audited.
// So a third-party `flagged` is not softened, not rephrased, and not published at a
// lower severity — it is WITHHELD: the entry says a review ran and its result is not
// being published, the findings go to the maintainer, and the chain carries none of
// them. `withheld` is the honest word for that and it is already in the contract's
// reason enum.

import { ACCUSING_STATES, isSelfAuthored } from './entities.mjs';

/** A flagged head is contestable for 72 hours before the block message hardens. */
export const DISPUTE_WINDOW_MS = 72 * 3600 * 1000;

/**
 * The finding a reader is shown first.
 *
 * WHOLE, deliberately. The head's `topFinding` is what the gate prints in a block
 * message and what `/r/<fp>` renders, and the contract's shape is
 * `{file, line, category, description, severity}`. A live head written before this
 * function existed carries `{severity, category, description}` and nothing else, so
 * the finding renders with no file and no line — which is precisely the
 * "unanswerable accusation" the provenance guard elsewhere in this package refuses
 * to write. A developer cannot check a claim they cannot locate.
 *
 * Ties break toward the finding that CAN be located: between two severity-3
 * findings, the one with a real file and line is the useful one to print.
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
 * Why a result was not published as it stood. Carried back to the caller so the
 * submitter is TOLD, rather than left to infer it from a state that looks like a
 * failure. Notifying the maintainer is the other half of withholding: the findings
 * are not published, and they are also not lost.
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
 * @param {boolean=} args.selfOwned       the submitted repo is under an owner the
 *                                        OPERATOR has declared ours (SUREX_SELF_OWNED).
 *                                        Not caller-supplied: GitHub is what makes
 *                                        `SantiagoDevRel/x` unforgeable by anyone else.
 * @param {(fp:string)=>boolean=} args.canAccuse  defaults to the same allowlist
 *                                        `buildVerdictHead` reads, so this function
 *                                        cannot plan a write the guard will refuse.
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
    // `clean` is the only verdict that makes SureX say nothing at all, so it
    // carries nothing: the schema already refuses a clean verdict with findings,
    // and severity is 0 by construction rather than by hope.
    return {
      state: 'clean',
      reason: undefined,
      severity: 0,
      findings: [],
      topFinding: undefined,
      // A clean verdict still says what the server DOES. That sentence is the
      // whole difference between "reviewed, nothing found" and a blank row, and
      // it is the one case where prose costs nothing: there is no accusation in it.
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
     * A flagged review PUBLISHES, including about software we did not write.
     *
     * This reversed on 2026-07-26, by the owner's decision, and the reasoning is
     * worth keeping because the old rule was not wrong so much as too broad.
     *
     * AGENTS.md §4 was written to stop one specific harm: branding a real named
     * project as malicious on the strength of an unaudited model verdict. The
     * implementation went further and withheld EVERYTHING about a third party —
     * which meant a registry that reads public, open-source code, reaches a
     * conclusion about it, and then refuses to say what it found. That is not
     * caution; at that point the product does not exist. The code is public, we
     * read it, and declining to publish a criterion about it is withholding the
     * only thing anyone came for.
     *
     * What replaces "withhold everything" is not "publish anything". Three things
     * carry the weight instead, and they are all still here:
     *
     *   · PROVENANCE IS MANDATORY. `buildVerdictHead` refuses any accusing state
     *     without the model, the prompt version and what exactly was read. A
     *     finding nobody can trace to specific bytes cannot be answered, and an
     *     unanswerable accusation is the thing this registry exists not to make.
     *   · THE FINDING CARRIES ITS EVIDENCE. File, line, category, description —
     *     whole, into the certified blob and onto the head. A maintainer can open
     *     the line and disagree.
     *   · A DISPUTE WINDOW OPENS. `enforceAfter` is 72 hours out, so the block
     *     message calls itself unconfirmed until a maintainer has had time to
     *     answer, and a rebuttal is stored beside the accusation with equal weight.
     *
     * `withheld` is not deleted — `fallbackPlan` still uses it, and it remains the
     * honest state for a result we decline to publish for any other reason.
     */
    /**
     * THE PUBLISHED SEVERITY MAY NOT OUTRANK ITS OWN EVIDENCE.
     *
     * The model returns a top-level `severity` alongside per-finding severities,
     * and they can disagree. Measured on the first real third-party flag published
     * under this policy — `AgentDeskAI/browser-tools-mcp` — the record came back
     * `severity: 3` with SEVEN findings, every one of them severity 2.
     *
     * Three is not an arbitrary number here: `decide()` blocks at 3 and warns at 2.
     * So that verdict would have stopped a developer's tool call on the strength of
     * a summary figure that not one piece of its own evidence supported, and the
     * maintainer's only possible answer would have been "which finding is a three?"
     * — to which the record has no reply.
     *
     * Capped at the highest finding. The model may still be wrong about a finding;
     * it can no longer be wrong about the total in the direction that blocks.
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
      // `topFinding` is the FIRST of these, not the only one. A page that read one
      // finding off the head and captioned it "finding 1 of 1" understated a
      // five-finding review every time.
      findingCount: merged.length,
      enforceAfter: now + DISPUTE_WINDOW_MS,
      publishesFindings: true,
      withheld: null,
      // Recorded so the entry can say whose code this is a claim about. It does
      // not change what is published any more; it changes nothing except that a
      // reader can tell a self-review from a review of somebody else.
      selfOwned: Boolean(selfOwned),
    };
  }

  // Everything else is `unreviewable`, and it always names a reason — the guard
  // requires one, and "unreviewable" with no reason tells a reader nothing.
  //
  // `no-agreement` is the default because it is what the merge produces when the
  // paraphrased readings did not converge, and that is the only way to arrive here
  // without an explicit reason.
  //
  // Findings are NOT published on this path either. An unreviewable verdict is the
  // reviewer saying it did not establish anything; shipping the findings it did not
  // stand behind would be an accusation with the verdict's authority removed.
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
 * The head that is ALWAYS writable, for the moment the planned one is not.
 *
 * Defence in depth, and the reason it is worth having: the plan above is written
 * against the guard's rules, but the guard is the authority and it may grow a rule
 * this function has not been taught. If that ever happens the correct outcome is an
 * honest, quiet entry — not a crashed pipeline that leaves a review record with no
 * head. `unreviewable` is not an accusing state, so this shape passes every gate in
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

// ---------------------------------------------------------------------------
// what the submission actually pinned
// ---------------------------------------------------------------------------

/**
 * Tier, and the digest that earns it, for a repository submitted AT A COMMIT.
 *
 * `tierOf` in @surex/core answers a different question — the one the GATE asks, on
 * a user's machine: *do the bytes installed here match the ones reviewed*. It needs
 * two digests and the gate supplies the second, so it can only ever return B or C
 * from the writer's side. Calling it here published `tier: 'C'` — "nothing was
 * checked" — on a submission that named a 40-character commit sha. Something was
 * checked; the entry said otherwise.
 *
 * What is true on this path: a submission names a commit, and a commit sha IS a
 * digest over the tree it names. GitHub cannot serve different bytes under the same
 * sha. So the review is bound to exact, re-fetchable bytes, and the entry may say so.
 *
 * `integrity` is the delicate half, because the GATE compares it byte-for-byte
 * against the npm integrity of whatever is installed locally, and a mismatch renders
 * as "THE PUBLISHED ARTIFACT CHANGED AFTER THIS REVIEW". So it is recorded ONLY when
 * it is the same KIND of digest the gate will hold:
 *
 *   · reviewed the npm tarball, integrity verified → the npm integrity. Comparable,
 *     and the case Tier A was designed for.
 *   · reviewed the git tree, and the package is NOT on npm → `git:<sha>`. Nothing
 *     local can be compared against it, and `resolveTier` returns C for an unpinned
 *     `github:` install long before it looks, so it cannot manufacture a mismatch.
 *   · reviewed the git tree, but the package IS on npm (the tarball would not
 *     download) → NOTHING. This is the trap: recording `git:<sha>` here would sit
 *     opposite a real `sha512-…` on the machine of anyone who pinned the version,
 *     and the gate would tell them their artifact had changed. It has not. Tier B
 *     and no digest is the honest pair, and the fallback is already stated in the
 *     record.
 */
export function submissionPinning({ onNpm, reviewedNpmTarball, npmIntegrity, integrityVerified, commit }) {
  if (reviewedNpmTarball && integrityVerified && npmIntegrity) {
    return { tier: 'A', integrity: npmIntegrity, basis: 'npm-integrity' };
  }
  if (reviewedNpmTarball) {
    // We read the published tarball but could not confirm it was the one npm
    // recorded. Same version string, bytes not compared — that is Tier B verbatim.
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

/** Exported for the tests, and so a reader can see the closed set. */
export const WITHHELD_REASONS = WITHHELD_BECAUSE;

/** True when a plan makes a public accusation. Mirrors the guard's own list. */
export function isAccusation(plan) {
  return ACCUSING_STATES.includes(plan?.state);
}
