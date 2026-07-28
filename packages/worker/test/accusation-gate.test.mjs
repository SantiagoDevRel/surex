// The write boundary: who may be publicly flagged, and with what provenance.
//
// The rule — "only our own fixtures get flagged" — belongs in the worker, not in a
// publishing script a new caller can skip, and it matches on fingerprints, because
// a name is whatever the caller types.
//
// The rule NARROWED on 2026-07-26 (owner's decision): the allowlist no longer gates
// an accusation by default, because withholding every third-party result meant a
// registry that reads public code and then publishes nothing about it. What gates an
// accusation now is PROVENANCE, and the allowlist survives as an OPT-IN predicate
// (`requireSelfAuthored`) for callers that want it — the fixture publisher does.
//
// These tests are the rule as it stands. Each one fails if its guard is removed.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildVerdictHead, setSelfAuthored, isSelfAuthored, ACCUSING_STATES } from '../src/entities.mjs';

const OURS = 'sxf1_1111111111111111111111111111111111111111111111111111111111111111';
const THEIRS = 'sxf1_2222222222222222222222222222222222222222222222222222222222222222';

const provenance = {
  modelId: 'qwen3-coder-next:surex32k',
  promptVersion: 'rv-4',
  reviewedCommit: 'a'.repeat(40),
};

test('our own fixture can be flagged', () => {
  setSelfAuthored([OURS]);
  const head = buildVerdictHead({
    fingerprint: OURS, state: 'flagged', tier: 'C', severity: 4, name: '@surex/mal-exfil-init', ...provenance,
  });
  assert.ok(head.attributes.length);
});

test('a third party CAN be flagged now, and only with full provenance', () => {
  setSelfAuthored([OURS]);
  // The narrowed rule. A review of somebody else's public code publishes what it
  // found — that is the product — and the thing that makes it answerable rather
  // than an unanswerable accusation is the provenance travelling with it.
  const head = buildVerdictHead({
    fingerprint: THEIRS, state: 'flagged', tier: 'A', severity: 4,
    name: '@someone/mcp-server', ...provenance,
  });
  const attrs = Object.fromEntries(head.attributes.map((a) => [a.key, a.value]));
  assert.equal(attrs.state, 'flagged');
  assert.equal(attrs.severity, 4);
  assert.equal(head.payload.modelId, provenance.modelId);
  assert.equal(head.payload.promptVersion, provenance.promptVersion);
  assert.equal(head.payload.reviewedCommit, provenance.reviewedCommit);
});

test('a caller that asks for the allowlist still gets it, for every accusing state', () => {
  // `scripts/review-and-publish.mjs` passes this: a fixture publisher that reached
  // outside the fixture directory would be a bug, and the predicate is how it says
  // so at the write boundary rather than in its own control flow.
  setSelfAuthored([OURS]);
  for (const state of ACCUSING_STATES) {
    assert.throws(
      () => buildVerdictHead({
        fingerprint: THEIRS, state, tier: 'C', severity: 3, name: 'x',
        requireSelfAuthored: isSelfAuthored, ...provenance,
      }),
      /predicate and it said no/i,
      state,
    );
  }
  // and it lets ours through
  assert.ok(buildVerdictHead({
    fingerprint: OURS, state: 'flagged', tier: 'C', severity: 3, name: '@surex/x',
    requireSelfAuthored: isSelfAuthored, ...provenance,
  }));
});

test('non-accusing states are unaffected — a third party can be clean or unreviewable', () => {
  setSelfAuthored([OURS]);
  assert.ok(buildVerdictHead({
    fingerprint: THEIRS, state: 'clean', tier: 'C', severity: 0, name: '@someone/mcp',
    latestReviewKey: '0xabc', ...provenance,
  }));
  assert.ok(buildVerdictHead({
    fingerprint: THEIRS, state: 'unreviewable', reason: 'licence', tier: 'C', name: '@someone/mcp',
  }));
});

test('an EMPTY allowlist still closes the gate for a caller that asked for it', () => {
  // The fail-safe direction is unchanged where the predicate is used: a lost file
  // means "we cannot publish our own fixtures", never "anything may be flagged".
  setSelfAuthored([]);
  assert.throws(
    () => buildVerdictHead({
      fingerprint: OURS, state: 'flagged', tier: 'C', severity: 4, name: '@surex/x',
      requireSelfAuthored: isSelfAuthored, ...provenance,
    }),
    /predicate and it said no/i,
  );
});

test('a flag without provenance is refused', () => {
  setSelfAuthored([OURS]);
  const base = { fingerprint: OURS, state: 'flagged', tier: 'C', severity: 4, name: '@surex/mal-x' };

  // Model and prompt but nothing saying which bytes were read — the shape that
  // renders "commit —" in a block message.
  assert.throws(
    () => buildVerdictHead({ ...base, modelId: 'm', promptVersion: 'rv-4' }),
    /without provenance/i,
  );
  assert.throws(() => buildVerdictHead({ ...base, promptVersion: 'rv-4', reviewedCommit: 'a'.repeat(40) }), /modelId/);
  assert.throws(() => buildVerdictHead({ ...base, modelId: 'm', reviewedCommit: 'a'.repeat(40) }), /promptVersion/);
});

test('npm provenance counts: integrity identifies the bytes as well as a commit does', () => {
  setSelfAuthored([OURS]);
  assert.ok(buildVerdictHead({
    fingerprint: OURS, state: 'flagged', tier: 'C', severity: 3, name: '@surex/mal-x',
    modelId: 'm', promptVersion: 'rv-4', integrity: 'sha512-abc…',
  }), 'a published tarball has no commit, and its integrity hash is the same kind of claim');
});
