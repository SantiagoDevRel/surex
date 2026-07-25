#!/usr/bin/env node
// Preflight. Run this BEFORE a seed, every time.
//
// The point is not tidiness: the testnet faucet took 53 blind attempts to answer
// once (FRICTION-LOG S1), so a run that starts underfunded does not fail fast —
// it stalls somewhere in the middle and leaves a half-populated registry. Better
// to read four numbers first.

import { createWalrusWriter } from '../src/walrus.mjs';
import { createArkivWriter } from '../src/arkiv.mjs';
import { formatEther } from 'viem';

const fmt = (v, d) => `${(Number(v) / 10 ** d).toFixed(4)}`;

const walrusWriter = await createWalrusWriter({ log: () => {} });
const { sui, wal } = await walrusWriter.balances();
const system = await walrusWriter.systemState();
const maxEpochs = await walrusWriter.maxEpochs();

console.log('Sui / Walrus');
console.log(`  address        ${walrusWriter.address}`);
console.log(`  SUI            ${sui} MIST  (${fmt(sui, 9)} SUI)`);
console.log(`  WAL            ${wal} FROST (${fmt(wal, 9)} WAL)`);
console.log(`  walrus epoch   ${system.committee.epoch}`);
console.log(`  n_shards       ${system.committee.n_shards}   (runtime, not a constant)`);
console.log(`  max epochs     ${maxEpochs}   (on-chain future_accounting.length)`);

for (const size of [4096, 65536, 262144]) {
  const q = await walrusWriter.quote(size, maxEpochs);
  console.log(
    `  quote ${String(size).padStart(6)} B × ${maxEpochs} ep → storage ${q.storageCost} write ${q.writeCost} total ${q.totalCost} FROST`,
  );
}

const arkiv = createArkivWriter({ log: () => {} });
const health = await arkiv.health();
console.log('\nArkiv (Braga)');
console.log(`  writer         ${arkiv.address}`);
console.log(`  chainId        ${health.chainId} ${health.ok ? '' : '← NOT Braga'}`);
console.log(`  balance        ${formatEther(health.balance)} GLM`);
console.log(`  project        ${arkiv.project}`);
console.log(`  rpc ok in      ${health.ms} ms`);

if (sui === 0n) {
  console.log('\nSUI is zero. Fund before seeding; the faucet is the single biggest event risk (S1).');
  process.exitCode = 1;
}
if (wal === 0n) console.log('\nWAL is zero. createWalrusWriter().ensureWal() swaps 0.5 SUI for WAL.');
if (health.balance === 0n) {
  console.log('\nArkiv writer balance is zero — nothing will be written.');
  process.exitCode = 1;
}
