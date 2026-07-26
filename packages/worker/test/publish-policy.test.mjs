// The submit pipeline must survive every verdict, and flag only what it wrote.
//
// The regression at the bottom of this file is the reason the module exists: two
// real submissions died at the head write with the review record and the Walrus
// blob already on chain. A test that only checked the happy state would have gone
// green through all of it, so the important assertion here is not "clean maps to
// clean" — it is "no reachable result produces a head the guard refuses".

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  planPublication,
  topFindingOf,
  submissionPinning,
  fallbackPlan,
  isAccusation,
  DISPUTE_WINDOW_MS,
} from '../src/publish-policy.mjs';
import { buildVerdictHead, setSelfAuthored } from '../src/entities.mjs';

const OURS = 'sxf1_1111111111111111111111111111111111111111111111111111111111111111';
const THEIRS = 'sxf1_2222222222222222222222222222222222222222222222222222222222222222';

const FINDINGS = [
  { file: 'src/index.js', line: 42, category: 'undeclared-network', description: 'posts the transcript to a host the README never names', severity: 3 },
  { file: 'src/util.js', line: 7, category: 'undeclared-filesystem', description: 'reads ~/.ssh/id_rsa', severity: 2 },
];

// ---------------------------------------------------------------------------
// the mapping
// ---------------------------------------------------------------------------

test('clean publishes clean, and carries nothing else', () => {
  const plan = planPublication({ verdict: 'clean', fingerprint: THEIRS, canAccuse: () => false });
  assert.equal(plan.state, 'clean');
  assert.equal(plan.reason, undefined);
  assert.equal(plan.severity, 0);
  assert.deepEqual(plan.findings, []);
  assert.equal(plan.topFinding, undefined);
  assert.equal(plan.withheld, null);
});

test('a third party flagged is WITHHELD — never flagged, never crashed', () => {
  const plan = planPublication({
    verdict: 'flagged', severity: 3, findings: FINDINGS,
    fingerprint: THEIRS, selfOwned: false, canAccuse: () => false,
  });
  assert.equal(plan.state, 'unreviewable');
  assert.equal(plan.reason, 'withheld');
  assert.equal(isAccusation(plan), false);
  // The published half says nothing about what was found.
  assert.equal(plan.severity, 0, 'severity 3 on a withheld entry is the accusation with the evidence removed');
  assert.deepEqual(plan.findings, []);
  assert.equal(plan.topFinding, undefined);
  // The maintainer half keeps all of it.
  assert.equal(plan.withheld.because, 'third-party');
  assert.equal(plan.withheld.severity, 3);
  assert.equal(plan.withheld.findingCount, 2);
  assert.equal(plan.withheld.findings.length, 2, 'the submitter is told what was found');
});

test('our own code, on the allowlist, publishes a real flag with a dispute window', () => {
  const now = 1_700_000_000_000;
  const plan = planPublication({
    verdict: 'flagged', severity: 3, findings: FINDINGS,
    fingerprint: OURS, selfOwned: true, canAccuse: (fp) => fp === OURS, now,
  });
  assert.equal(plan.state, 'flagged');
  assert.equal(plan.severity, 3);
  assert.equal(plan.findings.length, 2);
  assert.equal(plan.enforceAfter, now + DISPUTE_WINDOW_MS);
  assert.equal(plan.topFinding.file, 'src/index.js');
  assert.equal(plan.topFinding.line, 42);
});

test('self-owned but NOT on the write-boundary allowlist is withheld, not attempted', () => {
  // The guard is the authority. Planning a flag it would refuse is how the
  // pipeline died in the first place, so the plan asks the guard's own predicate.
  const plan = planPublication({
    verdict: 'flagged', severity: 4, findings: FINDINGS,
    fingerprint: OURS, selfOwned: true, canAccuse: () => false,
  });
  assert.equal(plan.state, 'unreviewable');
  assert.equal(plan.reason, 'withheld');
  assert.equal(plan.withheld.because, 'not-self-authored');
});

test('unreviewable keeps its reason, and invents one only when there is none', () => {
  assert.equal(
    planPublication({ verdict: 'unreviewable', reason: 'source-unavailable', fingerprint: THEIRS }).reason,
    'source-unavailable',
  );
  assert.equal(
    planPublication({ verdict: 'unreviewable', reason: 'partial-source', fingerprint: THEIRS }).reason,
    'partial-source',
  );
  assert.equal(
    planPublication({ verdict: 'unreviewable', reason: null, fingerprint: THEIRS }).reason,
    'no-agreement',
  );
});

test('withholding also holds statedIntentSummary, which carries the conclusion in practice', () => {
  // It is nominally "the author's claim". Measured on a live blob, what the model
  // actually wrote into it was: "The server claims to provide … BUT THE ACTUAL
  // IMPLEMENTATION only supports three RSS feeds…" — the finding, in prose, headed
  // for a public content-addressed store on every state including this one.
  const summary = 'It claims six feeds, but the implementation only wires three and ignores the rest.';
  const held = planPublication({
    verdict: 'flagged', severity: 3, findings: FINDINGS, statedIntentSummary: summary,
    fingerprint: THEIRS, selfOwned: false, canAccuse: () => false,
  });
  assert.equal(held.statedIntentSummary, undefined, 'the summary carries the conclusion; withheld must hold it');
  assert.equal(held.withheld.statedIntentSummary, summary, 'and the operator still sees it');

  const published = planPublication({
    verdict: 'clean', statedIntentSummary: summary, fingerprint: THEIRS,
  });
  assert.equal(published.statedIntentSummary, summary, 'a published verdict still describes what the server claims');
});

test('withholding leaks nothing — not the concern, not the sentence, not the count', () => {
  // `concern` is one word that says what is wrong with somebody's server, and
  // `assessment` is the sentence arguing for it. Publishing either under a neutral
  // state would be the accusation with the state filed off, which is worse than
  // publishing it honestly.
  const plan = planPublication({
    verdict: 'flagged', severity: 4, findings: FINDINGS,
    concern: 'data-leaves-the-machine',
    assessment: 'It posts the contents of every file it reads to an endpoint the README never names.',
    fingerprint: THEIRS, selfOwned: false, canAccuse: () => false,
  });
  assert.equal(plan.concern, undefined);
  assert.equal(plan.assessment, undefined);
  assert.equal(plan.findingCount, 0);
  // and the maintainer still gets all of it
  assert.equal(plan.withheld.concern, 'data-leaves-the-machine');
  assert.match(plan.withheld.assessment, /README never names/);
});

test('a published flag carries the concern, the sentence and the real count', () => {
  const plan = planPublication({
    verdict: 'flagged', severity: 3, findings: FINDINGS,
    concern: 'undeclared-behaviour',
    assessment: 'It writes a usage counter to a host the description does not mention.',
    fingerprint: OURS, selfOwned: true, canAccuse: (fp) => fp === OURS,
  });
  assert.equal(plan.concern, 'undeclared-behaviour');
  assert.match(plan.assessment, /usage counter/);
  assert.equal(plan.findingCount, 2, 'topFinding is the first of two, and the page must be able to say so');
});

test('a clean verdict still explains what the server does', () => {
  const plan = planPublication({
    verdict: 'clean', fingerprint: THEIRS,
    assessment: 'Fetches three RSS feeds named in its README and returns their items.',
  });
  assert.equal(plan.concern, 'none');
  assert.match(plan.assessment, /RSS feeds/);
  assert.equal(plan.findingCount, 0);
});

test('an unreviewable verdict publishes no findings — it established none', () => {
  const plan = planPublication({
    verdict: 'unreviewable', reason: 'no-agreement', severity: 3, findings: FINDINGS, fingerprint: THEIRS,
  });
  assert.deepEqual(plan.findings, []);
  assert.equal(plan.severity, 0);
  assert.equal(plan.withheld.findingCount, 2, 'still reported to the submitter');
});

// ---------------------------------------------------------------------------
// the finding a reader is shown
// ---------------------------------------------------------------------------

test('topFinding keeps the file and the line a developer needs to check it', () => {
  const top = topFindingOf(FINDINGS);
  assert.equal(top.severity, 3);
  assert.equal(top.file, 'src/index.js');
  assert.equal(top.line, 42);
  assert.equal(top.category, 'undeclared-network');
  assert.match(top.description, /transcript/);
});

test('at equal severity, the finding that can be located wins', () => {
  const top = topFindingOf([
    { category: 'x', description: 'no location', severity: 3 },
    { file: 'src/a.js', line: 9, category: 'y', description: 'locatable', severity: 3 },
  ]);
  assert.equal(top.file, 'src/a.js');
  assert.equal(top.line, 9);
});

test('topFinding of nothing is nothing', () => {
  assert.equal(topFindingOf([]), undefined);
  assert.equal(topFindingOf(undefined), undefined);
});

// ---------------------------------------------------------------------------
// tier, and the digest that earns it
// ---------------------------------------------------------------------------

test('a verified npm tarball is tier A on the npm integrity', () => {
  const p = submissionPinning({
    onNpm: true, reviewedNpmTarball: true, integrityVerified: true,
    npmIntegrity: 'sha512-abc', commit: 'a'.repeat(40),
  });
  assert.deepEqual(p, { tier: 'A', integrity: 'sha512-abc', basis: 'npm-integrity' });
});

test('a commit-pinned repo that is not on npm is tier A on the commit sha', () => {
  const commit = 'b'.repeat(40);
  const p = submissionPinning({ onNpm: false, reviewedNpmTarball: false, commit });
  assert.equal(p.tier, 'A', 'a 40-char sha is a digest over the tree; "nothing was checked" is false');
  assert.equal(p.integrity, `git:${commit}`);
});

test('a package on npm that we had to read from git records NO integrity', () => {
  // The trap: `git:<sha>` opposite a real sha512 on a user's machine renders as
  // "THE PUBLISHED ARTIFACT CHANGED AFTER THIS REVIEW". It did not change.
  const p = submissionPinning({ onNpm: true, reviewedNpmTarball: false, commit: 'c'.repeat(40) });
  assert.equal(p.tier, 'B');
  assert.equal(p.integrity, undefined, 'a git digest must never sit where the gate expects an npm one');
});

test('an npm tarball we could not verify is tier B, not tier A', () => {
  const p = submissionPinning({
    onNpm: true, reviewedNpmTarball: true, integrityVerified: false, npmIntegrity: 'sha512-abc',
  });
  assert.equal(p.tier, 'B');
  assert.equal(p.integrity, undefined);
});

test('nothing pinned is still tier C', () => {
  assert.equal(submissionPinning({ onNpm: false, reviewedNpmTarball: false, commit: 'not-a-sha' }).tier, 'C');
});

// ---------------------------------------------------------------------------
// the regression: no reachable plan may be refused by the write boundary
// ---------------------------------------------------------------------------

test('EVERY plan the pipeline can produce is one buildVerdictHead accepts', () => {
  setSelfAuthored([OURS]);

  const verdicts = ['clean', 'flagged', 'unreviewable'];
  const reasons = [null, 'licence', 'source-unavailable', 'remote-endpoint', 'no-agreement', 'partial-source', 'withheld'];
  const ownerships = [
    { selfOwned: false, canAccuse: () => false, label: 'third party' },
    { selfOwned: true, canAccuse: () => false, label: 'ours, not allowlisted' },
    { selfOwned: true, canAccuse: (fp) => fp === OURS, label: 'ours, allowlisted' },
  ];

  let checked = 0;
  for (const verdict of verdicts) {
    for (const reason of reasons) {
      for (const owner of ownerships) {
        const fingerprint = owner.selfOwned ? OURS : THEIRS;
        const plan = planPublication({
          verdict, reason, severity: 3, findings: FINDINGS,
          fingerprint, selfOwned: owner.selfOwned, canAccuse: owner.canAccuse,
        });

        // A flag may only ever be planned for something on the allowlist.
        if (plan.state === 'flagged') {
          assert.ok(owner.canAccuse(fingerprint), `planned a flag for "${owner.label}" — AGENTS.md §4`);
        }

        assert.doesNotThrow(
          () => buildVerdictHead({
            fingerprint,
            state: plan.state,
            reason: plan.reason,
            tier: 'A',
            severity: plan.severity,
            enforceAfter: plan.enforceAfter,
            name: 'some/server',
            // Everything below is what the pipeline always supplies now.
            latestReviewKey: '0xreview',
            sourceKey: 'github:some/server@' + 'd'.repeat(40),
            reviewedCommit: 'd'.repeat(40),
            reviewedAt: new Date(0).toISOString(),
            modelId: 'a-model',
            promptVersion: 'rv-6',
            topFinding: plan.topFinding,
          }),
          `verdict=${verdict} reason=${reason} owner=${owner.label} produced a head the guard refuses`,
        );
        checked += 1;
      }
    }
  }
  assert.equal(checked, verdicts.length * reasons.length * ownerships.length);
});

test('the fallback plan is writable even when everything else has failed', () => {
  setSelfAuthored([]);
  const plan = fallbackPlan('the guard grew a rule this pipeline has not been taught');
  assert.doesNotThrow(() => buildVerdictHead({
    fingerprint: THEIRS,
    state: plan.state,
    reason: plan.reason,
    severity: plan.severity,
    tier: 'C',
    name: 'some/server',
  }));
  assert.equal(plan.state, 'unreviewable');
  assert.equal(plan.reason, 'withheld');
});

test('the guard still refuses a flag this module would never plan', () => {
  // Belt and braces: if planPublication is ever bypassed, the boundary holds.
  setSelfAuthored([]);
  assert.throws(
    () => buildVerdictHead({
      fingerprint: THEIRS, state: 'flagged', severity: 3, name: 'someone/else',
      modelId: 'm', promptVersion: 'rv-6', reviewedCommit: 'e'.repeat(40),
    }),
    /self-authored allowlist/i,
  );
});
