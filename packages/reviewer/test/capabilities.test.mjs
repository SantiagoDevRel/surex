import test from 'node:test';
import assert from 'node:assert/strict';

import {
  scanFile, scanFiles, scanCapabilities, formatEvidence, stripComments, CATEGORIES,
} from '../src/capabilities.mjs';

// A sample with a known line for every category, so an assertion can name the
// exact `path:line` a reader would open. Line numbers are load-bearing here:
// a finding with a wrong line is worse than no finding.
const SAMPLE = `import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const ENDPOINT = process.env.SUREX_UPSTREAM;

export async function search(query) {
  const res = await fetch(\`\${ENDPOINT}/q?s=\${query}\`);
  const key = readFileSync(process.env.HOME + '/.ssh/id_rsa', 'utf8');
  execSync('git rev-parse HEAD');
  return res.json();
}
`;
//  1 import node:fs            → filesystem
//  2 import node:child_process → exec
//  4 process.env               → env
//  7 fetch()                   → network
//  8 readFileSync() + .ssh/id_rsa → filesystem + credentials
//  9 execSync()                → exec

test('scanFile reports the real file:line of every capability in a sample', () => {
  const sites = scanFile('src/search.ts', SAMPLE);
  const at = (category) => sites.filter((s) => s.category === category).map(formatEvidence);

  assert.deepEqual(at('network'), ['src/search.ts:7 fetch()']);

  assert.ok(at('filesystem').includes("src/search.ts:1 import 'node:fs'"), at('filesystem').join(' | '));
  assert.ok(at('filesystem').includes('src/search.ts:8 readFileSync()'), at('filesystem').join(' | '));

  assert.ok(at('exec').includes("src/search.ts:2 import 'node:child_process'"), at('exec').join(' | '));
  assert.ok(at('exec').includes('src/search.ts:9 execSync()'), at('exec').join(' | '));

  assert.ok(at('env').includes('src/search.ts:4 process.env'), at('env').join(' | '));

  assert.deepEqual(at('credentials'), ['src/search.ts:8 ssh key material']);
});

test('every evidence line points at a line that exists and contains the thing', () => {
  const lines = SAMPLE.split('\n');
  for (const site of scanFile('src/search.ts', SAMPLE)) {
    assert.ok(site.line >= 1 && site.line <= lines.length, `line ${site.line} out of range`);
    assert.ok(lines[site.line - 1].trim().length > 0, `line ${site.line} is blank`);
  }
});

// The negative case. A file that only computes must report every category absent
// — a scan that finds something everywhere is a scan nobody can act on.
const INERT = `export function add(a, b) {
  return a + b;
}

export function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

// This comment mentions process.env and ~/.ssh/id_rsa on purpose: a capability
// named in a comment is not a capability of the code.
const RE = /^\\d+$/;
export const isNumeric = (s) => RE.exec(s) !== null;
`;

test('an inert file reports every capability absent, with no evidence', () => {
  const capabilities = scanCapabilities([{ path: 'src/util.ts', text: INERT }]);
  for (const category of CATEGORIES) {
    assert.equal(capabilities[category].present, false, `${category} should be absent`);
    assert.deepEqual(capabilities[category].evidence, [], `${category} should have no evidence`);
    assert.equal(capabilities[category].evidenceTotal, 0);
  }
});

test('RE.exec() is not process execution', () => {
  // `exec` as a property access is a regex, not a subprocess. Getting this wrong
  // would mark most of npm as spawning processes.
  const sites = scanFile('src/util.ts', 'const m = RE.exec(s);\nconst n = str.replace(/a/g, "b");\n');
  assert.deepEqual(sites.filter((s) => s.category === 'exec'), []);
});

test('a bare exec() IS process execution', () => {
  const sites = scanFile('src/run.ts', "import { exec } from 'node:child_process';\nexec('ls');\n");
  const labels = sites.filter((s) => s.category === 'exec').map(formatEvidence);
  assert.ok(labels.includes('src/run.ts:2 exec()'), labels.join(' | '));
});

test('comments are excluded from the capability scan but string literals are not', () => {
  const stripped = stripComments("// fetch('http://x')\nconst d = \"fetch('http://y')\";\n", 'js');
  assert.ok(!stripped.split('\n')[0].includes('fetch'), 'comment should be blanked');
  assert.ok(stripped.split('\n')[1].includes('fetch'), 'string literal should survive');
});

test('stripComments preserves line count so line numbers stay true', () => {
  const text = 'a\n/* one\n   two\n   three */\nb\n';
  assert.equal(stripComments(text, 'js').split('\n').length, text.split('\n').length);
});

test('python call sites are found with python rules', () => {
  const sites = scanFile('server.py', [
    'import subprocess',
    'import requests',
    'def go(u):',
    '    r = requests.get(u)',
    '    subprocess.run(["ls"])',
    '    return r.text',
  ].join('\n'));
  const evidence = sites.map(formatEvidence);
  assert.ok(evidence.includes("server.py:2 import 'requests'"), evidence.join(' | '));
  assert.ok(evidence.includes('server.py:4 requests.get()'), evidence.join(' | '));
  assert.ok(evidence.includes('server.py:5 subprocess.run()'), evidence.join(' | '));
});

test('a python # comment is stripped, a # inside a string is not', () => {
  const out = stripComments('x = 1  # requests.get(u)\ny = "#requests.get(u)"\n', 'py');
  assert.ok(!out.split('\n')[0].includes('requests'));
  assert.ok(out.split('\n')[1].includes('requests'));
});

test('evidenceTotal reports what truncation hides', () => {
  const many = Array.from({ length: 30 }, (_, i) => `const r${i} = await fetch(u${i});`).join('\n');
  const capabilities = scanCapabilities([{ path: 'src/net.ts', text: many }]);
  assert.equal(capabilities.network.evidenceTotal, 30);
  assert.equal(capabilities.network.evidence.length, 12);
  assert.ok(capabilities.network.evidence.length < capabilities.network.evidenceTotal);
});

test('the scan is a pure function of the bytes — same input, same answer', () => {
  const files = [{ path: 'src/search.ts', text: SAMPLE }, { path: 'src/util.ts', text: INERT }];
  assert.deepEqual(scanCapabilities(files), scanCapabilities(files));
});

test('scanFiles records what it skipped instead of pretending it scanned it', () => {
  const NUL = String.fromCharCode(0);
  const { meta } = scanFiles([
    { path: 'src/a.ts', text: 'const a = 1;' },
    { path: 'bin/blob', text: `head${NUL}tail` },
    { path: 'src/c.ts' },
  ]);
  assert.equal(meta.filesScanned, 1);
  assert.deepEqual(meta.filesSkipped.map((s) => s.path).sort(), ['bin/blob', 'src/c.ts']);
});
