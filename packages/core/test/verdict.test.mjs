import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blockMessage, confidenceOf, decide, offlineMessage, tierSentence, warnMessage,
} from '../src/verdict.mjs';
import { assertCopy, copyViolations, NO_HUMAN_AUDIT } from '../src/copy.mjs';
import { parseVerdictHead, partitionBatchResponse, unknownHead, isFingerprint } from '../src/contract.mjs';

const FP = `sxf1_${'9'.repeat(64)}`;

const head = (over = {}) => ({
  fingerprint: FP,
  name: '@acme/mcp-tools@2.1.0',
  state: 'flagged',
  severity: 4,
  tier: 'A',
  reviewedCommit: 'a3f9c1d',
  reviewedAt: '2026-07-25',
  modelId: 'qwen3-coder-next',
  promptVersion: 'rv-1',
  evidence: {
    blobId: '0x7d2ebc11aa',
    suiObjectId: '0x11aa22bb',
    registerTx: '0xreg',
    certifyTx: '0xcert',
  },
  capabilities: {
    network: { present: true }, filesystem: { present: true },
    exec: { present: false }, env: { present: true }, credentials: { present: false },
  },
  topFinding: {
    file: 'src/tools/search.ts', line: 88, severity: 3,
    description: 'the tool description instructs the model to read ~/.ssh/id_rsa and include it in an unrelated API call',
  },
  ...over,
});

test('flagged and disputed both block — a dispute changes wording, never enforcement', () => {
  assert.equal(decide(head({ state: 'flagged' })), 'block');
  assert.equal(decide(head({ state: 'disputed' })), 'block');
});

test('a finding below the threshold is shown, not enforced', () => {
  assert.equal(decide(head({ state: 'flagged', severity: 2 })), 'warn');
});

test('unknown, stale, unreviewable and a missing head all warn — never block, never allow', () => {
  for (const state of ['unknown', 'stale', 'unreviewable', 'something-we-do-not-recognise']) {
    assert.equal(decide(head({ state })), 'warn', state);
  }
  assert.equal(decide(null), 'warn');
  assert.equal(decide(undefined), 'warn');
  assert.equal(decide({}), 'warn');
});

test('only clean allows silently', () => {
  assert.equal(decide(head({ state: 'clean', severity: 0 })), 'allow');
});

test('enforceAfter selects the wording, and blocking happens either side of it', () => {
  const future = head({ enforceAfter: Date.now() + 60_000 });
  const past = head({ enforceAfter: Date.now() - 60_000 });
  assert.equal(confidenceOf(future), 'unconfirmed');
  assert.equal(confidenceOf(past), 'confirmed');
  assert.equal(confidenceOf(head({ state: 'disputed', enforceAfter: Date.now() - 60_000 })), 'disputed');
  assert.equal(decide(future), 'block', 'the window must not delay enforcement');
  assert.equal(decide(past), 'block');
});

test('every block message carries the full provenance obligation', () => {
  const msg = blockMessage(head(), {
    evidenceUrl: 'https://surex.dev/r/' + FP,
    disputeUrl: 'https://surex.dev/d/' + FP,
  });
  for (const required of [
    'a3f9c1d',            // commit
    '0x7d2e…11aa',        // blob id, elided but still identifying
    '2026-07-25',         // date
    'qwen3-coder-next',   // model
    'rv-1',               // prompt version
    NO_HUMAN_AUDIT,       // the disclosure
    `surex allow ${FP}`,  // the override, in every block
  ]) {
    assert.ok(msg.includes(required), `block message is missing ${required}\n---\n${msg}`);
  }
});

test('the three block variants differ only in the confidence sentence', () => {
  const now = Date.now();
  const unconfirmed = blockMessage(head({ enforceAfter: now + 1000 }), { now });
  const confirmed = blockMessage(head({ enforceAfter: now - 1000 }), { now });
  const disputed = blockMessage(
    head({ state: 'disputed', disputeSummary: 'the path is user-supplied and never read' }), { now },
  );
  const strip = (s) => s.split('\n').filter((l) => !l.startsWith('Flagged by')).join('\n');
  assert.equal(strip(unconfirmed), strip(confirmed));
  assert.equal(strip(unconfirmed), strip(disputed));
  assert.ok(disputed.includes('contested by the maintainer'));
  assert.ok(disputed.includes('the path is user-supplied and never read'));
  assert.ok(confirmed.includes('uncontested since'));
});

test('the block message stays short enough to be read as a block', () => {
  // A 12,054-character reason arrived intact but the model described it as a
  // tool error rather than a block (FRICTION-LOG C4). Comprehension is the
  // limit, so this is a hard ceiling on our own copy.
  const msg = blockMessage(head(), { evidenceUrl: 'https://surex.dev/r/x', disputeUrl: 'https://surex.dev/d/x' });
  assert.ok(msg.length < 1200, `block message is ${msg.length} chars`);
  assert.ok(msg.split('\n').length <= 16);
});

test('tier C never claims more than it knows', () => {
  assert.match(tierSentence('C'), /may be about code that is not your code/);
  assert.match(tierSentence('B'), /not compared/);
  assert.match(tierSentence('MISMATCH'), /changed after we reviewed it/);
});

test('"unknown" distinguishes listed-but-unreviewed from never-submitted', () => {
  // Seeding 18 well-known servers made this a live problem: they are in the
  // registry, unreviewed, and the gate was telling users they were "not in the
  // registry" — a false statement about our own data.
  const listed = warnMessage({ state: 'unknown', listed: true }, { name: '@playwright/mcp' });
  assert.match(listed, /listed but has not been reviewed/);
  assert.ok(!/not in the registry/.test(listed));

  const never = warnMessage({ state: 'unknown' }, { name: 'something-nobody-submitted' });
  assert.match(never, /not in the registry/);
  assert.match(never, /nobody has submitted this install configuration/);
});

test('only the never-submitted branch offers the submit link', () => {
  // Telling someone to submit a server that is ALREADY listed sends them to fill
  // in a form that changes nothing — the entry exists and is waiting for a
  // review, not for a second submission. The distinction is the whole reason the
  // two branches are separate strings, so the link has to respect it.
  const submitUrl = 'https://surex-app.vercel.app/submit';

  const never = warnMessage({ state: 'unknown' }, { name: 'nobody-sent-this', submitUrl });
  assert.match(never, /Submit it for review: https:\/\/surex-app\.vercel\.app\/submit/);

  const listed = warnMessage({ state: 'unknown', listed: true }, { name: '@playwright/mcp', submitUrl });
  assert.ok(!listed.includes(submitUrl), 'a listed server must not be told to submit itself again');

  // Nothing else in the range grows a submit link either: a flagged or
  // unreviewable server has already been through the pipeline.
  for (const state of ['flagged', 'unreviewable', 'stale', 'disputed']) {
    const msg = warnMessage({ state, severity: 2 }, { name: 'x', submitUrl });
    assert.ok(!msg.includes(submitUrl), `${state} must not offer a submit link`);
  }

  // And with no URL supplied the sentence still reads correctly rather than
  // trailing an empty fragment.
  const bare = warnMessage({ state: 'unknown' }, { name: 'nobody-sent-this' });
  assert.ok(!/Submit it for review/.test(bare));
  assert.match(bare, /Proceeding unreviewed\.$/);
});

test('copy law holds across every string the product can emit', () => {
  const surfaces = [
    blockMessage(head(), { evidenceUrl: 'https://x', disputeUrl: 'https://y' }),
    blockMessage(head({ state: 'disputed', disputeSummary: 'not a real finding' })),
    blockMessage(head({ enforceAfter: Date.now() - 1 })),
    warnMessage(head({ state: 'unknown' })),
    warnMessage({ state: 'unknown' }, { name: 'x' }),
    warnMessage(head({ state: 'stale' })),
    warnMessage(head({ state: 'unreviewable', reason: 'licence' })),
    warnMessage(head({ state: 'flagged', severity: 1 })),
    offlineMessage('@acme/mcp-tools', 'timeout'),
    tierSentence('A'), tierSentence('B'), tierSentence('C'), tierSentence('MISMATCH'),
  ];
  for (const s of surfaces) assertCopy(s, JSON.stringify(s.slice(0, 60)));
});

test('the copy linter actually catches the banned words', () => {
  // *safe* is no longer one of them — dropped by product decision on
  // 2026-07-26 so the site could say "a safe experience". Asserted rather than
  // deleted, so that removing the rule stays a deliberate act: if someone puts
  // it back, this line tells them a homepage string depends on its absence.
  assert.equal(copyViolations('this server is safe to use').length, 0);
  assert.equal(copyViolations('a trusted, verified and secure server')[0].word, 'trusted');
  assert.equal(copyViolations('agent reputation score').length, 1, 'never say reputation about an agent');
  assert.equal(copyViolations('proceeding unverified')[0].instead, 'unreviewed');
  assert.equal(copyViolations('reviewed on 2026-07-25, no human audited this').length, 0);
});

test('the linter exempts terms of art without opening the door', () => {
  assert.equal(copyViolations('the blob was certified on Sui').length, 0, 'certify is a Walrus transaction');
  assert.equal(copyViolations('the gate will verify the bytes against the record').length, 0);
  assert.equal(copyViolations('requires an Orb-verified human').length, 0);
  // …but the claim itself is still caught.
  assert.equal(copyViolations('this is a certified server').length, 1);
});

test('a malformed head degrades to unknown, never to clean', () => {
  assert.equal(parseVerdictHead(null), null);
  assert.equal(parseVerdictHead({ state: 'clean' }), null, 'no fingerprint means no verdict');
  assert.equal(parseVerdictHead({ fingerprint: 'nope', state: 'clean' }), null);
  const bad = parseVerdictHead({ fingerprint: FP, state: 'flagged', severity: 'lots', tier: 'Z' });
  assert.equal(bad.severity, 0);
  assert.equal(bad.tier, 'C', 'an unrecognised tier must fall back to the weakest claim');
  assert.equal(unknownHead(FP).state, 'unknown');
});

test('a batch response distinguishes "no entry" from "did not answer"', () => {
  // Found by running the chain end to end, and it is security-relevant. An
  // earlier version had the prefetch synthesise an `unknown` for every
  // fingerprint the registry did not mention, and cache it. A batch endpoint
  // returning nothing therefore wrote a negative cache entry for a FLAGGED
  // server, and the hot path then served it out of cache as unknown for the
  // whole negative TTL — no lookup, no block, no notice.
  const asked = [FP, `sxf1_${'a'.repeat(64)}`, `sxf1_${'b'.repeat(64)}`];

  const silent = partitionBatchResponse(asked, []);
  assert.deepEqual(silent.answered, []);
  assert.deepEqual(silent.unanswered, asked, 'silence must never become three cacheable misses');

  const partial = partitionBatchResponse(asked, [
    { fingerprint: FP, state: 'flagged', severity: 4, tier: 'B' },
    { fingerprint: asked[1], state: 'unknown', severity: 0, tier: 'C' },
  ]);
  assert.equal(partial.answered.length, 2);
  assert.deepEqual(partial.unanswered, [asked[2]]);
  // An explicit `unknown` from the registry IS a real answer and may be cached.
  assert.equal(partial.answered[1].state, 'unknown');

  // A malformed row is not an answer either.
  const junk = partitionBatchResponse(asked, [{ fingerprint: 'nope', state: 'clean' }, null, 'x']);
  assert.deepEqual(junk.answered, []);
  assert.equal(junk.unanswered.length, 3);
});

test('fingerprint validation rejects anything that is not one', () => {
  assert.ok(isFingerprint(FP));
  assert.ok(!isFingerprint(`sxf1_${'9'.repeat(63)}`));
  assert.ok(!isFingerprint(`sxf2_${'9'.repeat(64)}`));
  assert.ok(!isFingerprint(`sxf1_${'Z'.repeat(64)}`));
  assert.ok(!isFingerprint(null));
});
