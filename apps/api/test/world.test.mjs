// The World identity lane: AgentBook standing (agents) and World ID proofs (humans).
//
// Everything here runs OFFLINE and for real — a local JSON-RPC server stands in for
// World Chain and an injected fetch stands in for the Developer Portal, so the whole
// agent flow (challenge → createHeader → parse → validate → recover → lookupHuman)
// is exercised with a real signature from a real key. Nothing is stubbed inside the
// code under test.
//
// The chain-side facts these tests encode were measured against LIVE World Chain 480
// on 2026-07-25; `test/world-live.smoke.mjs` re-checks them against the real chain.
//
// The single most important test in this file is
// "a rate-limited RPC is upstream_unavailable, NEVER agent_not_human_backed".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';

import { createAgentkitClient } from '@worldcoin/agentkit';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { getAddress, pad, toHex } from 'viem';
import { ERROR_CODES } from '@surex/core';

import { createApp } from '../src/app.mjs';
import { FIXTURES } from '../src/mock.mjs';
import {
  AGENT_BOOK_NETWORKS,
  REFUSAL_STATUS,
  WORLD_ACTIONS,
  createNullifierStore,
  createWorldVerifiers,
  disputeSignal,
  evidenceHashOf,
  hashToField,
  normaliseRepo,
  nullifierToDecimal,
  resolveVerifiers,
  submitSignal,
} from '../src/verifiers.mjs';

const quiet = { warn() {}, info() {}, error() {} };
const FLAGGED = FIXTURES.find((f) => f.label === 'flagged-tier-b').fingerprint;
const HOST = 'api.surex.test';
const DISPUTE_PATH = '/v1/disputes';

/* ─────────────────────────────────────────────────── a World Chain stand-in ─*/

/**
 * A real HTTP JSON-RPC endpoint. `mode` decides what `eth_call` does, which is how
 * "unregistered" and "the RPC is throttled" become two different, testable facts.
 */
async function rpcStub(mode = { kind: 'registered', humanId: 42n }) {
  const calls = { eth_call: 0 };
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      const reply = (result) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
      };
      if (body.method === 'eth_chainId') return reply('0x1e0');
      if (body.method === 'eth_call') {
        calls.eth_call += 1;
        if (mode.kind === 'ratelimited') {
          res.writeHead(429, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ error: { code: -32005, message: 'exceeded its throughput limit' } }));
        }
        if (mode.kind === 'unregistered') return reply(pad('0x0', { size: 32 }));
        return reply(pad(toHex(mode.humanId ?? 42n), { size: 32 }));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: null }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, calls, close: () => server.close() };
}

const worldEnv = (rpcUrl, extra = {}) => ({
  SUREX_WORLD: '1',
  SUREX_WORLD_RPC_URL: rpcUrl,
  SUREX_RESOURCE_URI: `http://${HOST}`,
  ...extra,
});

/** A real signed agentkit header for a challenge this server issued. */
async function signedHeader(verifiers, account, { requestId, chainId = 'eip155:480' } = {}) {
  const challenge = verifiers.challenge({ headers: { host: HOST }, path: DISPUTE_PATH }).agentkit;
  const withRequestId = requestId
    ? { ...challenge, info: { ...challenge.info, requestId } }
    : challenge;
  const client = createAgentkitClient({
    signer: {
      address: account.address,
      chainId,
      type: 'eip191',
      signMessage: (message) => account.signMessage({ message }),
    },
  });
  return client.createHeader(withRequestId);
}

/* ──────────────────────────────────────────────────────────────── the hashes ─*/

test('hashToField reproduces World hashSignal on the documented vectors', () => {
  // Cross-checked against `hashSignal()` from @worldcoin/idkit-core (4.2.2) on
  // 2026-07-25. The first row is the empty-signal default documented on the verify
  // endpoint, so if this drifts, so has our reading of the protocol.
  const vectors = [
    ['', '0x00c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a4'],
    ['hello', '0x001c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36dea'],
    ['surex|sxf1_abc', '0x008d695d462918d4706c873bf2727c1e5731aa9fa3bdcc84ffa934b53dea45fa'],
    ['0xdeadbeef', '0x00d4fd4e189132273036449fc9e11198c739161b4c0116a9a2dccdfa1c492006'],
  ];
  for (const [input, expected] of vectors) assert.equal(hashToField(input), expected, `hashToField(${JSON.stringify(input)})`);
});

test('the signal formulas are pinned — the web app derives the same two strings', () => {
  // ⚠️ These exact vectors are also asserted in apps/web/test/copy.test.mjs against
  // apps/web/lib/world.ts. The client picks the signal, the server recomputes it: if
  // one side changes the formula, every proof binds to a signal the other rejects,
  // so the drift has to break a test rather than a demo.
  assert.equal(disputeSignal({ verdictKey: 'k', evidenceHash: 'e' }), 'b5f67945e835eb5b6e7f68bce9590a7eed867341b0155dcaa1679dfa22238ad9');
  assert.equal(submitSignal({ repoUrl: 'https://github.com/acme/acme-mcp' }), 'f65c55b952154a9e743b0d92f05ce944f9d888dc1d47f9cb323da43e35eec6e9');
  assert.equal(evidenceHashOf({ evidence: 'e' }), '3f79bb7b435b05321651daefd374cdc681dc06faa65e374e38337b88ca046dea');
  // The composition is the invariant that actually matters, and it is the one that
  // broke first in testing: the leaves agreeing does not mean the pipelines do.
  // This value was read out of the LIVE web route (POST /api/world/rp-signature
  // with {verdictKey:'k', evidence:'e'}) on 2026-07-25 and must not drift from it.
  assert.equal(
    disputeSignal({ verdictKey: 'k', evidenceHash: evidenceHashOf({ evidence: 'e' }) }),
    '7ea73226509bede9017b5b765048fe654cdf554e3198e543f7e968bf60d50b46',
  );
  // one dispute, one signal: different evidence must not reuse the same proof
  assert.notEqual(disputeSignal({ verdictKey: 'k', evidenceHash: 'e' }), disputeSignal({ verdictKey: 'k', evidenceHash: 'f' }));
  // repo normalisation, so the same repo typed three ways is one signal
  assert.equal(normaliseRepo('https://GitHub.com/Acme/acme-mcp.git/'), 'github.com/acme/acme-mcp');
  assert.equal(submitSignal({ repoUrl: 'https://github.com/acme/acme-mcp' }), submitSignal({ repoUrl: 'GITHUB.COM/acme/acme-mcp/' }));
});

test('nullifiers are stored as decimal, and hex casing cannot fork one person into two', () => {
  assert.equal(nullifierToDecimal('0x0a'), '10');
  assert.equal(nullifierToDecimal('0x0A'), '10');
  assert.equal(nullifierToDecimal('0xa'), '10');
  assert.throws(() => nullifierToDecimal('10'), /not 0x-hex/);
  assert.throws(() => nullifierToDecimal(undefined), /not 0x-hex/);
});

/* ──────────────────────────────────────────────────── the agent gate, offline ─*/

test('an agent with a signed header and an AgentBook registration gets standing', async () => {
  const rpc = await rpcStub({ kind: 'registered', humanId: 0x2493n });
  try {
    const v = createWorldVerifiers({ env: worldEnv(rpc.url), logger: quiet });
    const account = privateKeyToAccount(generatePrivateKey());
    const body = { fingerprint: FLAGGED, evidence: 'the flagged path is behind a feature flag' };
    const header = await signedHeader(v, account, {
      requestId: disputeSignal({ verdictKey: FLAGGED, evidenceHash: evidenceHashOf(body) }),
    });

    const out = await v.verifyAgentStanding({ headers: { host: HOST, agentkit: header }, body, path: DISPUTE_PATH });
    assert.equal(out.ok, true, out.detail);
    assert.equal(out.humanId, '0x2493');
    assert.equal(out.agentAddress, account.address);
    assert.equal(out.network, 'worldchain-480');
    assert.equal(out.standing.bodyBound, true);
    // Never a claim about the agent itself — the World track excludes that.
    assert.match(out.standing.notProved, /nothing about how this agent has behaved/);
  } finally {
    rpc.close();
  }
});

test('THE GATE: an unregistered agent is refused, and the refusal is a real chain read', async () => {
  const rpc = await rpcStub({ kind: 'unregistered' });
  try {
    const v = createWorldVerifiers({ env: worldEnv(rpc.url), logger: quiet });
    const account = privateKeyToAccount(generatePrivateKey());
    const header = await signedHeader(v, account);
    const out = await v.verifyAgentStanding({ headers: { host: HOST, agentkit: header }, body: { evidence: 'x' }, path: DISPUTE_PATH });
    assert.equal(out.ok, false);
    assert.equal(out.humanId, null);
    assert.equal(out.reason, 'no_standing');
    assert.match(out.detail, /lookupHuman returned 0/);
    // The SDK answered null and we re-read the contract ourselves before believing it.
    assert.ok(rpc.calls.eth_call >= 2, `expected a confirming read, saw ${rpc.calls.eth_call} eth_call(s)`);
  } finally {
    rpc.close();
  }
});

test('a rate-limited RPC is upstream_unavailable, NEVER agent_not_human_backed', async () => {
  // The worst thing this route can do is tell an honest, registered agent that no
  // human stands behind it because OUR RPC was throttled. `lookupHuman` returns
  // null for a 429 (verified against the SDK source and live), so the code must not
  // take null at face value.
  const rpc = await rpcStub({ kind: 'ratelimited' });
  try {
    const v = createWorldVerifiers({ env: worldEnv(rpc.url), logger: quiet });
    const account = privateKeyToAccount(generatePrivateKey());
    const header = await signedHeader(v, account);
    const out = await v.verifyAgentStanding({ headers: { host: HOST, agentkit: header }, body: { evidence: 'x' }, path: DISPUTE_PATH });
    assert.equal(out.ok, false);
    assert.equal(out.reason, 'upstream_unavailable');
    assert.match(out.detail, /UNKNOWN/);
    assert.equal(REFUSAL_STATUS[out.reason], 'upstream');
  } finally {
    rpc.close();
  }
});

test('an unreachable RPC is also upstream_unavailable', async () => {
  const v = createWorldVerifiers({ env: worldEnv('http://127.0.0.1:9'), logger: quiet });
  const account = privateKeyToAccount(generatePrivateKey());
  const header = await signedHeader(v, account);
  const out = await v.verifyAgentStanding({ headers: { host: HOST, agentkit: header }, body: { evidence: 'x' }, path: DISPUTE_PATH });
  assert.equal(out.reason, 'upstream_unavailable');
});

test('an agentAddress in the body proves nothing without a signature', async () => {
  const rpc = await rpcStub({ kind: 'registered' });
  try {
    const v = createWorldVerifiers({ env: worldEnv(rpc.url), logger: quiet });
    // A registered address anyone could copy off the chain, with no signature.
    const out = await v.verifyAgentStanding({
      agentAddress: getAddress('0xea7d8b94f6e8044a22738ffe78a2cb356d114171'),
      headers: { host: HOST },
      body: { evidence: 'x' },
      path: DISPUTE_PATH,
    });
    assert.equal(out.ok, false);
    assert.equal(out.reason, 'agentkit_header_missing');
    assert.equal(REFUSAL_STATUS[out.reason], 'unauthenticated', 'an unsigned request is not a statement about standing');
    assert.equal(rpc.calls.eth_call, 0, 'an unproven address must never reach AgentBook');
    // and the refusal hands back a challenge the agent can actually sign
    assert.ok(out.challenge.agentkit.info.nonce);
    assert.equal(out.challenge.agentkit.info.domain, HOST);
    assert.ok(out.challenge.agentkit.supportedChains.some((c) => c.chainId === 'eip155:480' && c.type === 'eip191'));
  } finally {
    rpc.close();
  }
});

test('the signature wins over the body, and a mismatched claim is refused', async () => {
  const rpc = await rpcStub({ kind: 'registered' });
  try {
    const v = createWorldVerifiers({ env: worldEnv(rpc.url), logger: quiet });
    const account = privateKeyToAccount(generatePrivateKey());
    const header = await signedHeader(v, account);
    const out = await v.verifyAgentStanding({
      agentAddress: getAddress('0xea7d8b94f6e8044a22738ffe78a2cb356d114171'),
      headers: { host: HOST, agentkit: header },
      body: { evidence: 'x' },
      path: DISPUTE_PATH,
    });
    assert.equal(out.reason, 'agentkit_address_mismatch');
    assert.match(out.detail, /signature wins/);
  } finally {
    rpc.close();
  }
});

test('a signed header is single-use, and cannot be replayed onto a second dispute', async () => {
  const rpc = await rpcStub({ kind: 'registered' });
  try {
    const v = createWorldVerifiers({ env: worldEnv(rpc.url), logger: quiet });
    const account = privateKeyToAccount(generatePrivateKey());
    const header = await signedHeader(v, account);
    const args = { headers: { host: HOST, agentkit: header }, body: { evidence: 'x' }, path: DISPUTE_PATH };
    assert.equal((await v.verifyAgentStanding(args)).ok, true);
    const second = await v.verifyAgentStanding(args);
    assert.equal(second.ok, false);
    assert.equal(second.reason, 'agentkit_nonce_replayed');
  } finally {
    rpc.close();
  }
});

test('a requestId binds the signature to one rebuttal', async () => {
  const rpc = await rpcStub({ kind: 'registered' });
  try {
    const v = createWorldVerifiers({ env: worldEnv(rpc.url), logger: quiet });
    const account = privateKeyToAccount(generatePrivateKey());
    const header = await signedHeader(v, account, {
      requestId: disputeSignal({ verdictKey: FLAGGED, evidenceHash: evidenceHashOf({ evidence: 'the real rebuttal' }) }),
    });
    // Same signature, different evidence: the AgentKit message does not cover the
    // body, so without this check a captured header could file anything for 5 min.
    const out = await v.verifyAgentStanding({
      headers: { host: HOST, agentkit: header },
      body: { fingerprint: FLAGGED, evidence: 'a substituted rebuttal' },
      path: DISPUTE_PATH,
    });
    assert.equal(out.reason, 'agentkit_body_mismatch');
  } finally {
    rpc.close();
  }
});

test('a header signed for another resource is refused', async () => {
  const rpc = await rpcStub({ kind: 'registered' });
  try {
    const v = createWorldVerifiers({ env: worldEnv(rpc.url), logger: quiet });
    const other = createWorldVerifiers({ env: worldEnv(rpc.url, { SUREX_RESOURCE_URI: 'http://evil.example' }), logger: quiet });
    const account = privateKeyToAccount(generatePrivateKey());
    const challenge = other.challenge({ headers: { host: 'evil.example' }, path: DISPUTE_PATH }).agentkit;
    const client = createAgentkitClient({
      signer: { address: account.address, chainId: 'eip155:480', type: 'eip191', signMessage: (message) => account.signMessage({ message }) },
    });
    const header = await client.createHeader(challenge);
    const out = await v.verifyAgentStanding({ headers: { host: HOST, agentkit: header }, body: { evidence: 'x' }, path: DISPUTE_PATH });
    assert.equal(out.reason, 'agentkit_message_invalid');
  } finally {
    rpc.close();
  }
});

test('a tampered signature is refused, offline, with no RPC involved', async () => {
  const rpc = await rpcStub({ kind: 'registered' });
  try {
    const v = createWorldVerifiers({ env: worldEnv(rpc.url), logger: quiet });
    const account = privateKeyToAccount(generatePrivateKey());
    const header = await signedHeader(v, account);
    const payload = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    // claim someone else's genuinely registered wallet (read off World Chain 480)
    payload.address = getAddress('0xea7d8b94f6e8044a22738ffe78a2cb356d114171');
    const forged = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    const out = await v.verifyAgentStanding({ headers: { host: HOST, agentkit: forged }, body: { evidence: 'x' }, path: DISPUTE_PATH });
    assert.equal(out.reason, 'agentkit_signature_invalid');
    assert.equal(rpc.calls.eth_call, 0, 'a forged signature must never reach AgentBook');
  } finally {
    rpc.close();
  }
});

test('a malformed header is a refusal, not a crash', async () => {
  const v = createWorldVerifiers({ env: worldEnv('http://127.0.0.1:9'), logger: quiet });
  for (const bad of ['not-base64!!', Buffer.from('{}').toString('base64'), Buffer.from('not json').toString('base64')]) {
    const out = await v.verifyAgentStanding({ headers: { host: HOST, agentkit: bad }, body: { evidence: 'x' }, path: DISPUTE_PATH });
    assert.equal(out.ok, false);
    assert.match(out.reason, /agentkit_header_malformed|agentkit_message_invalid/);
  }
});

/* ─────────────────────────────────────────────── the human gate, offline ─────*/

const PROOF = (over = {}) => ({
  protocol_version: '3.0',
  nonce: '11111111-2222-3333-4444-555555555555',
  action: WORLD_ACTIONS.dispute,
  environment: 'production',
  responses: [
    {
      identifier: 'device',
      merkle_root: '0x' + '1'.repeat(64),
      nullifier: '0x' + '2'.repeat(63) + 'A',
      proof: '0x' + '3'.repeat(512),
      signal_hash: hashToField(disputeSignal({ verdictKey: FLAGGED, evidenceHash: evidenceHashOf({ evidence: 'e' }) })),
    },
  ],
  user_presence_completed: false,
  ...over,
});

/** The Developer Portal, stubbed at the HTTP boundary only. */
const portal = (status, body) => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetchImpl, seen };
};

const humanEnv = (extra = {}) => worldEnv('http://127.0.0.1:9', { WORLD_RP_ID: 'rp_surex_test', ...extra });

test('an unset relying party is a configuration error, never a pass', async () => {
  const v = createWorldVerifiers({ env: worldEnv('http://127.0.0.1:9'), logger: quiet });
  assert.equal(v.worldIdConfigured, false);
  const out = await v.verifyHumanProof({ proof: PROOF(), body: { fingerprint: FLAGGED, evidence: 'e' } });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'world_id_not_configured');
  assert.equal(REFUSAL_STATUS[out.reason], 'internal', 'our misconfiguration must not be reported as the person failing');
  assert.match(out.detail, /WORLD_RP_ID/);
});

test('a relying-party id that the live endpoint would reject is caught before the request', async () => {
  const v = createWorldVerifiers({ env: humanEnv({ WORLD_RP_ID: 'surex' }), logger: quiet });
  const out = await v.verifyHumanProof({ proof: PROOF(), body: { fingerprint: FLAGGED, evidence: 'e' } });
  assert.equal(out.reason, 'world_id_misconfigured');
});

test('a valid proof yields a decimal nullifier and forwards the payload byte-for-byte', async () => {
  const p = portal(200, { success: true, action: WORLD_ACTIONS.dispute, nullifier: '0x' + '2'.repeat(63) + 'A' });
  const v = createWorldVerifiers({ env: humanEnv(), logger: quiet, fetchImpl: p.fetchImpl });
  const proof = PROOF();
  const out = await v.verifyHumanProof({ proof, body: { fingerprint: FLAGGED, evidence: 'e' } });
  assert.equal(out.ok, true, out.detail);
  assert.equal(out.nullifier, BigInt('0x' + '2'.repeat(63) + 'A').toString(10));
  assert.match(out.nullifier, /^[0-9]+$/, 'decimal, never hex');
  assert.equal(p.seen[0].url, 'https://developer.world.org/api/v4/verify/rp_surex_test');
  assert.deepEqual(p.seen[0].body, proof, 'the proof must be forwarded unmodified');
});

test('the response retains nothing about the person except the nullifier', async () => {
  const p = portal(200, { success: true, nullifier: '0x2a', created_at: '2026-07-25T00:00:00Z', environment: 'production' });
  const v = createWorldVerifiers({ env: humanEnv(), logger: quiet, fetchImpl: p.fetchImpl });
  const out = await v.verifyHumanProof({ proof: PROOF(), body: { fingerprint: FLAGGED, evidence: 'e' } });
  assert.equal(out.ok, true, out.detail);
  const leaked = JSON.stringify({ ...out, commit: undefined });
  // NFR-4: the nullifier and nothing else. No merkle root, no proof bytes, no
  // timestamp World happened to hand back.
  for (const field of ['merkle_root', 'created_at', '1111', '3333']) {
    assert.ok(!leaked.includes(field), `the result leaks ${field}: ${leaked}`);
  }
  assert.deepEqual(
    Object.keys(out).sort(),
    ['action', 'commit', 'environment', 'nullifier', 'ok', 'signal', 'uniqueness'],
  );
});

test('a staging proof is refused by a production deployment', async () => {
  // A staging proof comes from the simulator. Accepting one in production would mean
  // anyone who can open a web page is a unique human.
  const p = portal(200, { success: true, nullifier: '0x2a' });
  const v = createWorldVerifiers({ env: humanEnv(), logger: quiet, fetchImpl: p.fetchImpl });
  const out = await v.verifyHumanProof({ proof: PROOF({ environment: 'staging' }), body: { fingerprint: FLAGGED, evidence: 'e' } });
  assert.equal(out.reason, 'environment_mismatch');
  assert.equal(p.seen.length, 0, 'it must never be sent upstream at all');

  // …and a staging deployment accepts it, because that is what staging is for.
  const staging = createWorldVerifiers({ env: humanEnv({ WORLD_ID_ENVIRONMENT: 'staging' }), logger: quiet, fetchImpl: p.fetchImpl });
  assert.equal((await staging.verifyHumanProof({ proof: PROOF({ environment: 'staging' }), body: { fingerprint: FLAGGED, evidence: 'e' } })).ok, true);
});

test('a proof for the wrong action cannot be spent on this one', async () => {
  const p = portal(200, { success: true, nullifier: '0x2a' });
  const v = createWorldVerifiers({ env: humanEnv(), logger: quiet, fetchImpl: p.fetchImpl });
  const out = await v.verifyHumanProof({ proof: PROOF({ action: WORLD_ACTIONS.submit }), body: { fingerprint: FLAGGED, evidence: 'e' } });
  assert.equal(out.reason, 'action_mismatch');
  assert.equal(p.seen.length, 0);
});

test('a proof bound to no signal, or to someone else’s, is refused', async () => {
  const p = portal(200, { success: true, nullifier: '0x2a' });
  const v = createWorldVerifiers({ env: humanEnv(), logger: quiet, fetchImpl: p.fetchImpl });
  const body = { fingerprint: FLAGGED, evidence: 'e' };

  const unbound = PROOF();
  delete unbound.responses[0].signal_hash;
  assert.equal((await v.verifyHumanProof({ proof: unbound, body })).reason, 'signal_missing');

  const other = PROOF({ responses: [{ ...PROOF().responses[0], signal_hash: hashToField('someone-elses-dispute') }] });
  assert.equal((await v.verifyHumanProof({ proof: other, body })).reason, 'signal_mismatch');
  assert.equal(p.seen.length, 0, 'neither reaches the portal');
});

test('a rejected proof reports what World said, and a 5xx is upstream_unavailable', async () => {
  const rejected = portal(400, {
    success: false,
    code: 'all_verifications_failed',
    detail: 'All proof verifications failed.',
    results: [{ identifier: 'device', success: false, code: 'invalid_merkle_root', detail: 'The provided Merkle root is invalid.' }],
  });
  const v1 = createWorldVerifiers({ env: humanEnv(), logger: quiet, fetchImpl: rejected.fetchImpl });
  const out1 = await v1.verifyHumanProof({ proof: PROOF(), body: { fingerprint: FLAGGED, evidence: 'e' } });
  assert.equal(out1.reason, 'proof_rejected');
  assert.match(out1.detail, /invalid_merkle_root/);
  assert.equal(out1.worldCode, 'all_verifications_failed');

  const down = portal(503, { message: 'upstream' });
  const v2 = createWorldVerifiers({ env: humanEnv(), logger: quiet, fetchImpl: down.fetchImpl });
  const out2 = await v2.verifyHumanProof({ proof: PROOF(), body: { fingerprint: FLAGGED, evidence: 'e' } });
  assert.equal(out2.reason, 'upstream_unavailable');
  assert.equal(REFUSAL_STATUS[out2.reason], 'upstream');
});

test('maintainer-submit is one per person; contest-verdict is N per window', async () => {
  const p = portal(200, { success: true, nullifier: '0x2a' });
  const shared = createNullifierStore();
  const v = createWorldVerifiers({ env: humanEnv({ SUREX_DISPUTES_PER_WINDOW: '2' }), logger: quiet, fetchImpl: p.fetchImpl, nullifiers: shared });

  const submitProof = PROOF({
    action: WORLD_ACTIONS.submit,
    responses: [{ ...PROOF().responses[0], signal_hash: hashToField(submitSignal({ repoUrl: 'github.com/acme/acme-mcp' })) }],
  });
  const submitBody = { repo: 'github.com/acme/acme-mcp', release: 'v1' };
  const first = await v.verifyHumanProof({ proof: submitProof, action: WORLD_ACTIONS.submit, body: submitBody });
  assert.equal(first.ok, true, first.detail);
  first.commit();
  const second = await v.verifyHumanProof({ proof: submitProof, action: WORLD_ACTIONS.submit, body: submitBody });
  assert.equal(second.reason, 'nullifier_already_used');
  assert.match(second.detail, /one per person/);

  // The same person, same nullifier, on the dispute action: allowed, because being
  // right twice is not a Sybil and one-shot would silence a maintainer.
  const disputeBody = { fingerprint: FLAGGED, evidence: 'e' };
  for (let i = 0; i < 2; i += 1) {
    const ok = await v.verifyHumanProof({ proof: PROOF(), body: disputeBody });
    assert.equal(ok.ok, true, `dispute ${i} refused: ${ok.detail}`);
    ok.commit();
  }
  const third = await v.verifyHumanProof({ proof: PROOF(), body: disputeBody });
  assert.equal(third.reason, 'nullifier_already_used');
  assert.match(third.detail, /window/);
});

/* ───────────────────────────────────────────── the route, with real verifiers ─*/

const post = (app, payload, headers = {}) =>
  app.request('/v1/disputes', {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: HOST, ...headers },
    body: JSON.stringify(payload),
  });

test('the route maps a throttled identity check to 503, not to 403', async () => {
  const rpc = await rpcStub({ kind: 'ratelimited' });
  try {
    const v = createWorldVerifiers({ env: worldEnv(rpc.url), logger: quiet });
    const app = createApp({ logger: quiet, verifiers: v, env: { SUREX_MOCK: '1' } });
    const account = privateKeyToAccount(generatePrivateKey());
    const header = await signedHeader(v, account);
    const res = await post(app, { fingerprint: FLAGGED, evidence: 'x' }, { agentkit: header });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error.code, ERROR_CODES.UPSTREAM_UNAVAILABLE);
    assert.notEqual(body.error.code, ERROR_CODES.AGENT_NOT_HUMAN_BACKED);
    assert.match(body.error.message, /UNKNOWN/);
  } finally {
    rpc.close();
  }
});

test('the route 403s only when the chain really says nobody is behind the agent', async () => {
  const rpc = await rpcStub({ kind: 'unregistered' });
  try {
    const v = createWorldVerifiers({ env: worldEnv(rpc.url), logger: quiet });
    const app = createApp({ logger: quiet, verifiers: v, env: { SUREX_MOCK: '1' } });
    const account = privateKeyToAccount(generatePrivateKey());
    const header = await signedHeader(v, account);
    const res = await post(app, { fingerprint: FLAGGED, evidence: 'x' }, { agentkit: header });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error.code, ERROR_CODES.AGENT_NOT_HUMAN_BACKED);
    assert.equal(body.error.stub, undefined, 'a real refusal must not claim to be a stub');
    assert.equal(body.error.verifier, 'agentbook+idkit');
    assert.equal(body.error.reason, 'no_standing');
  } finally {
    rpc.close();
  }
});

test('the route 401s an unsigned agent request and hands back a signable challenge', async () => {
  const rpc = await rpcStub({ kind: 'registered' });
  try {
    const v = createWorldVerifiers({ env: worldEnv(rpc.url), logger: quiet });
    const app = createApp({ logger: quiet, verifiers: v, env: { SUREX_MOCK: '1' } });
    const res = await post(app, { fingerprint: FLAGGED, evidence: 'x', agentAddress: getAddress('0xea7d8b94f6e8044a22738ffe78a2cb356d114171') });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, ERROR_CODES.UNAUTHENTICATED);
    assert.equal(body.error.reason, 'agentkit_header_missing');
    assert.ok(body.error.challenge.agentkit.info.nonce, 'the refusal must be actionable');
  } finally {
    rpc.close();
  }
});

test('the route accepts a signed, registered agent and still refuses to unblock', async () => {
  const rpc = await rpcStub({ kind: 'registered', humanId: 0x99n });
  try {
    const v = createWorldVerifiers({ env: worldEnv(rpc.url), logger: quiet });
    const app = createApp({ logger: quiet, verifiers: v, env: { SUREX_MOCK: '1' } });
    const account = privateKeyToAccount(generatePrivateKey());
    const body = { fingerprint: FLAGGED, evidence: 'the flagged path is behind a feature flag' };
    const header = await signedHeader(v, account, {
      requestId: disputeSignal({ verdictKey: FLAGGED, evidenceHash: evidenceHashOf(body) }),
    });
    const res = await post(app, body, { agentkit: header });
    assert.equal(res.status, 202);
    const out = await res.json();
    assert.equal(out.dispute.contestantType, 'agent');
    assert.equal(out.dispute.standing.humanId, '0x99');
    assert.equal(out.dispute.standing.agentAddress, account.address);
    assert.equal(out.verifier.stub, false);
    // Standing to be heard is not permission, and a dispute never unblocks.
    assert.match(out.enforcement, /still blocks/);
    assert.equal(out.persisted, false);
  } finally {
    rpc.close();
  }
});

test('the route 500s rather than passing when World ID is unconfigured', async () => {
  const v = createWorldVerifiers({ env: worldEnv('http://127.0.0.1:9'), logger: quiet });
  const app = createApp({ logger: quiet, verifiers: v, env: { SUREX_MOCK: '1' } });
  const res = await post(app, { fingerprint: FLAGGED, statement: 'this is a false positive', contestantType: 'human' });
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.error.code, ERROR_CODES.INTERNAL);
  assert.equal(body.error.reason, 'world_id_not_configured');
});

test('POST /v1/submissions checks personhood BEFORE the pipeline it does not have', async () => {
  const p = portal(200, { success: true, nullifier: '0x2a' });
  const v = createWorldVerifiers({ env: humanEnv(), logger: quiet, fetchImpl: p.fetchImpl });
  const app = createApp({ logger: quiet, verifiers: v, env: { SUREX_MOCK: '1' } });

  // no proof → refused, and nothing about the repo is looked at
  let res = await app.request('/v1/submissions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: HOST },
    body: JSON.stringify({ repo: 'github.com/acme/acme-mcp', release: 'v1' }),
  });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, ERROR_CODES.UNAUTHENTICATED);

  // a real proof → the gate passes, and the honest answer is that the rest is not built
  const proof = PROOF({
    action: WORLD_ACTIONS.submit,
    responses: [{ ...PROOF().responses[0], signal_hash: hashToField(submitSignal({ repoUrl: 'github.com/acme/acme-mcp' })) }],
  });
  // A submission must name BYTES. A tag can be repointed or deleted, so the
  // commit is required and its absence is refused before anything else happens.
  res = await app.request('/v1/submissions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: HOST },
    body: JSON.stringify({ repo: 'github.com/acme/acme-mcp', release: 'v1', proof }),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.field, 'invalid_commit');

  // With a commit and NO writer configured, the honest answer is still that the
  // rest is not built — and the person keeps their submission.
  res = await app.request('/v1/submissions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: HOST },
    body: JSON.stringify({ repo: 'github.com/acme/acme-mcp', release: 'v1', commit: 'a'.repeat(40), proof }),
  });
  assert.equal(res.status, 501);
  const body = await res.json();
  assert.equal(body.error.built, false);
  assert.equal(body.error.identity.checked, true);
  assert.equal(body.error.identity.nullifierSpent, false, 'a person must not lose their one submission to a pipeline that never ran');
  assert.ok(body.error.missing.includes('SUREX_INGEST_URL'), 'and it names what is missing');
});

test('a checked submission is FORWARDED to the writer, and 202 only if the writer took it', async () => {
  const p = portal(200, { success: true, nullifier: '0x2a' });
  const v = createWorldVerifiers({ env: humanEnv(), logger: quiet, fetchImpl: p.fetchImpl });
  const proof = PROOF({
    action: WORLD_ACTIONS.submit,
    responses: [{ ...PROOF().responses[0], signal_hash: hashToField(submitSignal({ repoUrl: 'github.com/acme/acme-mcp' })) }],
  });
  const submission = { repo: 'github.com/acme/acme-mcp', release: 'v1', commit: 'b'.repeat(40), proof };
  const ingestEnv = { SUREX_MOCK: '1', SUREX_INGEST_URL: 'https://writer.test', SUREX_INGEST_TOKEN: 't0ken' };

  // the writer accepts
  let seen = null;
  let app = createApp({
    logger: quiet, verifiers: v, env: ingestEnv,
    fetchImpl: async (url, init) => {
      seen = { url: String(url), auth: init.headers.authorization, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ id: 'ing_1', status: 'queued', queuePosition: 1 }), {
        status: 202, headers: { 'content-type': 'application/json' },
      });
    },
  });
  let res = await app.request('/v1/submissions', {
    method: 'POST', headers: { 'content-type': 'application/json', host: HOST }, body: JSON.stringify(submission),
  });
  assert.equal(res.status, 202);
  let body = await res.json();
  assert.equal(body.accepted, true);
  assert.equal(body.submissionId, 'ing_1');
  assert.equal(seen.url, 'https://writer.test/v1/ingest');
  assert.equal(seen.auth, 'Bearer t0ken');
  assert.equal(seen.body.commit, 'b'.repeat(40), 'the writer is told which bytes');
  assert.equal(seen.body.proof, undefined, 'the proof stays here — the writer has no use for it');

  // the writer is unreachable: 503, and NEVER a 202 claiming it was queued
  app = createApp({
    logger: quiet, verifiers: v, env: ingestEnv,
    fetchImpl: async () => { throw new Error('econnrefused'); },
  });
  res = await app.request('/v1/submissions', {
    method: 'POST', headers: { 'content-type': 'application/json', host: HOST }, body: JSON.stringify(submission),
  });
  assert.equal(res.status, 503);
  body = await res.json();
  assert.notEqual(body.accepted, true, 'nothing was queued and the answer must not imply otherwise');
  assert.match(body.error.message, /fault in the registry, not in your submission/i);
});

test('GET /v1/submissions/:id names the model doing the reading', async () => {
  // A review is minutes because a model reads the source twice — four times when
  // the readings disagree. A screen that hides that behind an anonymous spinner
  // is asking to be trusted rather than read, so the status says which model,
  // and it comes from the same variable the reviewer itself reads.
  const env = {
    SUREX_MOCK: '1',
    SUREX_INGEST_URL: 'https://writer.test',
    SUREX_INGEST_TOKEN: 't0ken',
    SUREX_REVIEWER_MODEL: 'qwen3-coder-next:surex32k',
  };
  const app = createApp({
    logger: quiet, env,
    fetchImpl: async (url, init) => {
      assert.match(String(url), /\/v1\/ingest\/ing_1$/);
      assert.equal(init.headers.authorization, 'Bearer t0ken');
      return new Response(JSON.stringify({ status: 'running', startedAt: '2026-07-25T20:00:00Z' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    },
  });
  const res = await app.request('/v1/submissions/ing_1', { headers: { host: HOST } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'running');
  assert.equal(body.reviewer.model, 'qwen3-coder-next:surex32k');
  assert.equal(body.reviewer.humanAudited, false);
  assert.match(body.reviewer.readings, /paraphrased/);
  assert.equal(res.headers.get('cache-control'), 'no-store', 'progress must never be cached');
});

test('an unset reviewer model is reported as unset, never guessed', async () => {
  // A hardcoded default here would be a screen confidently naming a model nobody
  // configured — and that name ends up beside a verdict.
  const app = createApp({
    logger: quiet,
    env: { SUREX_MOCK: '1', SUREX_INGEST_URL: 'https://writer.test', SUREX_INGEST_TOKEN: 't' },
    fetchImpl: async () => new Response(JSON.stringify({ status: 'queued' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }),
  });
  const body = await (await app.request('/v1/submissions/ing_2', { headers: { host: HOST } })).json();
  assert.equal(body.reviewer.model, null);
});

/* ────────────────────────────────────────────────────────────────── selection ─*/

test('the World verifiers are opt-in, and a broken configuration fails to the stub', async () => {
  assert.equal(resolveVerifiers({ env: {}, logger: quiet }).name, 'stub');
  assert.equal(resolveVerifiers({ env: { SUREX_MOCK: '1', SUREX_MOCK_ACCEPT_DISPUTES: '1' }, logger: quiet }).name, 'illustrative');
  assert.equal(resolveVerifiers({ env: { SUREX_WORLD: '1' }, logger: quiet }).name, 'agentbook+idkit');
  // real checks beat fake accepts
  assert.equal(
    resolveVerifiers({ env: { SUREX_WORLD: '1', SUREX_MOCK: '1', SUREX_MOCK_ACCEPT_DISPUTES: '1' }, logger: quiet }).name,
    'agentbook+idkit',
  );
  // an unknown network must not silently become the canonical one
  assert.equal(resolveVerifiers({ env: { SUREX_WORLD: '1', SUREX_AGENTBOOK_NETWORK: 'ethereum' }, logger: quiet }).name, 'stub');
});

test('the deployed AgentBook networks are the ones we actually checked on chain', () => {
  assert.equal(AGENT_BOOK_NETWORKS['worldchain-480'].chainId, 480);
  assert.equal(AGENT_BOOK_NETWORKS['worldchain-480'].canonical, true);
  // W4: a Base Sepolia deployment exists at the same address. It is NOT canonical.
  assert.equal(AGENT_BOOK_NETWORKS['base-sepolia-84532'].chainId, 84532);
  assert.equal(AGENT_BOOK_NETWORKS['base-sepolia-84532'].canonical, false);
  assert.equal(AGENT_BOOK_NETWORKS['base-sepolia-84532'].address, AGENT_BOOK_NETWORKS['worldchain-480'].address);
});
