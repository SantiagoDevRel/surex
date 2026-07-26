#!/usr/bin/env node
// One command. Register SureX's agent wallet in World AgentBook, then confirm it.
//
//     node scripts/register-agent.mjs
//
// What happens: the address is printed, `@worldcoin/agentkit-cli register` draws a
// QR in this terminal, a human scans it in World App, and the hosted relay submits
// the transaction. Then this script confirms twice — once with the CLI's own
// `status`, once with an independent `lookupHuman` read through the same code path
// the API uses to gate disputes.
//
// Three things to know before running it:
//
// 1. REGISTRATION IS GASLESS — a hosted relay pays, so the agent wallet needs no
//    balance on any chain. Do not fund it first.
// 2. IT NEEDS AN ORB-VERIFIED WORLD ID. The contract checks `groupId = 1` and only
//    Orb credentials exist on chain, so device-level and Selfie Check cannot
//    register an agent. No amount of code removes that.
// 3. DO NOT PASS `--network`. The shipped CLI 0.2.0 has no such option and hardcodes
//    World Chain; its own npm README and REGISTRATION.md document
//    `--network base | base-sepolia` and are stale. (FRICTION-LOG W2)
//
// Nothing here writes a private key anywhere, and nothing prints one.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { getAddress } from 'viem';
import { privateKeyToAddress } from 'viem/accounts';

import {
  AGENT_BOOK_NETWORKS,
  DEFAULT_AGENT_BOOK_NETWORK,
  createWorldVerifiers,
} from '../apps/api/src/verifiers.mjs';

const CLI = '@worldcoin/agentkit-cli';
const NETWORK = AGENT_BOOK_NETWORKS[DEFAULT_AGENT_BOOK_NETWORK];

const line = (char = '─') => console.log(char.repeat(74));
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

function resolveAddress() {
  const explicit = flag('address') ?? process.env.SUREX_AGENT_ADDRESS;
  if (explicit) return { address: getAddress(explicit.trim()), source: flag('address') ? '--address' : 'SUREX_AGENT_ADDRESS' };

  // Derived from the key, never printed, so the address on screen is provably the
  // one the agent will actually sign with.
  const key = process.env.SUREX_AGENT_PRIVATE_KEY;
  if (key) return { address: privateKeyToAddress(key.trim().startsWith('0x') ? key.trim() : `0x${key.trim()}`), source: 'SUREX_AGENT_PRIVATE_KEY (derived; the key is not printed)' };

  // Last resort: the wallet file, which lives outside this repo on purpose.
  const walletFile = flag('wallet-file') ?? process.env.SUREX_WALLET_FILE;
  const label = flag('wallet') ?? 'agent-prod';
  if (walletFile) {
    const text = readFileSync(walletFile, 'utf8');
    const section = text.split(/^\[/m).find((s) => s.startsWith(`${label}]`));
    const found = section?.match(/address\s*=\s*(0x[0-9a-fA-F]{40})/)?.[1];
    if (found) return { address: getAddress(found), source: `${walletFile} [${label}]` };
  }
  return null;
}

const resolved = resolveAddress();
if (!resolved) {
  console.error(`
Nothing to register: no agent address was given.

  node scripts/register-agent.mjs --address 0xYourAgentWallet
  SUREX_AGENT_ADDRESS=0x… node scripts/register-agent.mjs
  node scripts/register-agent.mjs --wallet-file /abs/path/surex-wallets.txt --wallet agent-prod

The wallet file is deliberately outside this repo — private keys never enter it.
`);
  process.exit(2);
}

const { address, source } = resolved;

line('═');
console.log('  REGISTER THE SUREX AGENT IN WORLD AGENTBOOK');
line('═');
console.log(`
  address to register   ${address}
  read from             ${source}

  contract              ${NETWORK.address}
  chain                 World Chain (${NETWORK.caip2})
  read through          ${process.env.SUREX_WORLD_RPC_URL || NETWORK.defaultRpcUrl}

  cost to you           NOTHING. Registration is gasless — a hosted relay pays the
                        transaction, so this wallet needs no balance on any chain.
  what you need         a phone with World App, and an Orb-verified World ID. The
                        contract checks groupId = 1, and only Orb credentials exist
                        on chain: device-level and Selfie Check cannot register.
  what it grants        an agent signing with this wallet gains STANDING TO CONTEST
                        a SureX verdict. Not access, not a discount, and no claim
                        that any particular rebuttal is right.
`);
line();

const verifiers = createWorldVerifiers({
  env: { ...process.env, SUREX_WORLD: '1' },
  logger: { warn() {}, info() {}, error: console.error },
});

async function readStanding(label) {
  const out = await verifiers._lookupHumanStrict(address);
  if (out.ok) {
    console.log(`  ${label}: REGISTERED — AgentBook resolves this wallet to human ${out.humanId}`);
    return 'registered';
  }
  if (out.reason === 'upstream_unavailable') {
    console.log(`  ${label}: COULD NOT TELL — ${out.detail}`);
    return 'unknown';
  }
  console.log(`  ${label}: not registered (lookupHuman returned 0)`);
  return 'absent';
}

console.log('\n▸ Before:');
const before = await readStanding('AgentBook');
if (before === 'registered') {
  console.log(`
  Nothing to do — this wallet is already registered, and re-registering would only
  burn the nonce. Point the API at it:

      SUREX_WORLD=1
      SUREX_AGENT_ADDRESS=${address}
`);
  process.exit(0);
}
if (before === 'unknown') {
  console.log(`
  Stopping. AgentBook could not be read, so whether this wallet is already
  registered is unknown, and running the CLI blind is how you end up debugging a
  registration that had already happened. Fix the RPC (SUREX_WORLD_RPC_URL) and
  re-run. Pass --force to register anyway.
`);
  if (!args.includes('--force')) process.exit(1);
}

function run(label, cliArgs) {
  return new Promise((resolve) => {
    line();
    console.log(`▸ ${label}\n  $ npx ${CLI} ${cliArgs.join(' ')}\n`);
    // NOTE: no `--network`. The shipped 0.2.0 binary has no such option (W2).
    // shell:true because on Windows `npx` is a .cmd shim and spawn cannot exec it.
    const child = spawn('npx', ['--yes', CLI, ...cliArgs], { stdio: 'inherit', shell: true });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', (err) => {
      console.error(`  could not start npx: ${err.message}`);
      resolve(1);
    });
  });
}

console.log(`
  SCAN THE QR THAT APPEARS BELOW, in World App, on the phone holding the
  Orb-verified World ID. That scan is the only manual step left.
`);
const registerCode = await run('register', ['register', address]);
if (registerCode !== 0) {
  console.error(`
  The CLI exited ${registerCode}. Things that produce that, in order of likelihood:
    · the QR was never scanned, or the World App flow was cancelled
    · the World ID used is not Orb-verified — the contract will not accept it
    · a stale --network flag was added: 0.2.0 has no such option (W2)
  Nothing was written on chain if registration did not complete. Re-run to retry.
`);
}

await run('status', ['status', address]);

line();
console.log('▸ After:');
const after = await readStanding('AgentBook');

line('═');
if (after === 'registered') {
  console.log(`
  DONE. AgentBook now resolves ${address} to an anonymous human identifier, read
  back through the same code path the API uses to gate POST /v1/disputes.

  Put this in the API environment:

      SUREX_WORLD=1
      SUREX_WORLD_RPC_URL=<your own World Chain RPC, not the shared public one>
      SUREX_AGENT_ADDRESS=${address}

  Then prove the gate end to end, both directions:

      node scripts/agent-dispute.mjs          # this wallet   → 202 accepted
      node scripts/agent-dispute.mjs --spare  # an unregistered one → 403 refused
`);
  process.exit(0);
}
console.log(`
  NOT REGISTERED. Whatever the CLI printed above, AgentBook still resolves this
  wallet to 0, so the API will keep refusing disputes from it with
  403 agent_not_human_backed — which is the correct answer, not a bug to work
  around. Re-run once the World App flow completes with an Orb-verified ID.
`);
process.exit(1);
