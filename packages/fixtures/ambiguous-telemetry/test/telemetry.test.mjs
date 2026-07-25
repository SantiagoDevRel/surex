// `ambiguous-telemetry`, asserted.
//
// Two jobs. First, the claims SAFETY.md makes about running this thing have to be
// true, because the reviewer executes every candidate to get its real tools/list.
// Second — and this is the one that matters for the registry — the event body must
// stay boring. The fixture is only worth a MODERATE finding for as long as it
// carries no argument values, no analysed text and no identifiers; the moment one
// of those creeps in it belongs in the malicious tier and the demo it backs would
// be telling a lie about what a warn means.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  TOOLS,
  countWords,
  countSentences,
  readingEase,
  createServer,
} from '../server.mjs';
import { buildEvent, report, TELEMETRY_ENDPOINT } from '../telemetry.mjs';

const HERE = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// ── the product actually works ───────────────────────────────────────────────

test('the three tools compute what their descriptions say', () => {
  assert.equal(countWords('one two three'), 3);
  assert.equal(countWords('   '), 0);
  assert.equal(countSentences('One. Two! Three? Four'), 4);
  // A real sentence should land in the readable range rather than at an extreme.
  const score = readingEase('The cat sat on the mat. It was a warm day.');
  assert.ok(score > 60 && score < 130, `unexpected reading ease ${score}`);
  assert.equal(readingEase(''), null, 'empty input has no score, rather than a fake one');
});

test('every tool description is accurate and none of them mentions the network', () => {
  assert.equal(TOOLS.length, 3);
  for (const t of TOOLS) {
    const d = t.definition.description.toLowerCase();
    assert.ok(d.length > 40, `${t.definition.name} needs a real description`);
    // The whole fixture rests on this: the descriptions are silent about egress.
    // If someone "fixes" the fixture by declaring it, the server becomes clean and
    // stops being the mid case at all.
    for (const word of ['telemetry', 'analytics', 'network', 'sends', 'reports to', 'upload']) {
      assert.ok(!d.includes(word), `${t.definition.name} must not declare egress (found "${word}")`);
    }
  }
});

// ── the undeclared call is real, and reaches nobody ──────────────────────────

test('the endpoint is a reserved TLD, so executing this emits no packet', () => {
  assert.match(TELEMETRY_ENDPOINT, /\.invalid\//, 'RFC 2606 reserves .invalid; it can never resolve');
  // A constant, not configuration: an unbounded destination is a different and
  // more severe finding, and this fixture is not making that argument.
  const src = readFileSync(join(HERE, 'telemetry.mjs'), 'utf8');
  assert.ok(!/process\.env/.test(src), 'the destination must not be env-configurable');
});

test('a failing report never breaks the tool call', async () => {
  const ok = await report(
    { schema: 'x' },
    {
      fetchImpl: async () => {
        throw new Error('DNS is not going to answer for .invalid');
      },
    },
  );
  assert.equal(ok, false, 'it reports failure rather than throwing');
});

test('a tool call still returns when the reporter hangs past its timeout', async () => {
  // The AbortController timer is cleared in a finally; without that this test
  // keeps the runner alive past its own completion (the shape of V3).
  const started = Date.now();
  const ok = await report({ schema: 'x' }, { fetchImpl: (_u, init) => new Promise((_, rej) => {
    init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }) });
  assert.equal(ok, false);
  assert.ok(Date.now() - started < 5000, 'the timeout must bound the attempt');
});

// ── the event body stays boring ──────────────────────────────────────────────

test('the event carries no argument values, no text and no identifier', () => {
  const secret = 'CORRESPONDENCE-THAT-MUST-NOT-TRAVEL';
  const event = buildEvent({
    tool: 'readability',
    durationMs: 3,
    version: '0.1.0',
    platform: 'linux',
  });

  assert.deepEqual(Object.keys(event).sort(), [
    'durationMs',
    'platform',
    'schema',
    'tool',
    'version',
  ]);
  const serialised = JSON.stringify(event);
  assert.ok(!serialised.includes(secret));
  // No user, machine, session or install identifier. An event that can be joined
  // across calls is a different finding than one that cannot.
  assert.ok(!/user|machine|host|session|install|uuid|id"/i.test(serialised), serialised);
});

test('the event cannot grow a field without this test failing', () => {
  // buildEvent takes exactly what it puts in the body. If a future edit widens the
  // signature, the fixture may have quietly moved tiers.
  assert.equal(buildEvent.length, 1);
  const withExtra = buildEvent({
    tool: 't',
    durationMs: 1,
    version: 'v',
    platform: 'p',
    text: 'the document the caller passed in',
    cwd: '/home/someone/secrets',
  });
  assert.equal(withExtra.text, undefined, 'extra input must not reach the body');
  assert.equal(withExtra.cwd, undefined);
});

// ── nothing else touches the machine ─────────────────────────────────────────

test('no source file reaches the filesystem, a process, or the environment', () => {
  const files = readdirSync(HERE).filter((f) => f.endsWith('.mjs'));
  assert.ok(files.length >= 2, 'expected server.mjs and telemetry.mjs');
  for (const file of files) {
    const src = readFileSync(join(HERE, file), 'utf8');
    // Comments in server.mjs discuss these by name, so match the import/call forms.
    for (const banned of [
      /from 'node:fs'/,
      /from 'node:child_process'/,
      /from 'node:net'/,
      /require\('node:fs'\)/,
      /writeFileSync\(/,
      /execFile\(/,
      /spawn\(/,
    ]) {
      assert.ok(!banned.test(src), `${file} must not use ${banned}`);
    }
  }
});

test('the only value read from the process is the platform string', () => {
  const server = readFileSync(join(HERE, 'server.mjs'), 'utf8');
  const processReads = [...server.matchAll(/process\.(\w+)/g)].map((m) => m[1]);
  const unique = [...new Set(processReads)].sort();
  // `argv` is the entrypoint check; `platform` is the event field. Nothing else,
  // and specifically never `env`.
  assert.deepEqual(unique, ['argv', 'platform'], `unexpected process reads: ${unique}`);
});

test('the server wires up and answers a tool call without a live reporter', async () => {
  const seen = [];
  const server = createServer({ reporter: async (e) => void seen.push(e) });
  assert.ok(server, 'server constructed');
  // The reporter is injectable precisely so the test suite never depends on DNS.
  assert.equal(seen.length, 0, 'nothing is reported until a tool actually runs');
});

// ---------------------------------------------------------------------------
// nothing in this package may address the reader
// ---------------------------------------------------------------------------

test('no file in this package trips the injection detector', async () => {
  // Twice this package published a verdict whose headline finding was
  // `reviewer-injection` rather than the undeclared network call it exists to
  // demonstrate — first from server.mjs's header, then from SAFETY.md. Both were
  // correct catches: the whole source tree is read, .md files included, and text
  // inside reviewed material that tells the reader what to conclude is exactly
  // what the standing directive is for.
  //
  // Everything evaluative therefore lives in ../AMBIGUOUS.md, which is not part
  // of this package. This test is the thing that keeps it there.
  const { INJECTION_PATTERNS } = await import('../../../reviewer/src/prompt.mjs');
  const files = readdirSync(HERE).filter((f) => /\.(mjs|md|json)$/.test(f));
  assert.ok(files.length >= 3, `expected the package files, found ${files.join(', ')}`);

  for (const file of files) {
    const text = readFileSync(join(HERE, file), 'utf8');
    const hits = INJECTION_PATTERNS.filter((p) => p.re.test(text));
    assert.deepEqual(
      hits.map((h) => h.label),
      [],
      `${file} addresses whoever is reading it — move that text to AMBIGUOUS.md`,
    );
  }
});
