// The submit pipeline must survive every verdict, and flag only what it wrote.
//
// The load-bearing assertion is the regression at the bottom — "no reachable result
// produces a head the guard refuses" — not "clean maps to clean". A pipeline that
// dies at the head write leaves the review record and the Walrus blob already on
// chain, and a happy-path-only test goes green through all of it.

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

test('clean publishes clean, and carries nothing else', () => {
  const plan = planPublication({ verdict: 'clean', fingerprint: THEIRS, canAccuse: () => false });
  assert.equal(plan.state, 'clean');
  assert.equal(plan.reason, undefined);
  assert.equal(plan.severity, 0);
  assert.deepEqual(plan.findings, []);
  assert.equal(plan.topFinding, undefined);
  assert.equal(plan.withheld, null);
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


test('a third party flagged PUBLISHES, with its findings and its provenance', () => {
  // The policy narrowed on 2026-07-26. Withholding every third-party result meant
  // a registry that reads public code and then says nothing about it, which is not
  // caution — at that point the product does not exist. What keeps it answerable
  // is that the whole finding travels with it and a dispute window opens.
  const plan = planPublication({
    verdict: 'flagged', severity: 4, findings: FINDINGS,
    concern: 'data-leaves-the-machine',
    assessment: 'It posts the contents of every file it reads to an endpoint the README never names.',
    statedIntentSummary: 'Claims to read local notes.',
    fingerprint: THEIRS, selfOwned: false, canAccuse: () => false,
    now: 1_700_000_000_000,
  });
  assert.equal(plan.state, 'flagged');
  assert.equal(isAccusation(plan), true);
  // The model said 4; its own worst finding is a 3. The published number is the one
  // the evidence supports — still blocking, and answerable.
  assert.equal(plan.severity, 3, 'a severity that blocks must be one a finding actually carries');
  assert.equal(plan.findings.length, 2);
  assert.equal(plan.findingCount, 2);
  assert.equal(plan.concern, 'data-leaves-the-machine');
  assert.match(plan.assessment, /README never names/);
  assert.equal(plan.topFinding.file, 'src/index.js');
  assert.equal(plan.topFinding.line, 42, 'a finding nobody can locate cannot be answered');
  assert.equal(plan.enforceAfter, 1_700_000_000_000 + DISPUTE_WINDOW_MS, 'the maintainer gets 72h before it hardens');
  assert.equal(plan.withheld, null);
  assert.equal(plan.selfOwned, false, 'the entry records whose code this is a claim about');
});

test('our own code publishes the same way — ownership changes nothing about the verdict', () => {
  const mine = planPublication({
    verdict: 'flagged', severity: 3, findings: FINDINGS, fingerprint: OURS, selfOwned: true,
  });
  assert.equal(mine.state, 'flagged');
  assert.equal(mine.severity, 3);
  assert.equal(mine.selfOwned, true);
});

test('withheld is still reachable, and still leaks nothing when it fires', () => {
  // No longer the default for a third party, but `fallbackPlan` uses it when the
  // write boundary refuses a head for a reason this module was not taught. It must
  // stay silent about what was found.
  const plan = fallbackPlan('the guard grew a rule this pipeline has not been taught');
  assert.equal(plan.state, 'unreviewable');
  assert.equal(plan.reason, 'withheld');
  assert.equal(plan.severity, 0);
  assert.deepEqual(plan.findings, []);
  assert.equal(plan.topFinding, undefined);
  assert.equal(plan.concern, undefined);
  assert.equal(plan.assessment, undefined);
  assert.equal(plan.statedIntentSummary, undefined);
  assert.equal(plan.findingCount, 0);
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

        // A planned flag must always carry what makes it answerable.
        if (plan.state === 'flagged') {
          assert.ok(plan.findings.length > 0, 'a flag with no findings is not actionable');
          assert.ok(plan.enforceAfter, 'a flag must open a dispute window');
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

test('the boundary still refuses an accusation nobody could answer', () => {
  // The allowlist stopped gating; provenance did not. A flag with no model, no
  // prompt version and nothing saying which bytes were read is unanswerable by the
  // person it accuses, and that is what this boundary exists to refuse.
  setSelfAuthored([]);
  assert.throws(
    () => buildVerdictHead({
      fingerprint: THEIRS, state: 'flagged', severity: 3, name: 'someone/else',
    }),
    /without provenance/i,
  );
});

test('the published severity never outranks the findings it rests on', () => {
  // Measured on the first real third-party flag: the model returned severity 3 —
  // the exact threshold at which decide() BLOCKS a tool call — over seven findings
  // that were every one of them severity 2, which only warns. A number that stops
  // somebody's work and that none of its own evidence supports cannot be answered.
  const plan = planPublication({
    verdict: 'flagged', severity: 3,
    findings: [
      { file: 'a.ts', line: 1, category: 'remote-endpoint', description: 'x', severity: 2 },
      { file: 'b.ts', line: 2, category: 'remote-endpoint', description: 'y', severity: 2 },
    ],
    fingerprint: THEIRS,
  });
  assert.equal(plan.severity, 2, 'capped to the highest finding, so it warns instead of blocking');

  // And it does not INVENT a lower one: a real severity-4 finding still blocks.
  const real = planPublication({
    verdict: 'flagged', severity: 4,
    findings: [{ file: 'a.ts', line: 1, category: 'data-leaves-the-machine', description: 'x', severity: 4 }],
    fingerprint: THEIRS,
  });
  assert.equal(real.severity, 4);
});
