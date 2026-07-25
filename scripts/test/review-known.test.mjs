// The three decisions in review-known.mjs that are not the model's.
//
// Each of these is load-bearing: `readability` decides whether a verdict about a
// package is meaningful at all, `selectForReview` decides what the model is even
// shown, and `assertNoThirdPartyFlags` is the thing standing between an unaudited
// model verdict and a permanent public accusation against a real project.
//
// Every test here fails if its guard is deleted — that is the point. A guard
// whose test passes with the logic removed is a comment.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readability, selectForReview, assertNoThirdPartyFlags } from '../review-known.mjs';

const src = (path, text) => ({ path, text });

// ---------------------------------------------------------------------------
// readability — is there anything here a review could be ABOUT?
// ---------------------------------------------------------------------------

test('readable source passes', () => {
  const r = readability([
    src('src/server.mjs', 'import fs from "node:fs";\n'.repeat(40)),
    src('package.json', '{"name":"x"}'),
  ]);
  assert.equal(r.readable, true);
});

test('a single-line bundle is NOT readable', () => {
  // One 6 000-character line — a bundler's output. A model reviewing this sees
  // mangled identifiers and would answer `clean` about code it did not read.
  const r = readability([src('dist/index.js', `var a=1;${'x'.repeat(6000)}`)]);
  assert.equal(r.readable, false);
  assert.match(r.reason, /bundled|minified/i);
});

test('a large file with a huge average line length is NOT readable', () => {
  // No single line over 5 000 chars, but 60 000 characters at ~400 per line:
  // the second, independent tell. Without it a bundler that wraps at 400 columns
  // would slip through.
  const line = `${'a'.repeat(399)}\n`;
  const r = readability([src('dist/bundle.js', line.repeat(150))]);
  assert.equal(r.readable, false);
});

test('minified vendor files next to real source are fine', () => {
  const r = readability([
    src('vendor/lib.min.js', `!function(){${'z'.repeat(9000)}}()`),
    src('src/index.mjs', 'export function hello() { return 1; }\n'.repeat(30)),
  ]);
  assert.equal(r.readable, true, 'one minified file must not condemn a package that also ships source');
});

test('type declarations do not make a bundled package readable', () => {
  // The shape half of npm ships: one minified bundle plus a large, tidy .d.ts.
  // Counting the declarations as source would pass the gate on a file that
  // describes types and contains no behaviour — and a review of it finds nothing
  // because there is nothing there, which reads as `clean`.
  const r = readability([
    src('dist/index.js', `!function(){${'q'.repeat(9000)}}()`),
    src('dist/index.d.ts', 'export declare function hello(name: string): string;\n'.repeat(60)),
  ]);
  assert.equal(r.readable, false);
});

test('a package with no JS or TS at all is NOT readable', () => {
  const r = readability([src('package.json', '{"name":"x"}')]);
  assert.equal(r.readable, false);
  assert.match(r.reason, /no JavaScript|no readable/i);
});

test('an almost-empty source tree is NOT readable', () => {
  const r = readability([src('index.js', 'export default 1;')]);
  assert.equal(r.readable, false, '17 characters of source cannot support a verdict');
});

// ---------------------------------------------------------------------------
// selectForReview — what the model is shown
// ---------------------------------------------------------------------------

test('package.json is kept even when the budget is already exhausted', () => {
  // The mal-postinstall lesson: the manifest is where a supply-chain attack
  // lives, and a budget that can drop it cannot see that attack class at all.
  const big = Array.from({ length: 40 }, (_, i) => src(`src/f${i}.mjs`, 'x'.repeat(20_000)));
  const { kept } = selectForReview([...big, src('package.json', '{"scripts":{"postinstall":"node evil.js"}}')]);
  assert.ok(kept.some((f) => f.path === 'package.json'), 'package.json must survive any budget');
  assert.equal(kept[0].path, 'package.json', 'and it goes first');
});

test('the budget is respected', () => {
  const files = Array.from({ length: 60 }, (_, i) => src(`src/f${i}.mjs`, 'y'.repeat(10_000)));
  const { kept, dropped, chars } = selectForReview(files);
  assert.ok(kept.length <= 24, 'file cap');
  assert.ok(chars <= 40_000, `char budget: got ${chars}`);
  assert.ok(dropped.length > 0, 'what was dropped is reported, never silently discarded');
});

test('a single-file package arrives WHOLE, not truncated to a per-file cap', () => {
  // The shape most published MCP servers actually have: one compiled entry file.
  // At a 12 000 per-file cap the model got the first 63% of server-memory's
  // 19 000-character dist/index.js — the imports and the path setup, with every
  // tool implementation cut off — and then flagged the only code it could see.
  const whole = 'const x = 1;\n'.repeat(1500); // ~19 500 chars, one file
  const { kept, chars } = selectForReview([src('package.json', '{}'), src('dist/index.js', whole)]);
  const entry = kept.find((f) => f.path === 'dist/index.js');
  assert.ok(entry, 'the entry file must be kept');
  assert.equal(entry.text.length, whole.length, 'and kept entire');
  assert.ok(chars <= 40_000);
});

test('dist/ is deprioritised when real source shipped alongside it', () => {
  const files = [
    src('dist/index.js', 'd'.repeat(11_000)),
    src('src/index.mjs', 's'.repeat(11_000)),
    src('src/tools.mjs', 't'.repeat(11_000)),
  ];
  const { kept } = selectForReview(files, { maxCharsPerFile: 12_000, maxTotalChars: 24_000, maxFiles: 10 });
  const paths = kept.map((f) => f.path);
  assert.ok(paths.includes('src/index.mjs') && paths.includes('src/tools.mjs'));
  assert.ok(!paths.includes('dist/index.js'), 'the compiled copy must not crowd out the source');
});

// ---------------------------------------------------------------------------
// the publish guard
// ---------------------------------------------------------------------------

test('publishing a flag against a third party THROWS', () => {
  assert.throws(
    () => assertNoThirdPartyFlags([{ name: '@someone/mcp', verdict: 'flagged', publish: 'clean' }]),
    /refusing to publish a flag/i,
  );
});

test('the guard catches a flag arriving through any of the three fields', () => {
  for (const row of [
    { name: 'a', verdict: 'flagged' },
    { name: 'b', publish: 'flagged' },
    { name: 'c', state: 'flagged' },
  ]) {
    assert.throws(() => assertNoThirdPartyFlags([row]), /refusing to publish a flag/i, `field of ${row.name}`);
  }
});

test('clean and unreviewable rows pass the guard untouched', () => {
  const rows = [
    { name: 'a', verdict: 'clean', publish: 'clean' },
    { name: 'b', verdict: 'unreviewable', publish: 'unreviewable' },
  ];
  assert.equal(assertNoThirdPartyFlags(rows), rows);
});

// ---------------------------------------------------------------------------
// the tarball is the one npm published
// ---------------------------------------------------------------------------

test('integrity is verified against the downloaded bytes', async () => {
  const { integrityMatches } = await import('../review-known.mjs');
  const { createHash } = await import('node:crypto');
  const bytes = Buffer.from('pretend this is a tarball');
  const good = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;

  assert.deepEqual(integrityMatches(bytes, good), { checked: true, ok: true, detail: 'sha512 matches npm' });

  const tampered = integrityMatches(Buffer.from('different bytes'), good);
  assert.equal(tampered.checked, true);
  assert.equal(tampered.ok, false, 'bytes that are not the published tarball must not pass');
  assert.match(tampered.detail, /MISMATCH/);

  // No hash published is NOT a pass — it is "nothing was checked", and the
  // difference matters when the answer is written down as provenance.
  const none = integrityMatches(bytes, null);
  assert.equal(none.checked, false);
  assert.equal(none.ok, false);
});
