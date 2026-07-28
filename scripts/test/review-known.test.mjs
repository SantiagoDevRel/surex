// The three decisions in review-known.mjs that are not the model's: `readability`
// decides whether a verdict about a package is meaningful at all, `selectForReview`
// decides what the model is even shown, and `assertNoThirdPartyFlags` stands between
// an unaudited model verdict and a permanent public accusation against a real
// project. Every test here fails if its guard is deleted.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readability, selectForReview, assertNoThirdPartyFlags } from '../review-known.mjs';

const src = (path, text) => ({ path, text });

// readability — is there anything here a review could be about?

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
  // No single line over 5 000 chars, but 60 000 characters at ~400 per line: the
  // second, independent tell, without which a bundler wrapping at 400 columns slips
  // through.
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
  // Half of npm: one minified bundle plus a large, tidy .d.ts. Counting the
  // declarations as source passes the gate on a file with no behaviour in it, and a
  // review that finds nothing there reads as `clean`.
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

// selectForReview — what the model is shown.

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
  // The shape most published MCP servers have: one compiled entry file. At a 12 000
  // per-file cap the model saw the first 63% of server-memory's 19 000-character
  // dist/index.js — imports and path setup, every tool implementation cut off — and
  // flagged the only code it could see.
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

// the publish guard.

test('publishing a flag against a third party THROWS', () => {
  assert.throws(
    () => assertNoThirdPartyFlags([{ name: '@someone/mcp', publish: 'flagged' }]),
    /refusing to publish a flag/i,
  );
});

test('the guard catches a flag in either field that decides the WRITE', () => {
  for (const row of [{ name: 'b', publish: 'flagged' }, { name: 'c', state: 'flagged' }]) {
    assert.throws(() => assertNoThirdPartyFlags([row]), /refusing to publish a flag/i, `field of ${row.name}`);
  }
});

test('a WITHHELD row passes — that is the whole point of withheld', () => {
  // Every withheld row carries `verdict: 'flagged'` by definition — that is what the
  // model said, and `withheld` is the safe thing published about it. A guard that
  // refuses on the model verdict aborts the publish on exactly the rows it exists for.
  assert.doesNotThrow(() => assertNoThirdPartyFlags([
    { name: '@someone/mcp', verdict: 'flagged', publish: 'withheld' },
  ]));
});

test('a flag may never be laundered into clean', () => {
  assert.throws(
    () => assertNoThirdPartyFlags([{ name: '@someone/mcp', verdict: 'flagged', publish: 'clean' }]),
    /never as nothing found/i,
  );
});

test('clean and unreviewable rows pass the guard untouched', () => {
  const rows = [
    { name: 'a', verdict: 'clean', publish: 'clean' },
    { name: 'b', verdict: 'unreviewable', publish: 'unreviewable' },
  ];
  assert.equal(assertNoThirdPartyFlags(rows), rows);
});

// the tarball is the one npm published.

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

  // No hash published is not a pass — it is "nothing was checked", and the
  // difference matters when the answer is written down as provenance.
  const none = integrityMatches(bytes, null);
  assert.equal(none.checked, false);
  assert.equal(none.ok, false);
});

test('type declarations never displace real source in the prompt budget', () => {
  // @monnet/mcp sent the model 23 .d.ts files out of 24 and got a severity-3 flag out
  // of a function signature. Declarations describe shapes; a review is about the
  // behaviour in the .js next to them.
  const decls = Array.from({ length: 20 }, (_, i) => src(`dist/tools/t${i}.d.ts`, 'export declare function f(): void;\n'.repeat(50)));
  const real = [src('dist/index.js', 'const x = 1;\n'.repeat(300)), src('dist/client.js', 'const y = 2;\n'.repeat(300))];
  const { kept } = selectForReview([...decls, ...real, src('package.json', '{}')]);
  const paths = kept.map((f) => f.path);
  assert.ok(paths.includes('dist/index.js'), 'the implementation must be in');
  assert.ok(paths.includes('dist/client.js'));
  assert.ok(paths.indexOf('dist/index.js') < paths.findIndex((p) => p.endsWith('.d.ts')),
    'implementation ranks ahead of declarations');
});
