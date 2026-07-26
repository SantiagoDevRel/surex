// What the verdict page SAYS, for every state a head can carry: the banner, the
// twenty-second summary, and the problem-kind line.
//
// The failure these guard against is one situation's wording applied to a
// situation it does not describe — `withheld` (a review that RAN and is not
// published) reading as "the source could not be read", `no-agreement` (read
// twice, no majority) getting the same sentence next to "the readings disagreed",
// `unknown` (nobody has looked) asserting what the model saw.
//
// So the assertions are about MEANING rather than strings: no rendered body may
// claim a reading that did not happen, and no body may contain two clauses that
// contradict each other. Those survive a copy edit; exact-text ones would not.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { COPY } from '../lib/copy.ts';
import { stateBanner, summarySentence, concernSentence } from '../lib/verdict-view.ts';

/** The closed set the writer can produce — packages/reviewer/src/schema.mjs REASONS. */
const REASONS = [
  'licence', 'source-unavailable', 'remote-endpoint',
  'no-agreement', 'no-reading', 'withheld', 'partial-source',
];

/** The closed set of concerns — packages/reviewer/src/schema.mjs CONCERNS. */
const CONCERNS = [
  'none', 'does-not-do-what-it-claims', 'undeclared-behaviour', 'misleading-description',
  'data-leaves-the-machine', 'runs-code-it-fetched', 'deliberate-concealment',
];

const head = (over = {}) => ({
  fingerprint: `sxf1_${'a'.repeat(64)}`,
  state: 'unreviewable',
  severity: 0,
  tier: 'C',
  ...over,
});

/** "the source could not be read", in any of the ways this codebase says it. */
const CLAIMS_UNREADABLE = /could not be (read|fetched)|there was nothing to read|never read|no local code/i;
/** A claim that a model looked at the code. */
const CLAIMS_A_READING = /the model saw|readings? (disagreed|did not converge)|was read/i;

// ---------------------------------------------------------------------------
// every reason gets a body, and the body is about that reason
// ---------------------------------------------------------------------------

for (const reason of REASONS) {
  test(`unreviewable/${reason} renders a body written for it`, () => {
    const banner = stateBanner(head({ reason }));
    assert.ok(banner, `${reason} must produce a banner`);
    assert.ok(banner.body.length > 20, `${reason} body is too short to say anything`);

    // The bug: a generic "could not be read" lede glued to a specific reason.
    if (reason === 'no-agreement' || reason === 'withheld' || reason === 'partial-source') {
      assert.doesNotMatch(
        banner.body,
        CLAIMS_UNREADABLE,
        `${reason} means the source WAS read — the body must not say it could not be`,
      );
    }
  });
}

test('a reason nothing recognises admits it rather than inventing a cause', () => {
  const banner = stateBanner(head({ reason: 'something-nobody-has-shipped-yet' }));
  assert.ok(banner);
  assert.doesNotMatch(banner.body, CLAIMS_UNREADABLE, 'an unknown reason is not evidence the source was unreadable');
  assert.match(banner.body, /does not say|no verdict/i);
});

test('withheld says a review ran, and never that it could not', () => {
  const banner = stateBanner(head({ reason: 'withheld' }));
  assert.match(banner.body, /review completed|was read/i);
  assert.doesNotMatch(banner.body, CLAIMS_UNREADABLE);
  assert.match(banner.label, /NOT PUBLISHED/);
});

test('no-agreement says the readings disagreed, and never that nothing was read', () => {
  const body = stateBanner(head({ reason: 'no-agreement' })).body;
  assert.match(body, /did not converge|disagree/i);
  assert.doesNotMatch(body, CLAIMS_UNREADABLE);
});

test('no-reading says nothing was read, and never that readings disagreed', () => {
  // The distinction this reason exists for: an empty reason filled in as
  // `no-agreement` publishes an unreachable reviewer as "the readings disagreed".
  const body = stateBanner(head({ reason: 'no-reading' })).body;
  assert.match(body, /never read|could not be reached/i);
  assert.doesNotMatch(body, /disagree|did not converge/i);
});

test('a clean or flagged head gets no banner — the stamp is the statement', () => {
  assert.equal(stateBanner(head({ state: 'clean', reason: undefined })), null);
  assert.equal(stateBanner(head({ state: 'flagged', reason: undefined })), null);
  assert.equal(stateBanner(head({ state: 'unknown', reason: undefined })), null);
});

// ---------------------------------------------------------------------------
// the hero sentence
// ---------------------------------------------------------------------------

test('the hero never repeats the banner verbatim', () => {
  for (const reason of REASONS) {
    const h = head({ reason });
    const banner = stateBanner(h);
    const summary = summarySentence(h);
    if (banner) {
      assert.notEqual(
        summary, banner.body,
        `${reason}: the same paragraph twice on one page turns a fact into nagging`,
      );
    }
  }
});

test('the hero prefers what the review actually said', () => {
  const assessment = 'It posts every file it reads to a host the README never names.';
  assert.equal(summarySentence(head({ state: 'flagged', reason: undefined, assessment })), assessment);
});

test('the hero on an unknown entry does not claim a review happened', () => {
  const sentence = summarySentence(head({ state: 'unknown', reason: undefined }));
  assert.doesNotMatch(sentence, /the model saw/i);
});

test('no hero sentence claims a reading on a reason that had none', () => {
  for (const reason of ['licence', 'source-unavailable', 'remote-endpoint', 'no-reading']) {
    const sentence = summarySentence(head({ reason }));
    assert.doesNotMatch(sentence, CLAIMS_A_READING, `${reason} must not imply the code was read`);
  }
});

// ---------------------------------------------------------------------------
// the problem-kind line
// ---------------------------------------------------------------------------

test('every concern in the closed set renders, except the one that is not a problem', () => {
  for (const concern of CONCERNS) {
    const sentence = concernSentence(head({ state: 'flagged', reason: undefined, concern }));
    if (concern === 'none') {
      assert.equal(sentence, null, 'a label reading WHAT KIND OF PROBLEM over "nothing found" is noise');
    } else {
      assert.ok(sentence, `${concern} has no rendered wording`);
      assert.ok(sentence.length > 10, `${concern} wording is too short to mean anything`);
    }
  }
});

test('a withheld entry never renders a concern — that word IS the accusation', () => {
  const sentence = concernSentence(head({ reason: 'withheld', concern: 'data-leaves-the-machine' }));
  assert.equal(sentence, null);
});

test('an unrecognised concern renders nothing rather than the raw enum value', () => {
  assert.equal(concernSentence(head({ state: 'flagged', reason: undefined, concern: 'invented-by-a-model' })), null);
  assert.equal(concernSentence(head({ state: 'flagged', reason: undefined })), null);
});

test('the strongest concern describes the code, not the author\'s purpose', () => {
  // `deliberate-concealment` is the only value that asserts intent, and the
  // reviewer's schema calls a wrong one "an accusation about a person rather than
  // about a program" — so the rendered string must not read as a claim about motive.
  const sentence = COPY.verdict.concerns['deliberate-concealment'];
  assert.doesNotMatch(sentence, /\bit works to\b|\bintends?\b|\bdeliberately\b|\bon purpose\b/i);
  assert.match(sentence, /the code is written/i);
});

test('no concern wording claims something a static read cannot establish', () => {
  // "code that was never reviewed" asserts a fact about the whole world. SureX only
  // knows the code is not in the blob it read.
  assert.doesNotMatch(COPY.verdict.concerns['runs-code-it-fetched'], /never reviewed/i);
});
