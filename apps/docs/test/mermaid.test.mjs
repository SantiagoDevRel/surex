// Every Mermaid diagram on this site actually parses. Diagrams render client-side,
// so a syntax error does not fail the build and never shows up in the prerendered
// HTML — it becomes a red error box in the reader's browser.
//
//   node --test apps/docs/test/mermaid.test.mjs
//
// In Node, `dompurify` reports `isSupported: false` and exposes no `addHook`, which
// mermaid's flowchart path calls on first use — every flowchart then fails with
// `DOMPurify.addHook is not a function`, which reads exactly like a syntax error and
// is not one. Importing dompurify first and adding the no-ops to that singleton
// fixes it: ESM hands mermaid the same module instance. The stub only makes the
// sanitiser inert; the grammar is the real thing.

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

/** Every ```mermaid fence in the site, with where it came from. */
function diagrams() {
  const found = [];
  for (const path of walk(CONTENT)) {
    const text = readFileSync(path, 'utf8');
    const re = /```mermaid\r?\n([\s\S]*?)```/g;
    let m;
    let i = 0;
    while ((m = re.exec(text))) {
      found.push({ where: `${relative(APP, path).replace(/\\/g, '/')}#${++i}`, chart: m[1] });
    }
  }
  return found;
}

const all = diagrams();

test('the site still has its diagrams', () => {
  // The five: gate decision flow, review+write pipeline, verdict/tier matrix,
  // dispute flow, and where things run.
  assert.ok(all.length >= 5, `expected at least 5 mermaid diagrams, found ${all.length}`);
});

const parsed = await (async () => {
  try {
    const dompurify = (await import('dompurify')).default;
    if (typeof dompurify.addHook !== 'function') dompurify.addHook = () => {};
    if (typeof dompurify.removeHook !== 'function') dompurify.removeHook = () => {};
    if (typeof dompurify.sanitize !== 'function') dompurify.sanitize = (s) => s;
    const { default: mermaid } = await import('mermaid');
    return mermaid;
  } catch (err) {
    return { unavailable: err.message };
  }
})();

test('mermaid is available to parse with', () => {
  assert.ok(!parsed.unavailable, `could not load mermaid: ${parsed.unavailable}`);
});

for (const { where, chart } of all) {
  test(`mermaid parses · ${where}`, async () => {
    if (parsed.unavailable) return;
    await assert.doesNotReject(
      () => parsed.parse(chart),
      (err) => {
        throw new Error(`${where} does not parse:\n${err?.message ?? err}\n\n${chart}`);
      },
    );
  });
}
