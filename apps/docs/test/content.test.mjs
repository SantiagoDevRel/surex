// Content hygiene checks over this site's MDX pages. Currently one rule (AGENTS.md
// §2 and §4): the registry is written to continuously, so a hardcoded count of it in
// prose is a fabrication the moment the registry disagrees. Every number the site
// quotes about the registry must come from /v1/stats at read time.
//
//   node --test apps/docs/test/*.test.mjs

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = join(APP, 'content');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (extname(path) === '.mdx') out.push(path);
  }
  return out;
}

const pages = walk(CONTENT);

test('no registry counts are hardcoded in prose', () => {
  // Deliberately narrow. Numbers are fine — "capped at 12 entries per capability"
  // is a property of the code and does not drift. What may not appear is a count
  // of the registry, which changes every time the worker writes.
  const COUNTS = [
    /\bregistry\s+(?:currently\s+)?(?:holds|has|contains|is at)\s+[\d,]+/i,
    /\b[\d,]+\s+(?:entries|verdicts|reviews)\s+(?:on chain|in the registry|published|reviewed)\b/i,
    /\b[\d,]+\s+(?:flagged|clean|unreviewable|unknown)\s+(?:servers?|entries)\b/i,
  ];
  // The guard is tested before it is trusted: a pattern that matches nothing passes
  // every page silently.
  const MUST_CATCH = [
    'The registry holds 51 entries — 50 real servers plus our fixture.',
    'the registry currently has 1,204 entries',
    '104 verdicts published so far',
    'with 7 flagged servers and 10 unreviewable entries',
  ];
  for (const bad of MUST_CATCH) {
    assert.ok(
      COUNTS.some((re) => re.test(bad)),
      `the count guard does not catch: ${bad}`,
    );
  }
  const MUST_NOT_CATCH = [
    'Capability evidence is capped at 12 entries per capability.',
    'cache      0 entries',
    'a working laptop with 15 MCP servers across three config scopes',
  ];
  for (const fine of MUST_NOT_CATCH) {
    assert.ok(
      !COUNTS.some((re) => re.test(fine)),
      `the count guard is too broad, it catches: ${fine}`,
    );
  }

  for (const path of pages) {
    const text = readFileSync(path, 'utf8');
    for (const re of COUNTS) {
      const hit = text.match(re);
      assert.equal(
        hit,
        null,
        `${relative(APP, path)} quotes a registry count ("${hit?.[0]}"). Link to /v1/stats instead.`,
      );
    }
  }
});
