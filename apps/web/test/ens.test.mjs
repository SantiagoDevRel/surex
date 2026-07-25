import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { copyViolations, STATES, unknownHead } from '@surex/core';
import { encodeAbiParameters } from 'viem';

import {
  DEFAULT_TTL_SECONDS,
  LABEL_HEX_LENGTH,
  LABEL_PREFIX,
  RECORD_KEYS,
  ensAppUrl,
  ensConfig,
  ensNameFor,
  fingerprintMatchesPrefix,
  fingerprintPrefixOf,
  labelFor,
  leftmostLabel,
  recordsFor,
  recordValue,
  signatureDigest,
} from '../lib/ens.ts';
import { COPY } from '../lib/copy.ts';

/** The flagged fixture — the one entry in the registry any model has reviewed. */
const FP = 'sxf1_b1dad32ff73fe0791aa543000695d093dec235b1af446740e81b53fcef92edb1';
const LABEL = 'sxf1-b1dad32ff73fe0791aa543000695d093dec235b1';

/* ─────────────────────────────────────────── the cross-language vector ─────*/

/**
 * The one test here that checks something no other test in either language can.
 *
 * The gateway signs what `signatureDigest()` computes; the resolver on Sepolia
 * accepts what `makeSignatureHash()` computes. They are written in different
 * languages in different packages. If they ever disagree, every lookup fails
 * `resolveWithProof` with an error that names neither side, and both suites stay
 * green while the product is completely broken.
 *
 * So the vector is asserted here AND pinned as a literal in the Solidity, and
 * this test reads that file as text to prove the two literals are the same one.
 * The same technique `copy.test.mjs` uses on `lib/world.ts`.
 */
const GOLDEN = {
  resolver: '0x1111111111111111111111111111111111111111',
  expires: 2000000000n,
  callData: '0x00112233445566778899aabbccddeeff',
  result: encodeAbiParameters([{ type: 'string' }], ['flagged']),
  digest: '0xb344ec8556d204183db10bcdac4e9d28cfbb2f81ccc401c04c3809181edff00f',
};

test('the digest matches the pinned golden vector', () => {
  assert.equal(signatureDigest(GOLDEN), GOLDEN.digest);
});

test('the Solidity pins the same golden vector', () => {
  const sol = readFileSync(new URL('../../../contracts/test/SureXOffchainResolver.t.sol', import.meta.url), 'utf8');
  assert.ok(
    sol.includes(GOLDEN.digest),
    `contracts/test/SureXOffchainResolver.t.sol must pin ${GOLDEN.digest} — the gateway and the resolver have drifted`,
  );
  assert.ok(sol.includes(GOLDEN.resolver), 'the Solidity vector must use the same resolver address');
  assert.ok(sol.includes(String(GOLDEN.expires)), 'the Solidity vector must use the same expiry');
  assert.ok(
    sol.includes(GOLDEN.callData.slice(2)),
    'the Solidity vector must use the same calldata',
  );
});

test('the digest is bound to the resolver, the expiry, the question and the answer', () => {
  const base = signatureDigest(GOLDEN);
  // Change one field at a time; every one of them must move the digest, or a
  // signature is replayable along that axis.
  assert.notEqual(signatureDigest({ ...GOLDEN, resolver: '0x2222222222222222222222222222222222222222' }), base);
  assert.notEqual(signatureDigest({ ...GOLDEN, expires: GOLDEN.expires + 1n }), base);
  assert.notEqual(signatureDigest({ ...GOLDEN, callData: '0x00112233445566778899aabbccddee00' }), base);
  assert.notEqual(
    signatureDigest({ ...GOLDEN, result: encodeAbiParameters([{ type: 'string' }], ['clean']) }),
    base,
  );
});

/* ────────────────────────────────────────────────────────── the copy law ───*/

/**
 * A text record is read completely out of context — a wallet renders it with no
 * page around it, no date, no model, no override. That is exactly where *safe*,
 * *trusted*, *verified* or *secure* would do the most damage, and AGENTS.md §4
 * binds every surface, not just the ones with a layout.
 *
 * So this walks the whole space the contract allows rather than sampling it.
 */
test('copy law holds over every record value the contract can produce', () => {
  const tiers = ['A', 'B', 'C', 'MISMATCH'];
  const reasons = [undefined, 'licence', 'source-unavailable', 'remote-endpoint'];
  let checked = 0;

  for (const state of STATES) {
    for (const tier of tiers) {
      for (const severity of [0, 1, 2, 3, 4]) {
        for (const reason of reasons) {
          const head = {
            fingerprint: FP,
            state,
            severity,
            tier,
            reason,
            reviewedAt: '2026-07-25T10:00:00.000Z',
          };
          const records = recordsFor(head, {});
          for (const [key, value] of Object.entries(records)) {
            const violations = copyViolations(value);
            assert.equal(
              violations.length,
              0,
              `record ${key}="${value}" (state=${state} tier=${tier} reason=${reason}) violates the copy law: ${JSON.stringify(violations)}`,
            );
            checked++;
          }
        }
      }
    }
  }
  // A silently empty loop would pass this test while checking nothing.
  assert.ok(checked >= STATES.length * tiers.length * 5 * reasons.length, `only ${checked} values checked`);
});

test('copy law holds over the two new UI strings', () => {
  assert.deepEqual(copyViolations(COPY.verdict.ensNote), []);
  assert.deepEqual(copyViolations(COPY.verdict.ensExample), []);
  assert.deepEqual(copyViolations(COPY.verdict.provenanceEns), []);
});

test('recordsFor throws rather than returning a banned word', () => {
  // `reason` is the only free-ish field on a head that reaches a record. If the
  // contract ever grew a reason like this, the gateway must refuse to sign it
  // rather than emit it — the runtime guard, not just the test above.
  assert.throws(
    () => recordsFor({ fingerprint: FP, state: 'clean', severity: 0, tier: 'A', reason: 'this server is safe' }, {}),
    /Copy law violated in ENS record/,
  );
});

test('no model-generated text ever reaches a record', () => {
  const head = {
    fingerprint: FP,
    state: 'flagged',
    severity: 4,
    tier: 'B',
    topFinding: { description: 'this server is trusted and secure', file: 'a.js', line: 1, severity: 4 },
    disputeSummary: 'the maintainer says it is safe',
    name: 'evil-mcp@1.0.0',
  };
  const values = Object.values(recordsFor(head, {})).join(' ');
  assert.ok(!values.includes('trusted'), 'topFinding leaked into a record');
  assert.ok(!values.includes('maintainer'), 'disputeSummary leaked into a record');
  assert.deepEqual(Object.keys(recordsFor(head, {})).sort(), [...RECORD_KEYS].sort());
});

/* ────────────────────────────────────────────────────── the signing key ────*/

test('the signing key is never read from a NEXT_PUBLIC_ variable', () => {
  // Same assertion `copy.test.mjs` makes about `lib/world.ts`, for the same
  // reason: NEXT_PUBLIC_ is compiled into the browser bundle.
  const lib = readFileSync(new URL('../lib/ens.ts', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../app/api/ens/[sender]/[data]/route.ts', import.meta.url), 'utf8');
  assert.ok(!/NEXT_PUBLIC_[A-Z_]*SIGNING/.test(lib), 'lib/ens.ts must not read a public signing key');
  assert.ok(!/NEXT_PUBLIC_[A-Z_]*SIGNING/.test(route), 'the gateway route must not read a public signing key');
  assert.ok(!/NEXT_PUBLIC_[A-Z_]*KEY/.test(lib));
});

test('ensConfig names exactly what is missing and never falls back', () => {
  const none = ensConfig({});
  assert.equal(none.ok, false);
  assert.deepEqual(none.missing, ['SUREX_ENS_RESOLVER_ADDRESS', 'SUREX_ENS_SIGNING_KEY']);

  const half = ensConfig({ SUREX_ENS_RESOLVER_ADDRESS: `0x${'11'.repeat(20)}` });
  assert.deepEqual(half.missing, ['SUREX_ENS_SIGNING_KEY']);

  const badKey = ensConfig({ SUREX_ENS_RESOLVER_ADDRESS: `0x${'11'.repeat(20)}`, SUREX_ENS_SIGNING_KEY: 'hunter2' });
  assert.equal(badKey.ok, false);
  assert.match(badKey.detail, /32-byte hex private key/);

  const badAddr = ensConfig({ SUREX_ENS_RESOLVER_ADDRESS: 'nope', SUREX_ENS_SIGNING_KEY: `0x${'22'.repeat(32)}` });
  assert.equal(badAddr.ok, false);

  const good = ensConfig({
    SUREX_ENS_RESOLVER_ADDRESS: `0x${'11'.repeat(20)}`,
    SUREX_ENS_SIGNING_KEY: `0x${'22'.repeat(32)}`,
  });
  assert.equal(good.ok, true);
  assert.equal(good.config.ttlSeconds, DEFAULT_TTL_SECONDS);

  const ttl = ensConfig({
    SUREX_ENS_RESOLVER_ADDRESS: `0x${'11'.repeat(20)}`,
    SUREX_ENS_SIGNING_KEY: `0x${'22'.repeat(32)}`,
    SUREX_ENS_TTL_SECONDS: '-5',
  });
  assert.equal(ttl.config.ttlSeconds, DEFAULT_TTL_SECONDS, 'a nonsense TTL falls back, it does not disable expiry');
});

/* ──────────────────────────────────────────────────────── the label ────────*/

test('the label round-trips as far as it honestly can', () => {
  assert.equal(labelFor(FP), LABEL);
  assert.equal(labelFor(FP).length, LABEL_PREFIX.length + LABEL_HEX_LENGTH);
  assert.equal(fingerprintPrefixOf(LABEL), FP.slice(5, 5 + LABEL_HEX_LENGTH));
  assert.ok(fingerprintMatchesPrefix(FP, fingerprintPrefixOf(LABEL)));
});

test('the label is 45 characters — under 63, and normalisable', () => {
  // FRICTION-LOG E2: ethers `dnsEncode` throws above 63 by default while viem
  // accepts far more, so anything over 63 resolves in one client and not the
  // other. 45 is under every limit measured.
  assert.equal(labelFor(FP).length, 45);
  assert.ok(labelFor(FP).length < 64);
});

test('the label prefix is a hyphen, not the fingerprint underscore', () => {
  // FRICTION-LOG E1: ENSIP-15 rejects a mid-label underscore, so `sxf1_…` is not
  // a legal label at all. If this ever reverts to `_`, every name stops resolving
  // in every normalising client.
  assert.equal(LABEL_PREFIX, 'sxf1-');
  assert.ok(!labelFor(FP).includes('_'));
});

test('anything that is not a fingerprint gets no label', () => {
  for (const bad of ['', 'sxf1_', `sxf1_${'g'.repeat(64)}`, `SXF1_${'a'.repeat(64)}`, `sxf1_${'a'.repeat(63)}`, 'nope']) {
    assert.equal(labelFor(bad), null, `labelFor(${JSON.stringify(bad)}) should be null`);
  }
});

test('anything that is not one of our labels yields no prefix', () => {
  for (const bad of ['', 'sxf1-', `sxf1-${'a'.repeat(39)}`, `sxf1-${'a'.repeat(41)}`, `sxf1-${'z'.repeat(40)}`, 'vitalik']) {
    assert.equal(fingerprintPrefixOf(bad), null, `fingerprintPrefixOf(${JSON.stringify(bad)}) should be null`);
  }
});

test('a prefix is a prefix, not a fingerprint', () => {
  const prefix = fingerprintPrefixOf(LABEL);
  // A near-miss sharing 39 of 40 characters must not match.
  const nearMiss = `sxf1_${prefix.slice(0, 39)}0${'0'.repeat(24)}`;
  assert.ok(!fingerprintMatchesPrefix(nearMiss, prefix) || nearMiss.slice(5, 45) === prefix);
  assert.ok(!fingerprintMatchesPrefix(`sxf1_${'0'.repeat(64)}`, prefix));
});

/* ────────────────────────────────────────────────────────── the name ───────*/

test('no parent configured means no name, and therefore no row', () => {
  assert.equal(ensNameFor(FP, {}), null);
  assert.equal(ensNameFor(FP, { NEXT_PUBLIC_SUREX_ENS_PARENT: '  ' }), null);
});

test('a parent configured produces the full name', () => {
  assert.equal(ensNameFor(FP, { NEXT_PUBLIC_SUREX_ENS_PARENT: 'surex.eth' }), `${LABEL}.surex.eth`);
  // A stray dot in the env var must not produce `label..surex.eth`.
  assert.equal(ensNameFor(FP, { NEXT_PUBLIC_SUREX_ENS_PARENT: '.surex.eth.' }), `${LABEL}.surex.eth`);
  assert.equal(ensNameFor('not-a-fingerprint', { NEXT_PUBLIC_SUREX_ENS_PARENT: 'surex.eth' }), null);
});

test('the explorer link points at Sepolia unless told otherwise', () => {
  assert.equal(ensAppUrl('a.surex.eth', {}), 'https://sepolia.app.ens.domains/name/a.surex.eth');
  assert.equal(
    ensAppUrl('a.surex.eth', { NEXT_PUBLIC_SUREX_ENS_CHAIN: 'mainnet' }),
    'https://app.ens.domains/name/a.surex.eth',
  );
});

/* ─────────────────────────────────────────────────────── the record table ──*/

test('the records are what a client actually gets', () => {
  const head = {
    fingerprint: FP,
    state: 'flagged',
    severity: 4,
    tier: 'B',
    reviewedAt: '2026-07-25T10:00:00.000Z',
  };
  assert.deepEqual(recordsFor(head, {}), {
    'surex:state': 'flagged',
    'surex:severity': '4',
    'surex:tier': 'B',
    'surex:reason': '',
    'surex:reviewed': '2026-07-25T10:00:00.000Z',
    'surex:fingerprint': FP,
    url: `https://arkiv-surex.vercel.app/r/${FP}`,
  });
});

test('the full fingerprint is a record, so the prefix is never the identity', () => {
  // The label carries 40 of 64 hex characters. A caller that needs certainty
  // reads this record and compares all 64 rather than trusting the name.
  assert.equal(recordValue({ fingerprint: FP, state: 'clean', severity: 0, tier: 'A' }, 'surex:fingerprint', {}), FP);
});

test('an unrecognised record key is empty, not an error', () => {
  assert.equal(recordValue({ fingerprint: FP, state: 'clean', severity: 0, tier: 'A' }, 'com.twitter', {}), '');
  assert.equal(recordValue({ fingerprint: FP, state: 'clean', severity: 0, tier: 'A' }, 'avatar', {}), '');
});

test('an unknown head degrades to unknown, never to clean', () => {
  const head = unknownHead(FP);
  assert.equal(recordsFor(head, {})['surex:state'], 'unknown');
  assert.notEqual(recordsFor(head, {})['surex:state'], 'clean');
});

/* ──────────────────────────────────────────────────── the DNS wire name ────*/

test('the leftmost label comes out of the DNS encoding', () => {
  // `\x05hello\x03eth\x00`
  assert.equal(leftmostLabel('0x0568656c6c6f0365746800'), 'hello');
});

test('a 45-character label survives the wire encoding', () => {
  const hex = Buffer.from(LABEL, 'utf8').toString('hex');
  const encoded = `0x${LABEL.length.toString(16).padStart(2, '0')}${hex}0365746800`;
  assert.equal(leftmostLabel(encoded), LABEL);
});

test('an encoded-label name is declined rather than guessed at', () => {
  // 0xfe is the ENSIP-10 form where the label is a hash. There is no prefix to
  // read out of it, and inventing one would be inventing an identity.
  assert.equal(leftmostLabel(`0xfe${'ab'.repeat(32)}00`), null);
  assert.equal(leftmostLabel('0x00'), null);
  assert.equal(leftmostLabel('0x'), null);
  // A length byte that overruns the buffer.
  assert.equal(leftmostLabel('0x0568656c'), null);
});
