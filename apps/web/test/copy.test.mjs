/**
 * The copy law, over every string the site can render.
 *
 * AGENTS.md §4 makes the law binding on every surface. `copy.mjs` in
 * `@surex/core` makes it executable. This file is what connects the two for the
 * web app: it walks `lib/copy.ts` and `lib/fixtures.ts` leaf by leaf and runs
 * each string through `copyViolations()`, so a banned word fails here instead
 * of shipping.
 *
 * Run: node --test apps/web/test/
 *
 * The `.ts` imports are deliberate — Node 22 strips types, so the law is
 * testable with no build step between writing a string and checking it.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertCopy, copyViolations, isFingerprint } from '@surex/core';

import { COPY } from '../lib/copy.ts';
import { FIXTURE_FINGERPRINTS, FIXTURE_PROSE, FIXTURE_ROWS } from '../lib/fixtures.ts';

/** Every string leaf, with the path that leads to it, so a failure names itself. */
function leaves(node, path = '') {
  if (typeof node === 'string') return [[path, node]];
  if (Array.isArray(node)) return node.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  }
  return [];
}

const COPY_LEAVES = leaves(COPY);

test('lib/copy.ts exposes strings to check', () => {
  // Guards against the test silently passing over an empty or reshaped module.
  assert.ok(COPY_LEAVES.length > 100, `expected >100 strings, found ${COPY_LEAVES.length}`);
});

test('every string in lib/copy.ts obeys the copy law', () => {
  const failures = [];
  for (const [path, value] of COPY_LEAVES) {
    const violations = copyViolations(value);
    if (violations.length) {
      failures.push(
        `${path}: ${violations.map((v) => `"${v.word}" → use ${v.instead}`).join('; ')}\n    ${value}`,
      );
    }
  }
  assert.deepEqual(failures, [], `\n${failures.join('\n')}\n`);
});

test('assertCopy() also passes on the whole module, concatenated', () => {
  // Belt and braces: catches a violation that only forms across a sentence
  // boundary the per-leaf pass happens to split.
  assertCopy(COPY_LEAVES.map(([, v]) => v).join('\n'), 'apps/web/lib/copy.ts');
});

test('the word is "reviewed" — and the site actually uses it', () => {
  const all = COPY_LEAVES.map(([, v]) => v)
    .join(' ')
    .toLowerCase();
  assert.ok(all.includes('reviewed'), 'the copy never says "reviewed"');
});

test('fixture prose obeys the copy law too', () => {
  // The rule is about what renders, not about which file it came from: a
  // finding description is as user-facing as a heading.
  const failures = [];
  for (const value of FIXTURE_PROSE) {
    const violations = copyViolations(value);
    if (violations.length) {
      failures.push(`${violations.map((v) => `"${v.word}"`).join('; ')} — ${value}`);
    }
  }
  assert.deepEqual(failures, [], `\n${failures.join('\n')}\n`);
});

test('every verdict disclosure element is present in the copy', () => {
  const disclosure = COPY.verdict.automatedDisclosure.toLowerCase();
  assert.ok(disclosure.includes('automated'), 'the disclosure must say it was automated');
  assert.ok(disclosure.includes('no human'), 'the disclosure must say no human audited it');
  // commit + blob + date + model + prompt all have their own provenance row
  for (const label of [
    COPY.verdict.provenanceCommit,
    COPY.verdict.provenanceSourceBlob,
    COPY.verdict.provenanceReviewed,
    COPY.verdict.provenanceModel,
    COPY.verdict.provenancePrompt,
  ]) {
    assert.ok(label && label.length > 0, 'a provenance row is missing its label');
  }
});

test('the illustrative banner says the data is not real', () => {
  for (const body of [COPY.illustrative.fixtureBody, COPY.illustrative.mockBody]) {
    assert.match(body, /illustrative|placeholder/i);
    // and it says what the data is not: a review of a real MCP server
    assert.match(body, /review of a real MCP server/i);
    assert.match(body, /\b(not|nothing)\b/i);
  }
  for (const label of [COPY.illustrative.fixtureLabel, COPY.illustrative.mockLabel]) {
    assert.match(label, /ILLUSTRATIVE/);
  }
});

test('fixture fingerprints are contract-shaped', () => {
  for (const [name, fp] of Object.entries(FIXTURE_FINGERPRINTS)) {
    assert.ok(isFingerprint(fp), `${name} is not a valid sxf1_ fingerprint: ${fp}`);
  }
  for (const row of FIXTURE_ROWS) {
    assert.ok(isFingerprint(row.fingerprint), `row ${row.name} has a malformed fingerprint`);
  }
});

test('every fixture record is marked illustrative', () => {
  for (const row of FIXTURE_ROWS) {
    assert.equal(row.illustrative, true, `${row.name} is not marked illustrative`);
  }
});
