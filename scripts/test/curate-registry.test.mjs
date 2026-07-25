// What the curation script is allowed to delete.
//
// This is a test about a HARD RULE, not about a helper. AGENTS.md §4 says a
// verdict is superseded, never deleted — the reason being that a registry where
// inconvenient findings can quietly stop existing is worth nothing. The curation
// script is the only code in the repo that deletes anything, so the boundary has
// to be asserted here rather than trusted to the person running it.
//
// Two categories are outside the rule and nothing else is:
//   · `unknown` heads, which are placeholders — core defines `unknown` as the
//     ABSENCE of an entry, so the stored head asserts there is no head.
//   · verdicts about our OWN fixtures, where we are the subject.

import test from 'node:test';
import assert from 'node:assert/strict';

import { planFor, assertRemovable, DEMO_SET } from '../curate-registry.mjs';

const head = (over = {}) => ({ name: '@acme/some-mcp', state: 'clean', severity: 0, ...over });

test('the demo set is one server per branch of decide()', () => {
  assert.equal(DEMO_SET.length, 3);
  assert.ok(DEMO_SET.includes('@surex/honest-weather'), 'the allow case');
  assert.ok(DEMO_SET.includes('@surex/ambiguous-telemetry'), 'the warn case');
  assert.ok(DEMO_SET.includes('@surex/mal-tool-shadow'), 'the block case');
});

test('the demo set is kept even though it is ours', () => {
  for (const name of DEMO_SET) {
    assert.equal(planFor({ name, state: 'clean' }).action, 'keep', name);
    assert.equal(planFor({ name, state: 'flagged', severity: 3 }).action, 'keep', name);
  }
});

test('a third party`s reached verdict is never removable, whatever its state', () => {
  for (const state of ['clean', 'flagged', 'disputed', 'unreviewable', 'stale']) {
    const h = head({ state, severity: state === 'flagged' ? 4 : 0 });
    assert.equal(planFor(h).action, 'keep', `${state} must be kept`);
    assert.throws(
      () => assertRemovable(h),
      /superseded, never deleted/,
      `${state} must be refused by the guard even if a plan asked for it`,
    );
  }
});

test('unreviewable is kept explicitly, and the reason says it is a real answer', () => {
  // The owner asked for a registry with no unreviewable entries in it. That is a
  // VIEW decision: "we could not read this, and here is why" is a finding about
  // somebody else's package, and deleting it would be deleting a verdict.
  const p = planFor(head({ state: 'unreviewable' }));
  assert.equal(p.action, 'keep');
  assert.match(p.why, /never deleted/);
});

test('an unknown head is removable for anyone, because it is not a verdict', () => {
  // The one removal that reaches third-party names. Nothing was ever concluded
  // about them, so nothing is being erased.
  for (const name of ['@acme/some-mcp', '@surex/honest-notes', '@modelcontextprotocol/server-redis']) {
    const h = head({ name, state: 'unknown' });
    assert.equal(planFor(h).action, 'remove');
    assert.match(planFor(h).why, /placeholder|absence of an entry/);
    assert.ok(assertRemovable(h));
  }
});

test('our own retired fixtures are removable; the scope check is a prefix, not a substring', () => {
  const ours = head({ name: '@surex/mal-postinstall', state: 'flagged', severity: 3 });
  assert.equal(planFor(ours).action, 'remove');
  assert.ok(assertRemovable(ours));

  // A third party whose name merely CONTAINS the scope is not ours. Getting this
  // wrong would delete somebody else's flagged verdict.
  const impostor = head({ name: 'evil-@surex/lookalike', state: 'flagged', severity: 4 });
  assert.equal(planFor(impostor).action, 'keep');
  assert.throws(() => assertRemovable(impostor), /superseded, never deleted/);
});

test('a missing or malformed head is never silently removable', () => {
  for (const h of [undefined, null, {}, { name: '' }, { state: 'clean' }]) {
    assert.equal(planFor(h).action, 'keep', 'unknown shape defaults to keeping');
    assert.throws(() => assertRemovable(h), /superseded, never deleted/);
  }
});
