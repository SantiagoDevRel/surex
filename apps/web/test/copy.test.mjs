/**
 * The copy law, over every string the site can render.
 *
 * AGENTS.md §4 makes the law binding on every surface. `copy.mjs` in
 * `@surex/core` makes it executable. This file is what connects the two for the
 * web app: it walks `lib/copy.ts` and `lib/fixtures.ts` leaf by leaf and runs
 * each string through `copyViolations()`, so a banned word fails here instead
 * of shipping.
 *
 * Run: node --test apps/web/test/
 *
 * The `.ts` imports are deliberate — Node 22 strips types, so the law is
 * testable with no build step between writing a string and checking it.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { assertCopy, copyViolations, isFingerprint } from '@surex/core';

import { COPY } from '../lib/copy.ts';
import { FIXTURE_FINGERPRINTS, FIXTURE_PROSE, FIXTURE_ROWS } from '../lib/fixtures.ts';
import {
  DEFAULT_WORLD_CREDENTIAL,
  WORLD_ACTIONS,
  WORLD_CREDENTIALS,
  disputeSignal,
  evidenceHashOf,
  normaliseRepo,
  submitSignal,
  worldConfig,
} from '../lib/world.ts';

/** Every string leaf, with the path that leads to it, so a failure names itself. */
function leaves(node, path = '') {
  if (typeof node === 'string') return [[path, node]];
  if (Array.isArray(node)) return node.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  }
  return [];
}

const COPY_LEAVES = leaves(COPY);

test('lib/copy.ts exposes strings to check', () => {
  // Guards against the test silently passing over an empty or reshaped module.
  assert.ok(COPY_LEAVES.length > 100, `expected >100 strings, found ${COPY_LEAVES.length}`);
});

test('every string in lib/copy.ts obeys the copy law', () => {
  const failures = [];
  for (const [path, value] of COPY_LEAVES) {
    const violations = copyViolations(value);
    if (violations.length) {
      failures.push(
        `${path}: ${violations.map((v) => `"${v.word}" → use ${v.instead}`).join('; ')}\n    ${value}`,
      );
    }
  }
  assert.deepEqual(failures, [], `\n${failures.join('\n')}\n`);
});

test('assertCopy() also passes on the whole module, concatenated', () => {
  // Belt and braces: catches a violation that only forms across a sentence
  // boundary the per-leaf pass happens to split.
  assertCopy(COPY_LEAVES.map(([, v]) => v).join('\n'), 'apps/web/lib/copy.ts');
});

test('the word is "reviewed" — and the site actually uses it', () => {
  const all = COPY_LEAVES.map(([, v]) => v)
    .join(' ')
    .toLowerCase();
  assert.ok(all.includes('reviewed'), 'the copy never says "reviewed"');
});

test('fixture prose obeys the copy law too', () => {
  // The rule is about what renders, not about which file it came from: a
  // finding description is as user-facing as a heading.
  const failures = [];
  for (const value of FIXTURE_PROSE) {
    const violations = copyViolations(value);
    if (violations.length) {
      failures.push(`${violations.map((v) => `"${v.word}"`).join('; ')} — ${value}`);
    }
  }
  assert.deepEqual(failures, [], `\n${failures.join('\n')}\n`);
});

test('every verdict disclosure element is present in the copy', () => {
  const disclosure = COPY.verdict.automatedDisclosure.toLowerCase();
  assert.ok(disclosure.includes('automated'), 'the disclosure must say it was automated');
  assert.ok(disclosure.includes('no human'), 'the disclosure must say no human audited it');
  // commit + blob + date + model + prompt all have their own provenance row
  for (const label of [
    COPY.verdict.provenanceCommit,
    COPY.verdict.provenanceSourceBlob,
    COPY.verdict.provenanceReviewed,
    COPY.verdict.provenanceModel,
    COPY.verdict.provenancePrompt,
  ]) {
    assert.ok(label && label.length > 0, 'a provenance row is missing its label');
  }
});

test('the tier legend states all three meanings, and is the only tier wording on the registry', () => {
  const { tierLegendA, tierLegendB, tierLegendC, tierLegendLabel } = COPY.browse;

  // Each letter says what it means, in the terms design/tokens.html §05 uses:
  // A is the digest match, B is a version string only, C is nothing checked.
  assert.match(tierLegendLabel, /TIER/);
  assert.match(tierLegendA, /reviewed bytes are the installed bytes/i);
  assert.match(tierLegendA, /digest/i);
  assert.match(tierLegendB, /same version string/i);
  assert.match(tierLegendB, /never compared|not compared/i);
  assert.match(tierLegendC, /nothing was checked/i);
  assert.match(tierLegendC, /not your code/i);

  // C must not read as a weaker A. It is the absence of a check, and the sentence
  // has to carry that or the whole tier column is decorative.
  assert.ok(!/match/i.test(tierLegendC), 'tier C must not claim any kind of match');

  // ONE wording per letter on this screen. The footer gloss that used to say
  // "▮▮▮ A digest match · ▮▮ B pinned · ▮ C unpinned or remote" is gone; if it
  // comes back, two vocabularies describe the same three cells again.
  assert.equal(
    COPY.browse.meterLegend,
    undefined,
    'the footer tier gloss is superseded by the legend above the table — do not reintroduce a second wording',
  );
  const browseTierStrings = Object.entries(COPY.browse)
    .filter(([k]) => /^tierLegend[ABC]$/.test(k))
    .map(([, v]) => v);
  assert.equal(new Set(browseTierStrings).size, 3, 'the three tier sentences must be distinct');
});

test('the illustrative banner says the data is not real', () => {
  for (const body of [COPY.illustrative.fixtureBody, COPY.illustrative.mockBody]) {
    assert.match(body, /illustrative|placeholder/i);
    // and it says what the data is not: a review of a real MCP server
    assert.match(body, /review of a real MCP server/i);
    assert.match(body, /\b(not|nothing)\b/i);
  }
  for (const label of [COPY.illustrative.fixtureLabel, COPY.illustrative.mockLabel]) {
    assert.match(label, /ILLUSTRATIVE/);
  }
});

test('fixture fingerprints are contract-shaped', () => {
  for (const [name, fp] of Object.entries(FIXTURE_FINGERPRINTS)) {
    assert.ok(isFingerprint(fp), `${name} is not a valid sxf1_ fingerprint: ${fp}`);
  }
  for (const row of FIXTURE_ROWS) {
    assert.ok(isFingerprint(row.fingerprint), `row ${row.name} has a malformed fingerprint`);
  }
});

test('every fixture record is marked illustrative', () => {
  for (const row of FIXTURE_ROWS) {
    assert.equal(row.illustrative, true, `${row.name} is not marked illustrative`);
  }
});

/* ─────────────────────────────────────────────────────────── the World lane ──*/

test('the signal formulas match the API, byte for byte', () => {
  // ⚠️ THE SAME VECTORS ARE PINNED IN apps/api/test/world.test.mjs.
  //
  // The browser has to choose a signal before a proof exists; the API recomputes it
  // from the request afterwards and refuses a proof bound to anything else. So the
  // formula lives in two packages, and if either side drifts the demo dies with a
  // signal_mismatch that looks like a World bug. It has to break a test instead.
  assert.equal(disputeSignal('k', 'e'), 'b5f67945e835eb5b6e7f68bce9590a7eed867341b0155dcaa1679dfa22238ad9');
  assert.equal(submitSignal('https://github.com/acme/acme-mcp'), 'f65c55b952154a9e743b0d92f05ce944f9d888dc1d47f9cb323da43e35eec6e9');
  assert.equal(evidenceHashOf('e'), '3f79bb7b435b05321651daefd374cdc681dc06faa65e374e38337b88ca046dea');
  assert.equal(normaliseRepo('https://GitHub.com/Acme/acme-mcp.git/'), 'github.com/acme/acme-mcp');
  // The COMPOSITION, which is what the route actually computes — and the thing that
  // disagreed first in testing. Read out of the live route on 2026-07-25 and pinned
  // identically in the API suite; matching leaves do not imply matching pipelines.
  assert.equal(
    disputeSignal('k', evidenceHashOf('e')),
    '7ea73226509bede9017b5b765048fe654cdf554e3198e543f7e968bf60d50b46',
  );
  // one rebuttal, one signal
  assert.notEqual(disputeSignal('k', evidenceHashOf('a')), disputeSignal('k', evidenceHashOf('b')));
  // and the two actions are the ones the API expects
  assert.deepEqual({ ...WORLD_ACTIONS }, { submit: 'maintainer-submit', dispute: 'contest-verdict' });
});

test('an unconfigured relying party is reported, never faked', () => {
  const missing = worldConfig({});
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missing, ['NEXT_PUBLIC_WORLD_APP_ID', 'NEXT_PUBLIC_WORLD_RP_ID', 'RP_SIGNING_KEY']);
  assert.match(missing.detail, /developer\.world\.org/);

  // a malformed id is caught here rather than by the live endpoint
  assert.equal(worldConfig({ NEXT_PUBLIC_WORLD_APP_ID: 'nope', NEXT_PUBLIC_WORLD_RP_ID: 'rp_x', RP_SIGNING_KEY: 'k' }).ok, false);
  assert.equal(worldConfig({ NEXT_PUBLIC_WORLD_APP_ID: 'app_x', NEXT_PUBLIC_WORLD_RP_ID: 'nope', RP_SIGNING_KEY: 'k' }).ok, false);

  const ok = worldConfig({ NEXT_PUBLIC_WORLD_APP_ID: 'app_x', NEXT_PUBLIC_WORLD_RP_ID: 'rp_x', RP_SIGNING_KEY: 'k' });
  assert.equal(ok.ok, true);
  assert.equal(ok.config.environment, 'production', 'the default must be production, so staging is always deliberate');
});

test('the signing key is never exposed to the browser', () => {
  // A NEXT_PUBLIC_ prefix on the signing key would ship it in the JS bundle, and
  // whoever has it can forge proof requests in SureX's name.
  const source = readFileSync(new URL('../lib/world.ts', import.meta.url), 'utf8');
  assert.ok(!/NEXT_PUBLIC_[A-Z_]*SIGNING/.test(source), 'the signing key must not be read from a NEXT_PUBLIC_ variable');
  assert.match(source, /env\.RP_SIGNING_KEY/);
  for (const file of ['../app/_components/WorldIdProof.tsx', '../app/_components/StandingPanels.tsx', '../app/_components/SubmitForm.tsx']) {
    const client = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.ok(client.includes("'use client'"), `${file} should be a client component`);
    assert.ok(!/RP_SIGNING_KEY|signRequest/.test(client), `${file} must not touch the signing key or sign anything`);
    assert.ok(!/lib\/world/.test(client), `${file} must not import the server-only World helpers`);
  }
});

test('the World copy holds the two distinctions it exists for', () => {
  // A proof in the browser is not an accepted claim. This used to be a four-line
  // banner and is now one line plus a disclosure — the SHORT one is the one always
  // on screen, so it is the one that has to carry the distinction. Compressing
  // this was allowed; letting it become implicit is what the assertion prevents.
  assert.match(COPY.world.heldShort, /NOT SEEN|NOT YET/i);
  assert.match(COPY.world.heldBody, /not acceptance/i);
  // …and the disclosure is labelled with what is behind it, not "more".
  assert.match(COPY.world.heldWhy, /acceptance/i);
  // a non-production proof is not a person
  assert.match(COPY.world.simulatedLabel, /NOT A PERSON/i);
  assert.match(COPY.world.simulatedBody, /simulator/i);
  // an unconfigured deployment says so instead of behaving as though it worked
  assert.match(COPY.world.unconfiguredBody, /nothing was sent/i);
});

test('nothing agent-shaped is described as reputation, a score, or past behaviour', () => {
  // The World track excludes agent reputation explicitly, so this is a
  // track-disqualifying word and the ban is enforced beyond the generic copy law.
  const agentCopy = Object.entries(COPY.dispute)
    .filter(([k]) => k.toLowerCase().includes('agent') || k === 'standingNote')
    .map(([, v]) => v)
    .join('\n');
  for (const banned of [/\breputation/i, /\bscore\b/i, /\bcall volume\b/i, /\btrack record\b/i, /\bhistory of\b/i]) {
    // "not a score" and "says nothing about how this agent has behaved" are the
    // approved way to raise these — so only an affirmative use is a failure.
    const match = agentCopy.match(banned);
    if (!match) continue;
    const sentence = agentCopy.split(/\n|(?<=[.;])\s/).find((s) => banned.test(s)) ?? '';
    assert.match(sentence, /\bnot\b|\bnothing\b/i, `agent copy claims ${match[0]}: "${sentence}"`);
  }
  // and it states positively what standing does mean
  assert.match(COPY.dispute.standingNote, /a human registered this wallet/i);
});

test('the agent panel never promises a browser button that cannot work', () => {
  assert.match(COPY.dispute.agentAction, /not in this browser/i);
  // …and it tells the truth about the two refusals
  assert.match(COPY.dispute.agentRefusedNote, /403 agent_not_human_backed/);
  assert.match(COPY.dispute.agentRefusedNote, /503/);
  assert.match(COPY.dispute.agentRefusedNote, /never told/i);
});

test('each credential copy states its OWN bar, and Face Check is never sold as uniqueness', () => {
  // The three credentials this app can request do not prove the same thing, and
  // the default is now the weakest-but-one. World's own docs are the authority:
  //   Orb / proofOfHuman   → "strong sybil resistance or one-human-one-action"
  //   selfieCheckLegacy    → "lower-friction liveness or bot deterrence",
  //                          sybil resistance rated "some", "not as strong as Orb"
  //   deviceLegacy         → an account; no biometric at all
  // → https://docs.world.org/world-id/idkit/credentials
  const { face, orb, device } = COPY.world.credential;

  // `short` is the line that is ALWAYS on screen — beside the World step of the
  // flow, and again at the button. `body` is the same claim in full, one
  // disclosure away. The short one carries the weight, so it is asserted first.
  assert.match(face.short, /live person|liveness/i);
  assert.ok(
    !/\bunique\b/i.test(`${face.short} ${face.body}`),
    'Face Check must not be described as uniqueness',
  );
  // Face Check says liveness, says where the camera actually opens, and says what
  // it does NOT establish. Losing that last sentence is how this becomes a lie.
  assert.match(face.body, /live face|liveness/i);
  assert.match(face.body, /camera/i);
  assert.match(face.body, /does not establish/i);

  // The Orb is the only one allowed to make the strong claim.
  assert.match(orb.short, /Orb/);
  assert.match(orb.body, /Orb/);
  assert.match(orb.body, /cannot come back as somebody else/i);

  // Device level says the quiet part: nothing biometric was checked.
  assert.match(device.short, /nothing biometric is checked/i);
  assert.match(device.body, /nothing biometric is checked/i);

  assert.equal(new Set([face.body, orb.body, device.body]).size, 3, 'the three credentials must not share wording');
  assert.equal(new Set([face.short, orb.short, device.short]).size, 3, 'the three one-liners must not share wording');

  // Every credential has BOTH, so a new one cannot ship with only the long form —
  // which would render as a step with no claim beside it, the exact failure the
  // one-liner exists to prevent.
  for (const [name, copy] of Object.entries(COPY.world.credential)) {
    assert.ok(copy.short?.length, `credential "${name}" has no one-line claim`);
    assert.ok(copy.body?.length, `credential "${name}" has no full claim`);
  }
});

test('no static string claims a uniqueness the default credential does not establish', () => {
  // Every string outside `world.credential` renders WITHOUT knowing which
  // credential the deployment requested, so each one must be true of the weakest
  // it can request. "Unique human" and "one human, one voice" were both true only
  // while this app asked for an Orb; it asks for Face Check now.
  //
  // `world.credential.orb` is exempt because it renders ONLY when the Orb is what
  // was actually requested — that is the entire point of keying it on the server's
  // answer instead of hardcoding one sentence.
  for (const [path, value] of COPY_LEAVES) {
    if (path.startsWith('world.credential.orb')) continue;
    assert.ok(!/\bunique (human|person|personhood)\b/i.test(value), `${path} claims uniqueness: ${value}`);
    assert.ok(!/\bone human, one\b/i.test(value), `${path} claims one-human-one-x: ${value}`);
  }
});

test('the credential is chosen server-side: face by default, and a typo is refused not defaulted', () => {
  const base = { NEXT_PUBLIC_WORLD_APP_ID: 'app_x', NEXT_PUBLIC_WORLD_RP_ID: 'rp_x', RP_SIGNING_KEY: 'k' };

  // Unset → Face Check. A deployment that sets nothing cannot end up claiming
  // more than it checked, because the default is the weakest camera-backed bar.
  assert.equal(worldConfig(base).config.credential, 'face');
  assert.equal(DEFAULT_WORLD_CREDENTIAL, 'face');

  for (const credential of WORLD_CREDENTIALS) {
    assert.equal(worldConfig({ ...base, WORLD_CREDENTIAL: credential }).config.credential, credential);
    // …and each one has copy of its own, so a new credential cannot be added
    // without saying what it proves.
    assert.ok(COPY.world.credential[credential]?.body, `no copy for credential "${credential}"`);
  }
  assert.equal(worldConfig({ ...base, WORLD_CREDENTIAL: 'ORB' }).config.credential, 'orb', 'case must not matter');

  // A typo is a configuration error. Silently handing back a face check to an
  // operator who typed "orbb" would make the screen honest and the operator wrong.
  const typo = worldConfig({ ...base, WORLD_CREDENTIAL: 'orbb' });
  assert.equal(typo.ok, false);
  assert.deepEqual(typo.missing, ['WORLD_CREDENTIAL']);
  assert.match(typo.detail, /orbb/);
});

test('the submit screen no longer claims World ID is unwired, and does not claim a review was queued', () => {
  assert.ok(!/not wired into this form/i.test(COPY.submit.worldIdNote), 'stale copy: the gate is wired now');
  assert.match(COPY.submit.worldIdNote, /before a submission is looked at/i);
  assert.match(COPY.submit.resultNotBuiltBody, /nothing was queued/i);
  assert.match(COPY.submit.resultNotBuiltBody, /not spent/i);
});
