// The copy law, over this site.
//
// AGENTS.md §4: never *safe*, *trusted*, *verified* or *secure* about a reviewed
// server — the word is **reviewed** — and never *reputation* about anything
// agent-shaped. The rule already runs over the reviewer's strings, the API
// fixtures and the web app. A documentation site is the surface most likely to
// reach for a comfortable adjective, so it runs here too.
//
//   node --test apps/docs/test/*.test.mjs
//
// A page that genuinely has to NAME a banned word — the copy-law page, the agent
// prompts — renders it from `BANNED` in a component rather than typing it into
// MDX. The checker cannot tell a quoted rule from a claim, which is the correct
// trade for a checker whose job is to catch the claim.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import { copyViolations } from '@surex/core/copy';

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

test('there are pages to check', () => {
  assert.ok(pages.length >= 14, `expected the full page set, found ${pages.length}`);
});

for (const path of pages) {
  test(`copy law · ${relative(APP, path).replace(/\\/g, '/')}`, () => {
    const violations = copyViolations(readFileSync(path, 'utf8'));
    assert.deepEqual(
      violations,
      [],
      violations.map((v) => `"${v.word}" → use ${v.instead}\n    …${v.context}…`).join('\n'),
    );
  });
}

// The banned words must reach the reader somewhere, or the copy-law page is
// describing a rule it never states. They are rendered from `BANNED`, so this
// asserts the component still does that rather than having quietly become prose.
test('the copy-law page renders the banned list rather than listing it', () => {
  const page = readFileSync(join(CONTENT, 'concepts', 'copy-law.mdx'), 'utf8');
  assert.match(page, /<BannedWords \/>/, 'the page must render the list from @surex/core');
  const component = readFileSync(join(APP, 'components', 'copy-law.tsx'), 'utf8');
  assert.match(component, /from '@surex\/core\/copy'/, 'the component must read the law, not restate it');
});

// AGENTS.md §2 and §4: a count on a page is a fabrication the moment the registry
// disagrees, and the registry is written to continuously. Every number the site
// quotes about the registry must come from /v1/stats at read time.
test('no registry counts are hardcoded in prose', () => {
  // Deliberately narrow. Numbers are fine — "capped at 12 entries per capability"
  // is a property of the code and does not drift. What may not appear is a count
  // OF THE REGISTRY, which changes every time the worker writes.
  const COUNTS = [
    /\bregistry\s+(?:currently\s+)?(?:holds|has|contains|is at)\s+[\d,]+/i,
    /\b[\d,]+\s+(?:entries|verdicts|reviews)\s+(?:on chain|in the registry|published|reviewed)\b/i,
    /\b[\d,]+\s+(?:flagged|clean|unreviewable|unknown)\s+(?:servers?|entries)\b/i,
  ];
  // The guard is tested before it is trusted. A pattern that matches nothing
  // passes every page silently, which is the failure mode of every rule like
  // this one.
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
