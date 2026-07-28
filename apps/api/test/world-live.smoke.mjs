// Live smoke test — talks to real World Chain and the real World verify endpoint.
//
//     node apps/api/test/world-live.smoke.mjs
//
// Deliberately not in `pnpm test`: it needs the network, and a red CI run caused by
// somebody else's RPC is worse than no signal. Same convention as
// `live-arkiv.smoke.mjs`.
//
// It exists because the whole agent half of this lane is verifiable today, with no
// Orb: reading AgentBook needs nothing. Only registering an agent needs a human at
// an Orb. So this asserts, against the live chain:
//
//   1. a third-party wallet somebody really registered  → a real humanId
//   2. our own agent wallet                             → null, honestly
//   3. a dead RPC                                       → upstream_unavailable,
//                                                          never "not human-backed"
//   4. Base Sepolia's AgentBook exists and is a separate, empty registry
//   5. the live World ID verify endpoint accepts our exact request shape
//
// Row 2 is the one that flips after registration: run this again tomorrow and it
// should report our wallet as registered.
import assert from 'node:assert/strict';

import { createPublicClient, getAddress, http } from 'viem';
import { baseSepolia } from 'viem/chains';

import { AGENT_BOOK_NETWORKS, WORLD_VERIFY_BASE, createWorldVerifiers, hashToField } from '../src/verifiers.mjs';

const quiet = { warn() {}, info() {}, error() {} };

/**
 * A wallet a real person registered in AgentBook, found by reading
 * `AgentRegistered(address indexed agent, uint256 indexed humanId)` logs off World
 * Chain 480. Read-only, and the humanId is public chain data — this file asserts
 * only that it resolves to something, never what.
 */
const A_REGISTERED_AGENT = getAddress('0xea7d8b94f6e8044a22738ffe78a2cb356d114171');
const OUR_AGENT = getAddress(process.env.SUREX_AGENT_ADDRESS ?? '0xCEe6730b4aB7FFcAFfCDF59ffF4AebF94b047283');
const RPC = process.env.SUREX_WORLD_RPC_URL ?? 'https://480.rpc.thirdweb.com';

const results = [];
const step = async (label, fn) => {
  try {
    const note = await fn();
    results.push(`  ✓ ${label}${note ? ` — ${note}` : ''}`);
  } catch (err) {
    results.push(`  ✗ ${label} — ${err.message}`);
    process.exitCode = 1;
  }
};

const world = createWorldVerifiers({ env: { SUREX_WORLD: '1', SUREX_WORLD_RPC_URL: RPC }, logger: quiet });

console.log(`\nLIVE World smoke · AgentBook ${AGENT_BOOK_NETWORKS['worldchain-480'].address} · via ${RPC}\n`);

await step('a wallet a human really registered resolves to a humanId', async () => {
  const out = await world._lookupHumanStrict(A_REGISTERED_AGENT);
  assert.equal(out.ok, true, `expected standing for ${A_REGISTERED_AGENT}, got ${out.reason}: ${out.detail}`);
  assert.match(out.humanId, /^0x[0-9a-f]+$/);
  return `${A_REGISTERED_AGENT} → ${out.humanId.slice(0, 12)}…`;
});

await step('our agent wallet is reported exactly as it is', async () => {
  const out = await world._lookupHumanStrict(OUR_AGENT);
  if (out.ok) return `${OUR_AGENT} IS REGISTERED → ${out.humanId.slice(0, 12)}… (registration has happened)`;
  assert.equal(out.reason, 'no_standing', `expected a clean "not registered", got ${out.reason}: ${out.detail}`);
  return `${OUR_AGENT} not registered yet — needs one Orb-verified World App scan`;
});

await step('a dead RPC is upstream_unavailable, not a refusal', async () => {
  const broken = createWorldVerifiers({ env: { SUREX_WORLD: '1', SUREX_WORLD_RPC_URL: 'http://127.0.0.1:9' }, logger: quiet });
  const out = await broken._lookupHumanStrict(A_REGISTERED_AGENT);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'upstream_unavailable', `a dead RPC produced "${out.reason}" — that is the conflation bug reaching production`);
  return 'the SDK returns null here; we do not repeat it';
});

await step('Base Sepolia has its own AgentBook, and it is a different registry', async () => {
  const net = AGENT_BOOK_NETWORKS['base-sepolia-84532'];
  const client = createPublicClient({ chain: baseSepolia, transport: http(net.defaultRpcUrl) });
  const code = await client.getCode({ address: net.address });
  assert.ok(code && code !== '0x', 'no contract at that address on Base Sepolia');
  const onBaseSepolia = createWorldVerifiers({
    env: { SUREX_WORLD: '1', SUREX_AGENTBOOK_NETWORK: 'base-sepolia-84532' },
    logger: quiet,
  });
  const out = await onBaseSepolia._lookupHumanStrict(A_REGISTERED_AGENT);
  assert.equal(out.ok, false, 'a World Chain registration must not resolve on Base Sepolia');
  assert.equal(out.reason, 'no_standing');
  return 'deployed, readable, and holds no registration made on World Chain';
});

await step('the live World ID verify endpoint accepts our request shape', async () => {
  // A synthetic proof against a real migrated app: everything of ours is exercised —
  // URL, method, headers, body shape, response parsing — and it fails at the one
  // step we cannot fake, the zero-knowledge proof itself. That is the honest limit
  // of what is testable without a Developer Portal app of our own.
  const res = await fetch(`${WORLD_VERIFY_BASE}/app_a7c3e2b6b83927251a0db5345bd7146a`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      protocol_version: '3.0',
      nonce: '11111111-2222-3333-4444-555555555555',
      action: 'agentbook-registration',
      environment: 'staging',
      responses: [
        {
          identifier: 'orb',
          merkle_root: `0x${'0'.repeat(64)}`,
          nullifier: `0x${'1'.repeat(64)}`,
          proof: `0x${'2'.repeat(512)}`,
          signal_hash: hashToField(''),
        },
      ],
      user_presence_completed: false,
    }),
  });
  const body = await res.json();
  assert.equal(res.status, 400, `expected 400 for a synthetic proof, got ${res.status}`);
  assert.equal(body.success, false);
  // Reaching per-credential Merkle verification means every structural field passed.
  assert.equal(body.code, 'all_verifications_failed', `stopped earlier than expected: ${body.code} — ${body.detail}`);
  assert.equal(body.results?.[0]?.code, 'invalid_merkle_root');
  return 'request shape held all the way to proof verification; only the ZK proof was synthetic';
});

console.log(results.join('\n'));
console.log(
  process.exitCode
    ? '\nFAILED — read the ✗ rows above. A failure here is a real fact about the live surface.\n'
    : '\nAll live checks passed.\n',
);
