// POST /v1/disputes — the route shape, the state machine, and the 403 path.
//
// World integration is a separate lane. What is tested here is that the seam is
// real: a stub verifier produces the 403 that the AgentKit gate will produce, and
// the route's behaviour does not change when the implementation is swapped.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.mjs';
import { FIXTURES, MISS_FINGERPRINT } from '../src/mock.mjs';
import { createStubVerifiers, createIllustrativeVerifiers, resolveVerifiers } from '../src/verifiers.mjs';
import { ERROR_CODES } from '@surex/core';

const quiet = { warn() {}, info() {}, error() {} };
const FLAGGED = FIXTURES.find((f) => f.label === 'flagged-tier-b').fingerprint;

// The order is load-bearing: opts spreads first, then the merged env. Reversed, a caller
// passing `{ env: {…} }` loses SUREX_MOCK and these tests hit live Braga.
const app = (opts = {}) =>
  createApp({ logger: quiet, ...opts, env: { SUREX_MOCK: '1', ...(opts.env ?? {}) } });

const post = (a, payload, headers = {}) =>
  a.request('/v1/disputes', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });

test('an agent with no standing is refused 403 agent_not_human_backed', async () => {
  const a = app();
  assert.equal(a.surex.verifiers.isStub, true, 'the default verifier must be the stub');

  const res = await post(a, {
    fingerprint: FLAGGED,
    agentAddress: '0x4C12202c7A818f9e6A34627dd3B71951d8Abfa85',
    evidence: 'the flagged path is behind a feature flag',
  });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error.code, ERROR_CODES.AGENT_NOT_HUMAN_BACKED);
  assert.match(body.error.message, /no human stands behind this agent/i);
  assert.match(body.error.message, /AgentBook/);
  // The refusal says loudly that no check ran, so a 403 from the stub can never be
  // mistaken for a 403 from a real AgentBook lookup.
  assert.equal(body.error.stub, true);
  assert.equal(body.error.verifier, 'stub');
  assert.match(body.error.detail, /STUB VERIFIER/);
});

test('the agent path is taken from an explicit type, an address, or an x402 header', async () => {
  const a = app();
  const cases = [
    [{ fingerprint: FLAGGED, evidence: 'x', contestantType: 'agent' }, {}],
    [{ fingerprint: FLAGGED, evidence: 'x', agentAddress: '0xabc' }, {}],
    [{ fingerprint: FLAGGED, evidence: 'x' }, { 'x-payment': 'eyJ4NDAyVmVyc2lvbiI6MX0=' }],
  ];
  for (const [payload, headers] of cases) {
    const res = await post(a, payload, headers);
    assert.equal(res.status, 403, `${JSON.stringify({ payload, headers })} must take the agent path`);
    assert.equal((await res.json()).error.code, ERROR_CODES.AGENT_NOT_HUMAN_BACKED);
  }
});

test('a human with no World ID proof is 401, not 403 — the two refusals are different facts', async () => {
  const res = await post(app(), { fingerprint: FLAGGED, statement: 'this is a false positive' });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error.code, ERROR_CODES.UNAUTHENTICATED);
  assert.match(body.error.message, /contest-verdict/);
  assert.equal(body.error.stub, true);
});

test('the verifier interface is what a route sees, and a real one drops straight in', async () => {
  // The whole point of the seam: the World lane replaces two functions and the
  // route, the state machine and the codes are untouched.
  const calls = [];
  const fakeWorld = {
    name: 'agentbook+idkit',
    isStub: false,
    async verifyHumanProof(args) {
      calls.push(['human', args.action]);
      return { ok: true, nullifier: '42' };
    },
    async verifyAgentStanding(args) {
      calls.push(['agent', args.agentAddress]);
      return { ok: true, humanId: 'humanId-abc' };
    },
  };
  const a = app({ verifiers: fakeWorld });

  let res = await post(a, { fingerprint: FLAGGED, agentAddress: '0xabc', evidence: 'counter-evidence' });
  assert.equal(res.status, 202);
  let body = await res.json();
  assert.equal(body.status, 'accepted');
  assert.equal(body.dispute.contestantType, 'agent');
  assert.equal(body.dispute.state, 'open');
  assert.equal(body.dispute.standing.humanId, 'humanId-abc');
  assert.equal(body.verifier.stub, false);

  res = await post(a, { fingerprint: FLAGGED, proof: { merkle_root: '0x1' }, statement: 'false positive' });
  assert.equal(res.status, 202);
  body = await res.json();
  assert.equal(body.dispute.contestantType, 'human');
  assert.equal(body.dispute.standing.nullifier, '42');

  assert.deepEqual(calls, [
    ['agent', '0xabc'],
    ['human', 'contest-verdict'],
  ]);
});

test('an accepted dispute states the state machine, and that it does NOT unblock', async () => {
  // tech-spec §9: a dispute changes what the user is told and queues a human
  // review; it never switches off enforcement.
  const a = app({
    verifiers: {
      name: 'test',
      isStub: false,
      async verifyAgentStanding() {
        return { ok: true, humanId: 'h' };
      },
      async verifyHumanProof() {
        return { ok: true };
      },
    },
  });
  const body = await (
    await post(a, { fingerprint: FLAGGED, agentAddress: '0xabc', evidence: 'x' })
  ).json();

  assert.match(body.enforcement, /still blocks/);
  assert.match(body.enforcement, /human overturn/);
  assert.deepEqual(body.headTransition, { from: 'flagged', to: 'disputed', appliedBy: 'worker' });

  // No fabricated on-chain identity: this process has no wallet, so it returns no
  // entity key and no transaction digest, and says the record is not stored yet.
  assert.equal(body.persisted, false);
  assert.match(body.note, /no wallet/);
  assert.match(body.dispute.id, /^sxd1_[0-9a-f]{32}$/);
  assert.equal(body.dispute.txDigest, undefined);
  assert.equal(body.dispute.entityKey, undefined);
  assert.equal(body.dispute.blobId, undefined);
});

test('the dispute id is deterministic for the same submission', async () => {
  const verifiers = {
    name: 'test',
    isStub: false,
    async verifyAgentStanding() {
      return { ok: true, humanId: 'h' };
    },
    async verifyHumanProof() {
      return { ok: true };
    },
  };
  const a = app({ verifiers });
  const payload = { fingerprint: FLAGGED, agentAddress: '0xabc', evidence: 'same bytes' };
  const one = await (await post(a, payload)).json();
  const two = await (await post(a, payload)).json();
  assert.equal(one.dispute.id, two.dispute.id);

  const other = await (await post(a, { ...payload, evidence: 'different bytes' })).json();
  assert.notEqual(one.dispute.id, other.dispute.id);
});

test('there must be something to contest', async () => {
  const a = app();
  // No live verdict for that fingerprint → nothing to dispute. Checked before the
  // identity check, so a valid agent cannot create registry rows for free.
  let res = await post(a, { fingerprint: MISS_FINGERPRINT, agentAddress: '0xabc', evidence: 'x' });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error.code, ERROR_CODES.NOT_FOUND);
});

test('a malformed dispute body is invalid_body or bad_fingerprint, never a 500', async () => {
  const a = app();
  const cases = [
    [{}, 400, ERROR_CODES.INVALID_BODY], // names nothing
    [{ fingerprint: FLAGGED }, 400, ERROR_CODES.INVALID_BODY], // no evidence and no statement
    [{ fingerprint: 'garbage', evidence: 'x' }, 400, ERROR_CODES.BAD_FINGERPRINT],
    [{ fingerprint: FLAGGED, evidence: 'x', contestantType: 'robot' }, 400, ERROR_CODES.INVALID_BODY],
  ];
  for (const [payload, status, code] of cases) {
    const res = await post(a, payload);
    assert.equal(res.status, status, JSON.stringify(payload));
    assert.equal((await res.json()).error.code, code);
  }

  const notJson = await a.request('/v1/disputes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{{{',
  });
  assert.equal(notJson.status, 400);
  assert.equal((await notJson.json()).error.code, ERROR_CODES.INVALID_BODY);
});

test('a verdictKey may be contested without a fingerprint', async () => {
  const a = app({
    verifiers: {
      name: 'test',
      isStub: false,
      async verifyAgentStanding() {
        return { ok: true, humanId: 'h' };
      },
      async verifyHumanProof() {
        return { ok: true };
      },
    },
  });
  const res = await post(a, { verdictKey: '0xabc123', agentAddress: '0xabc', evidence: 'x' });
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.dispute.verdictKey, '0xabc123');
  assert.equal(body.dispute.fingerprint, null);
  assert.equal(body.headTransition.from, null, 'no head was read, so nothing is claimed about its state');
});

test('the stub verifier refuses both paths and never returns a humanId', async () => {
  const v = createStubVerifiers({ logger: quiet });
  assert.equal(v.isStub, true);
  const human = await v.verifyHumanProof({});
  const agent = await v.verifyAgentStanding({ agentAddress: '0xabc' });
  assert.equal(human.ok, false);
  assert.equal(agent.ok, false);
  assert.equal(agent.humanId, null, 'null is exactly what lookupHuman returns for an unbacked agent');
  for (const r of [human, agent]) assert.match(r.detail, /STUB VERIFIER/);
});

test('the illustrative verifier is opt-in, mock-only, and marks everything it returns', async () => {
  // It must be impossible to enable by accident in a live deployment.
  assert.equal(resolveVerifiers({ env: {}, logger: quiet }).name, 'stub');
  assert.equal(resolveVerifiers({ env: { SUREX_MOCK_ACCEPT_DISPUTES: '1' }, logger: quiet }).name, 'stub');
  assert.equal(
    resolveVerifiers({ env: { SUREX_MOCK: '1', SUREX_MOCK_ACCEPT_DISPUTES: '1' }, logger: quiet }).name,
    'illustrative',
  );

  const v = createIllustrativeVerifiers({ logger: quiet });
  const ok = await v.verifyAgentStanding({ agentAddress: '0xAbc1' });
  assert.equal(ok.ok, true);
  assert.equal(ok.illustrative, true);
  assert.match(ok.humanId, /DEMO/);
  const refused = await v.verifyAgentStanding({ agentAddress: '0xAbc0' });
  assert.equal(refused.ok, false);
  assert.equal(refused.humanId, null);

  const a = app({ env: { SUREX_MOCK_ACCEPT_DISPUTES: '1' } });
  const res = await post(a, { fingerprint: FLAGGED, agentAddress: '0xAbc1', evidence: 'x' });
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.illustrative, true);
  assert.equal(body.verifier.stub, true, 'an illustrative accept still declares itself a stub');
});
