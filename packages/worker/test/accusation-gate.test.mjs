// The write boundary: who may be publicly flagged, and with what provenance.
//
// A code review found that the "only our own fixtures get flagged" rule lived in
// the publishing scripts, not in the worker — so any new script that called
// `buildVerdictHead` skipped it, and two were added in a single session. Worse,
// the script-level check tested the server's NAME against
// `/fixture|mal-|ambiguous-|honest-/`, and a name is whatever the caller types.
//
// These tests are the rule. Each one fails if its guard is removed.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildVerdictHead, setSelfAuthored, ACCUSING_STATES } from '../src/entities.mjs';

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

test('a third party CANNOT be flagged, whatever it is called', () => {
  setSelfAuthored([OURS]);
  // Every one of these names satisfies the old regex. None of them is ours.
  for (const name of [
    '@someone/mcp-server',
    'totally-not-a-fixture-thirdparty',
    'mal-icious-lookalike',
    'honest-abe-mcp',
    'ambiguous-corp/server',
    '@surex/mal-impersonator',
  ]) {
    assert.throws(
      () => buildVerdictHead({ fingerprint: THEIRS, state: 'flagged', tier: 'C', severity: 4, name, ...provenance }),
      /not on the self-authored allowlist/i,
      `name "${name}" must not buy a flag`,
    );
  }
});

test('the gate covers every accusing state, not just flagged', () => {
  setSelfAuthored([OURS]);
  for (const state of ACCUSING_STATES) {
    assert.throws(
      () => buildVerdictHead({ fingerprint: THEIRS, state, tier: 'C', severity: 3, name: 'x', ...provenance }),
      /self-authored allowlist/i,
      state,
    );
  }
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

test('an EMPTY allowlist flags nothing — a lost file cannot open the gate', () => {
  setSelfAuthored([]);
  assert.throws(
    () => buildVerdictHead({ fingerprint: OURS, state: 'flagged', tier: 'C', severity: 4, name: '@surex/x', ...provenance }),
    /self-authored allowlist/i,
  );
});

// ---------------------------------------------------------------------------
// provenance
// ---------------------------------------------------------------------------

test('a flag without provenance is refused', () => {
  setSelfAuthored([OURS]);
  const base = { fingerprint: OURS, state: 'flagged', tier: 'C', severity: 4, name: '@surex/mal-x' };

  // This is the exact shape the live `@surex/mal-*` heads were written with:
  // model and prompt, but nothing saying WHICH bytes were read. The block message
  // rendered "commit —".
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
