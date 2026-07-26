#!/usr/bin/env node
// The agent side of the AgentKit gate: an autonomous agent contests a SureX verdict.
//
//     node scripts/agent-dispute.mjs --api http://localhost:4310 --fp sxf1_…
//
// Run it twice to see the whole point of the integration:
//   · with a wallet a human registered in AgentBook   → 202 accepted, standing granted
//   · with a wallet nobody registered                 → 403 agent_not_human_backed
//
// 🐛 Do NOT rewrite this on top of `agentkit.fetch`: it silently does nothing against
// current `@x402/hono`. It reads the challenge from the response BODY
// (`.extensions.agentkit`), but x402 2.19 returns body `{}` and puts the challenge in
// a base64 `payment-required` HEADER — so it bails through a bare `return response`
// with no signature, no retry, no thrown error and not one `onEvent`, which from
// outside looks exactly like the server rejecting a legitimate agent. Read the
// challenge, call `agentkit.createHeader(challenge)`, retry by hand; `createHeader`
// itself is fine. (FRICTION-LOG W1, reproduced.)
//
// SureX serves the challenge in the body of its 401 rather than through @x402/hono
// because this is IDENTITY, not payment — x402 payment flows are out of scope
// (AGENTS.md §5).

import { createAgentkitClient } from '@worldcoin/agentkit';
import { privateKeyToAccount } from 'viem/accounts';
import { getAddress } from 'viem';

import { disputeSignal, evidenceHashOf } from '../apps/api/src/verifiers.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const API = (flag('api', process.env.SUREX_API ?? 'http://localhost:4310')).replace(/\/+$/, '');
const CHAIN_ID = flag('chain', 'eip155:480');
const KEY = flag('key', process.env.SUREX_AGENT_PRIVATE_KEY);

if (!KEY) {
  console.error(`
An agent signs its own request, so this needs the agent wallet's key — in the
environment, never on the command line of a shared machine and never in this repo:

    SUREX_AGENT_PRIVATE_KEY=0x… node scripts/agent-dispute.mjs

Keys live in claude-code-environment/.secrets/. The address is derived from the key
and printed; the key is not.
`);
  process.exit(2);
}

const account = privateKeyToAccount(KEY.startsWith('0x') ? KEY : `0x${KEY}`);
const agentkit = createAgentkitClient({
  signer: {
    address: account.address,
    chainId: CHAIN_ID,
    type: 'eip191',
    signMessage: (message) => account.signMessage({ message }),
  },
  onEvent: (event) => console.log(`  [agentkit event] ${event.type}${event.reason ? `: ${event.reason}` : ''}`),
});

const fingerprint = flag('fp', process.env.SUREX_DISPUTE_FP);
const evidence = flag(
  'evidence',
  'The flagged shell-execution path is behind a build-time feature flag that is off in the published artifact. See src/exec.ts:42 and the release workflow.',
);
if (!fingerprint) {
  console.error('Nothing to contest. Pass --fp sxf1_… (a fingerprint the registry has a live verdict for).');
  process.exit(2);
}

const body = { fingerprint, evidence, contestantType: 'agent' };

console.log(`
agent        ${account.address}
signs on     ${CHAIN_ID}
api          ${API}
contesting   ${fingerprint}
`);

const post = (headers = {}) =>
  fetch(`${API}/v1/disputes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

console.log('▸ 1. POST with no signature — expected 401 carrying a challenge');
let res = await post();
let payload = await res.json().catch(() => null);
console.log(`     ← ${res.status} ${payload?.error?.code ?? ''} ${payload?.error?.reason ?? ''}`);

if (res.status === 202) {
  console.error('\n  ✗ The server accepted an UNSIGNED dispute. The identity gate is not load-bearing.');
  process.exit(1);
}

const challenge = payload?.error?.challenge?.agentkit;
if (!challenge) {
  console.error(`
  ✗ No challenge in the refusal, so there is nothing to sign.
    ${payload?.error?.message ?? '(no message)'}
    ${payload?.error?.detail ?? ''}
  If the reason is world_id_not_configured this request took the HUMAN path — send
  contestantType:"agent" (this script does) and check the API is running the World
  verifiers (SUREX_WORLD=1).
`);
  process.exit(1);
}

console.log('\n▸ 2. Sign the challenge with createHeader() — NOT agentkit.fetch (see the header of this file)');
const requestId = disputeSignal({ verdictKey: fingerprint, evidenceHash: evidenceHashOf(body) });
const header = await agentkit.createHeader({
  ...challenge,
  // Binds the signature to THIS rebuttal: the AgentKit SIWE message covers domain,
  // uri, nonce and time but not the evidence, so without it a captured header could
  // file a different dispute for the life of the nonce.
  info: { ...challenge.info, requestId },
});
console.log(`     signed. requestId ${requestId.slice(0, 16)}…  header ${header.length} chars`);

console.log('\n▸ 3. Retry with the agentkit header');
res = await post({ agentkit: header });
payload = await res.json().catch(() => null);
console.log(`     ← ${res.status}`);
console.log(JSON.stringify(payload, null, 2));

console.log('');
if (res.status === 202) {
  const standing = payload?.dispute?.standing ?? {};
  console.log(`✓ ACCEPTED. A human stands behind ${standing.agentAddress ?? account.address}; AgentBook resolved it to ${standing.humanId}.`);
  console.log(`  ${payload?.enforcement}`);
  console.log('  Standing is permission to be heard. It is not permission to pass, and it does not make the rebuttal right.');
  process.exit(0);
}
if (res.status === 403 && payload?.error?.code === 'agent_not_human_backed') {
  console.log(`✓ REFUSED, correctly: ${payload.error.reason} — ${payload.error.detail}`);
  console.log('  Register this wallet: node scripts/register-agent.mjs --address ' + getAddress(account.address));
  process.exit(0);
}
if (res.status === 503) {
  console.log('⚠ The identity check could not be COMPLETED — standing is unknown, and this is explicitly not a refusal of the agent.');
  console.log(`  ${payload?.error?.detail ?? ''}`);
  console.log('  This is the case that must never be reported as agent_not_human_backed. Retry, or set SUREX_WORLD_RPC_URL.');
  process.exit(0);
}
console.log(`✗ Unexpected: ${res.status} ${payload?.error?.code ?? ''} — ${payload?.error?.detail ?? payload?.error?.message ?? ''}`);
process.exit(1);
