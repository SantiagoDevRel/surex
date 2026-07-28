// The bytes a verdict points at must contain the verdict's evidence.
//
// `JSON.stringify(body, Object.keys(body).sort())` reads as a key ordering and is
// actually a recursive property allowlist: every nested object keeps only the
// properties whose names also appear at the top level, so a finding reaches the
// content-addressed store as a bare `{"severity": 2}` and the blob ID commits to it.
//
// These assertions are shaped so that implementation fails all of them.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { recordBytes } from '../src/walrus.mjs';

const decode = (bytes) => new TextDecoder().decode(bytes);
const roundTrip = (body) => JSON.parse(decode(recordBytes(body)));

/** Shaped like a real review body: the top-level keys overlap the nested ones. */
const BODY = Object.freeze({
  schema: 'surex.review/1',
  verdict: 'flagged',
  severity: 3,
  findings: [
    { file: 'src/index.js', line: 42, category: 'undeclared-network', description: 'posts to a host the README never names', severity: 3 },
    { file: 'src/util.js', line: 7, category: 'credential-access', description: 'reads ~/.ssh/id_rsa', severity: 2 },
  ],
  capabilities: { network: { present: true, evidence: ['src/index.js:42 fetch()'] } },
  withheld: { because: 'third-party', statement: 'A review ran to completion.' },
});

test('a finding survives serialisation whole', () => {
  const finding = roundTrip(BODY).findings[0];
  assert.deepEqual(
    Object.keys(finding).sort(),
    ['category', 'description', 'file', 'line', 'severity'],
    'a finding stripped to its severity is an accusation nobody can check',
  );
  assert.equal(finding.file, 'src/index.js');
  assert.equal(finding.line, 42);
  assert.match(finding.description, /README never names/);
});

test('nested objects keep every key, however deep', () => {
  const back = roundTrip(BODY);
  assert.deepEqual(back.withheld, { because: 'third-party', statement: 'A review ran to completion.' });
  assert.equal(back.capabilities.network.present, true);
  assert.deepEqual(back.capabilities.network.evidence, ['src/index.js:42 fetch()']);
});

test('a nested key that does NOT appear at the top level still survives', () => {
  // The discriminator: an array replacer lets through only nested keys that collide
  // with a top-level key.
  const back = roundTrip({ top: 1, nested: { onlyHere: 'kept', top: 2 } });
  assert.equal(back.nested.onlyHere, 'kept');
  assert.equal(back.nested.top, 2);
});

test('arrays keep their order — a findings list is a sequence, not a set', () => {
  const back = roundTrip(BODY);
  assert.equal(back.findings.length, 2);
  assert.equal(back.findings[0].file, 'src/index.js');
  assert.equal(back.findings[1].file, 'src/util.js');
});

test('the bytes are deterministic, because the blob ID is derived from them', () => {
  const a = decode(recordBytes(BODY));
  const b = decode(recordBytes(JSON.parse(JSON.stringify(BODY))));
  assert.equal(a, b);
  // Key order in the input must not change the output, or two runs of one review
  // store two blobs and the registry pays for both.
  const reordered = { severity: 3, findings: BODY.findings, verdict: 'flagged', schema: 'surex.review/1', capabilities: BODY.capabilities, withheld: BODY.withheld };
  assert.equal(decode(recordBytes(reordered)), a);
});

test('keys are sorted at every depth, and the record ends in a newline', () => {
  const text = decode(recordBytes(BODY));
  assert.ok(text.endsWith('\n'));
  assert.match(text, /"findings":\[\{"category":/, 'nested keys must be sorted too, or determinism is only skin deep');
});
