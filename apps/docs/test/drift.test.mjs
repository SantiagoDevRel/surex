// The two things on this site that can silently become false.
//
// Everything else is either computed from `@surex/core` at build time (the
// contract tables, the copy law, the block message) or is prose that ages
// gracefully. These two do not:
//
//   1. THE QUICKSTART FINGERPRINT. The whole page rests on one claim: the
//      fixture on your disk resolves to the entry the live registry serves.
//      SXF-1 identifies a local script by the CONTENT of its entry file, so
//      editing one byte of `packages/fixtures/mal-rug-pull/src/server.mjs`
//      changes the fingerprint — and the quickstart's `curl`, its expected
//      `/surex check` output and its override command all become wrong at once,
//      with nothing failing anywhere. This recomputes it from the file.
//
//   2. STATUS CLAIMS. "This is built, that is not" has no source to derive from.
//      The dispute guide shipped saying the agent was not registered in
//      AgentBook; it was true when written and false the same afternoon, and
//      the correction touched four files. They now live in
//      `components/status.tsx`, and this fails if a page states one inline
//      again — including, by name, the sentences already retracted once.
//
//   node --test apps/docs/test/drift.test.mjs

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import { canonicalise, fingerprintOf } from '@surex/core/sxf1';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(APP, '..', '..');

/** The plugin's resolver is the one the gate uses; reimplementing it here would
 *  let this test agree with itself while disagreeing with the product. */
const { localEntryResolver } = await import(
  `file:///${join(REPO, 'packages', 'plugin', 'lib', 'localentry.mjs').replace(/\\/g, '/')}`
);

const FIXTURE_ENTRY = join(REPO, 'packages', 'fixtures', 'mal-rug-pull', 'src', 'server.mjs');

/** Every source file on this site that could carry a fingerprint or a claim. */
function sources() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.next') continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (['.mdx', '.tsx', '.ts'].includes(extname(path))) out.push(path);
    }
  };
  walk(join(APP, 'content'));
  walk(join(APP, 'components'));
  walk(join(APP, 'app'));
  return out;
}

const rel = (p) => relative(APP, p).replace(/\\/g, '/');

// ── 1. the fingerprint ───────────────────────────────────────────────────────

const expected = fingerprintOf(
  canonicalise({ command: 'node', args: [FIXTURE_ENTRY] }, { hashLocalEntry: localEntryResolver(REPO) }),
);

test('the fixture still fingerprints to what the site tells people to expect', () => {
  // Not asserted against a constant in this file — that would only prove the
  // constant. Every fingerprint literal on the site has to be this one.
  const full = /sxf1_[0-9a-f]{64}/g;
  const hits = [];
  for (const path of sources()) {
    for (const m of readFileSync(path, 'utf8').matchAll(full)) hits.push({ path, fp: m[0] });
  }
  assert.ok(hits.length >= 3, `expected the fingerprint on several surfaces, found ${hits.length}`);
  for (const { path, fp } of hits) {
    assert.equal(
      fp,
      expected,
      `${rel(path)} names a fingerprint the fixture no longer has.\n` +
        `  on the page: ${fp}\n  recomputed:  ${expected}\n` +
        `  packages/fixtures/mal-rug-pull/src/server.mjs changed — update the quickstart, the agent ` +
        `prompt, components/contract.tsx and app/llms.txt/route.ts.`,
    );
  }
});

test('truncated fingerprints on the site are prefixes of the real one', () => {
  // The quickstart prints shortened forms the way the gate does. A stale prefix
  // is just as wrong as a stale fingerprint and much easier to miss.
  const short = /sxf1_[0-9a-f]{4,63}(?![0-9a-f])/g;
  for (const path of sources()) {
    for (const m of readFileSync(path, 'utf8').matchAll(short)) {
      assert.ok(
        expected.startsWith(m[0]),
        `${rel(path)} shows "${m[0]}…", which is not a prefix of ${expected}`,
      );
    }
  }
});

// ── 2. status claims ─────────────────────────────────────────────────────────

/** Sentences this site has already had to retract once. Never again inline. */
const RETRACTED = [
  { re: /\bis not registered\b/i, why: 'the agent IS registered in AgentBook — say it via STATUS.agentDispute' },
  { re: /\bhas not bridged\b/i, why: 'the World Chain bridge advanced; this was a temporary state' },
  { re: /\bnot provable yet\b/i, why: 'state it via STATUS.humanDispute so it is corrected in one place' },
];

const CLAIMANTS = [
  join(APP, 'content', 'index.mdx'),
  join(APP, 'content', 'guides', 'dispute-a-verdict.mdx'),
  join(APP, 'content', 'guides', 'submit-a-server.mdx'),
  join(APP, 'app', 'llms.txt', 'route.ts'),
];

test('no page states a retracted status inline', () => {
  // The guard is tested before it is trusted.
  for (const { re } of RETRACTED) {
    assert.ok(
      re.test('SureX’s own agent is not registered and the tree has not bridged, not provable yet'),
      `the retracted-phrase guard does not match its own example: ${re}`,
    );
  }

  for (const path of sources()) {
    // components/status.tsx is where these sentences are ALLOWED to live.
    if (rel(path) === 'components/status.tsx') continue;
    const text = readFileSync(path, 'utf8');
    for (const { re, why } of RETRACTED) {
      assert.equal(re.test(text), false, `${rel(path)} restates a retracted claim (${re.source}) — ${why}`);
    }
  }
});

test('every surface that makes a status claim reads it from components/status.tsx', () => {
  for (const path of CLAIMANTS) {
    const text = readFileSync(path, 'utf8');
    assert.match(
      text,
      /from '(\.\.\/)+components\/status(\.tsx)?'/,
      `${rel(path)} makes status claims but does not import them — a correction here would be missed`,
    );
  }
});
