// The fixtures themselves. They are the only data four other lanes will see for
// most of the build, so they have to obey the same rules as production data:
// the copy law, the fingerprint algorithm, and the contract shapes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createApp } from '../src/app.mjs';
import { FIXTURES, MISS_FINGERPRINT } from '../src/mock.mjs';
import { assertCopy, copyViolations, fingerprint, isFingerprint, parseVerdictHead, STATES, decide } from '@surex/core';

/** Every string anywhere in an object, with a path so a failure is findable. */
function strings(value, path = '$', out = []) {
  if (typeof value === 'string') out.push({ path, value });
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) strings(v, `${path}.${k}`, out);
  }
  return out;
}

test('every fixture string obeys the copy law', () => {
  // AGENTS.md §4: never safe / trusted / verified / secure about a reviewed
  // server. The word is reviewed. Enforced on API responses too, and a fixture IS
  // an API response — it is what the gate, the web app and the demo render.
  const failures = [];
  for (const f of FIXTURES) {
    for (const { path, value } of strings(f)) {
      const violations = copyViolations(value);
      if (violations.length) failures.push(`${f.label} ${path}: ${violations.map((v) => v.word).join(', ')} — "${value.slice(0, 90)}"`);
    }
  }
  assert.deepEqual(failures, [], `copy law violations:\n${failures.join('\n')}`);
});

test('the copy law holds over ACTUAL API responses, not only over the fixtures', async () => {
  // AGENTS.md §4 binds every surface, "UI and API alike". The fixtures are only half
  // of what leaves this process — the other half is the prose the routes write
  // themselves, in error messages, notes and the dispute receipt.
  const app = createApp({
    env: {
      SUREX_MOCK: '1',
      SUREX_ADMIN_SLUG: 'copy-law-slug-long-enough',
      SUREX_REVIEWER_BASE_URL: 'http://reviewer.invalid',
      SUREX_REVIEWER_MODEL: 'demo-model',
    },
    logger: { warn() {}, info() {}, error() {} },
    fetchImpl: async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  const F = FIXTURES.find((f) => f.label === 'flagged-tier-b').fingerprint;
  const admin = app.surex.admin.path;
  const post = (path, payload) => [
    path,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) },
  ];

  const requests = [
    ['/'],
    ['/healthz'],
    [`/v1/verdict?fp=${F}`],
    [`/v1/verdict?fp=${MISS_FINGERPRINT}`],
    ['/v1/verdict'],
    ['/v1/verdict?fp=garbage'],
    [`/v1/entry/${F}`],
    [`/v1/entry/${MISS_FINGERPRINT}`],
    ['/v1/source/0xdead'],
    ['/v1/review/0xdead'],
    ['/v1/flagged'],
    ['/v1/stats'],
    ['/v1/nope'],
    post('/v1/verdicts/batch', { fps: [F, MISS_FINGERPRINT] }),
    post('/v1/verdicts/batch', { fps: 'nope' }),
    post('/v1/disputes', { fingerprint: F, agentAddress: '0xabc', evidence: 'e' }),
    post('/v1/disputes', { fingerprint: F, statement: 's' }),
    post('/v1/disputes', {}),
    post('/v1/submissions', {}),
    [admin, { method: 'POST' }],
    [admin, { method: 'POST', headers: { 'x-surex-admin-password': '123' } }],
  ];

  const failures = [];
  for (const [path, init] of requests) {
    const res = await app.request(path, init);
    const body = await res.json();
    for (const { path: at, value } of strings(body)) {
      const violations = copyViolations(value);
      if (violations.length) {
        failures.push(`${init?.method ?? 'GET'} ${path} (${res.status}) ${at}: ${violations.map((v) => v.word).join(', ')} — "${value.slice(0, 90)}"`);
      }
    }
  }
  assert.deepEqual(failures, [], `copy law violations in API responses:\n${failures.join('\n')}`);
});

test('assertCopy is actually load-bearing here (the guard would catch a regression)', () => {
  // If assertCopy silently passed everything, the test above would be theatre.
  assert.throws(() => assertCopy('This server is safe and fully verified.', 'canary'), /Copy law violated/);
  assert.throws(() => assertCopy('We guarantee it is secure.', 'canary'), /Copy law violated/);
  // And the whole fixture corpus goes through the real assertion, once, joined.
  for (const f of FIXTURES) {
    for (const { value } of strings(f)) assertCopy(value, `${f.label}`);
  }
});

test('every fixture fingerprint is the SXF-1 fingerprint of its own config', () => {
  // A hand-typed fingerprint drifts from what the gate computes, and then the gate
  // lane cannot reproduce a single fixture. Recomputed here so it cannot.
  for (const f of FIXTURES) {
    assert.ok(f.config, `${f.label} must carry the config it was fingerprinted from`);
    assert.equal(
      f.fingerprint,
      fingerprint(f.config),
      `${f.label}: fingerprint does not match fingerprint(config) — regenerate it`,
    );
    assert.ok(isFingerprint(f.fingerprint), `${f.label}: not a well-formed sxf1_ fingerprint`);
    if (f.head) assert.equal(f.head.fingerprint, f.fingerprint);
  }
});

test('the fixture set covers every state the gate has to render', () => {
  const byState = new Map(FIXTURES.filter((f) => f.head).map((f) => [f.head.state, f]));
  for (const state of STATES.filter((s) => s !== 'unknown')) {
    assert.ok(byState.has(state), `no fixture for state ${state}`);
  }
  // …plus the unknown miss, which is the absence of a row rather than a row.
  const miss = FIXTURES.find((f) => f.absent);
  assert.ok(miss, 'there must be a fixture describing the deliberate miss');
  assert.equal(miss.head, null);
  assert.equal(miss.fingerprint, MISS_FINGERPRINT);
  assert.match(miss.why, /never a block, and never a clean/);

  // The specific shapes the brief calls for.
  assert.equal(byState.get('clean').head.tier, 'A');
  assert.equal(byState.get('flagged').head.tier, 'B');
  assert.equal(byState.get('unreviewable').head.reason, 'licence');
  assert.match(byState.get('disputed').head.disputeSummary, /\S/);
  assert.ok(byState.get('disputed').dispute, 'the disputed fixture carries the dispute record');
});

test('every fixture head parses as a VerdictHead and decides the way the state says', () => {
  const expected = { clean: 'allow', flagged: 'block', disputed: 'block', stale: 'warn', unreviewable: 'warn' };
  for (const f of FIXTURES.filter((x) => x.head)) {
    const head = parseVerdictHead(f.head);
    assert.ok(head, `${f.label} must survive parseVerdictHead`);
    assert.equal(head.state, f.head.state);
    assert.equal(decide(head), expected[head.state], `${f.label} must decide ${expected[head.state]}`);
  }
});

test('a flagged or disputed head carries everything the block message needs', () => {
  // blockMessage() reads these. A head that needed a second fetch to be actionable
  // would double the latency of every tool call, so they are annotations by design.
  for (const f of FIXTURES.filter((x) => ['flagged', 'disputed'].includes(x.head?.state))) {
    const h = f.head;
    assert.ok(h.name, `${f.label}: name`);
    assert.ok(h.topFinding?.description, `${f.label}: topFinding.description`);
    assert.equal(typeof h.topFinding.severity, 'number');
    assert.ok(h.capabilities, `${f.label}: capabilities`);
    assert.ok(h.reviewedCommit, `${f.label}: reviewedCommit`);
    assert.ok(h.reviewedAt, `${f.label}: reviewedAt`);
    assert.ok(h.modelId, `${f.label}: modelId`);
    assert.ok(h.promptVersion, `${f.label}: promptVersion`);
    assert.ok(h.evidence?.blobId, `${f.label}: evidence.blobId`);
    assert.equal(typeof h.enforceAfter, 'number', `${f.label}: enforceAfter selects the block wording`);
  }
});

test('the only thing flagged is a fixture we wrote ourselves', () => {
  // AGENTS.md §4: never publicly flag a real, named third-party project on an
  // unaudited model verdict.
  for (const f of FIXTURES.filter((x) => ['flagged', 'disputed'].includes(x.head?.state))) {
    assert.match(
      f.head.name,
      /^@surex(-demo)?\//,
      `${f.label} flags "${f.head.name}" — only our own @surex/@surex-demo fixtures may ever be flagged`,
    );
  }
  // And nothing in the corpus points at a live third-party host.
  for (const f of FIXTURES) {
    for (const { path, value } of strings(f)) {
      if (!/^https?:\/\//.test(value)) continue;
      assert.match(
        value,
        /(surex-demo|surex-fixture|\.invalid)/,
        `${f.label} ${path}: ${value} — fixture URLs must point at our own demo names or .invalid`,
      );
    }
  }
});

test('no fixture identifier can be mistaken for a real on-chain artefact', () => {
  // Never fabricate: a plausible-looking blob ID or tx digest that resolves to
  // nothing is exactly the kind of claim this product exists to object to.
  const idFields = ['blobId', 'id', 'suiObjectId', 'registerTx', 'certifyTx', 'reviewedSourceBlobId', 'agentBookHumanId', 'agentAddress', 'integrity'];
  const seen = [];
  for (const f of FIXTURES) {
    for (const { path, value } of strings(f)) {
      const leaf = path.split('.').pop().replace(/\[\d+\]$/, '');
      if (!idFields.includes(leaf)) continue;
      seen.push(`${f.label} ${path}`);
      assert.match(value, /DEM0|DEMO/i, `${f.label} ${path} = "${value}" must be an obvious DEMO placeholder`);
    }
    // Entity keys too.
    for (const rec of [f.entry, ...(f.sources ?? []), ...(f.reviews ?? []), f.dispute].filter(Boolean)) {
      if (rec.key) assert.match(rec.key, /^0xDEM0/, `${f.label}: entity key ${rec.key} must be an obvious placeholder`);
    }
  }
  assert.ok(seen.length > 15, `expected to have checked many identifiers, checked ${seen.length}`);
});

test('every fixture says it is illustrative in its own file, not only in the response', () => {
  for (const f of FIXTURES) {
    assert.match(f.$note, /ILLUSTRATIVE FIXTURE/);
    assert.match(f.$note, /illustrative: true/);
    assert.match(f.$note, /never to be stripped/);
  }
});

test('src/mock.mjs imports every file in fixtures/ — a new fixture cannot be silently ignored', () => {
  const dir = fileURLToPath(new URL('../fixtures/', import.meta.url));
  const onDisk = readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
  assert.equal(
    onDisk.length,
    FIXTURES.length,
    `fixtures/ has ${onDisk.length} files (${onDisk.join(', ')}) but src/mock.mjs imports ${FIXTURES.length}`,
  );
  const labels = FIXTURES.map((f) => f.label).sort();
  assert.deepEqual(labels, onDisk.map((n) => n.replace(/\.json$/, '')).sort(), 'label must match the filename');
});
