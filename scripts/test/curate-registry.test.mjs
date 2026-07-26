// What the curation script is allowed to delete — a test about a HARD RULE, not a
// helper. AGENTS.md §4: a verdict is superseded, never deleted. curate-registry.mjs is
// the only code in the repo that deletes anything, so the boundary is asserted here
// rather than left to whoever runs it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { planFor, assertRemovable, DEMO_SET, KEEP } from '../curate-registry.mjs';

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

test('a third party`s REACHED verdict is never removable, whatever its state', () => {
  for (const state of ['clean', 'flagged', 'disputed', 'stale']) {
    const h = head({ state, severity: state === 'flagged' ? 4 : 0 });
    assert.equal(planFor(h).action, 'keep', `${state} must be kept`);
    assert.throws(
      () => assertRemovable(h),
      /superseded, never deleted/,
      `${state} must be refused by the guard even if a plan asked for it`,
    );
  }
});

test('a third party`s unreviewable IS removable, because no verdict was reached', () => {
  // `unreviewable` means "we could not read this", so there is no finding to bury.
  const h = head({ name: '@acme/unreadable', state: 'unreviewable' });
  assert.equal(planFor(h).action, 'remove');
  assert.ok(assertRemovable(h));
});

test('one unreviewable is kept, so the state stays demonstrable', () => {
  assert.ok(KEEP.includes('@certscore/mcp'));
  assert.equal(planFor(head({ name: '@certscore/mcp', state: 'unreviewable' })).action, 'keep');
});

test('the keep list is the whole registry, and the demo set is inside it', () => {
  assert.equal(KEEP.length, 10, 'the owner named ten entries');
  assert.equal(new Set(KEEP).size, KEEP.length, 'no duplicates');
  for (const name of DEMO_SET) assert.ok(KEEP.includes(name), `${name} must survive`);
  // Anything not named goes, however good its verdict looks.
  assert.equal(planFor(head({ name: '@acme/not-on-the-list', state: 'unreviewable' })).action, 'remove');
});

test('the keep list wins over every removal rule', () => {
  // A named entry survives whatever state it is in — the removal rules would
  // otherwise take two of these.
  for (const name of KEEP) {
    for (const state of ['unknown', 'unreviewable', 'clean', 'flagged']) {
      assert.equal(planFor({ name, state }).action, 'keep', `${name} @ ${state}`);
    }
  }
});

test('an unknown head is removable for anyone, because it is not a verdict', () => {
  // The one removal that reaches third-party names, and none of these is on the
  // keep list — that list wins, as the test above proves.
  for (const name of ['@acme/some-mcp', '@surex/honest-notes', '@modelcontextprotocol/server-everything']) {
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

  // A name that merely CONTAINS the scope is not ours; a substring check here
  // deletes somebody else's flagged verdict.
  const impostor = head({ name: 'evil-@surex/lookalike', state: 'flagged', severity: 4 });
  assert.equal(planFor(impostor).action, 'keep');
  assert.throws(() => assertRemovable(impostor), /superseded, never deleted/);
});

test('a missing or malformed head is never silently removable', () => {
  // An unnamed head cannot be matched against the keep list, and guessing is how
  // the wrong entity gets deleted.
  for (const h of [undefined, null, {}, { name: '' }, { state: 'clean' }]) {
    assert.equal(planFor(h).action, 'keep', 'unknown shape defaults to keeping');
    assert.throws(() => assertRemovable(h), /refusing to remove an unnamed head/);
  }
});
