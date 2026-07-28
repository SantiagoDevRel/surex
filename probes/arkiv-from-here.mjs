/**
 * Probe: can this machine write to Arkiv, and how long does the write take?
 *
 *   node probes/arkiv-from-here.mjs
 *
 * Deliberately narrow — the counterpart to `probes/walrus-publish.mjs`, which exists
 * because Walrus turned out to be uplink-sensitive (S11). Arkiv writes are ordinary
 * JSON-RPC to one endpoint, but "no reason to expect the same failure" is not a test.
 *
 * Writes one throwaway entity under a probe-only project so nothing it does can reach
 * the registry: the API scopes every read to `surex-lisbon`, this writes `surex-probe`.
 *
 * Needs ARKIV_WRITER_PK in the environment (on the DGX: /etc/surex/ingest.env).
 */

import { createArkivWriter } from '../packages/worker/src/arkiv.mjs';

const log = (...a) => console.log(...a);
const PROBE_PROJECT = 'surex-probe';

if (!process.env.ARKIV_WRITER_PK && !process.env.SUREX_WALLETS_FILE) {
  // On the DGX the key is in the unit's EnvironmentFile, not in a login shell.
  log('note: ARKIV_WRITER_PK is not set; falling back to the wallets file, which');
  log('      does not exist on a deployment host. On the DGX run this as:');
  log('      set -a; . /etc/surex/ingest.env; set +a; node probes/arkiv-from-here.mjs');
}

const arkiv = createArkivWriter({ log: (m) => log(' ', m), project: PROBE_PROJECT });

log('# 1. reachability');
const health = await arkiv.health();
log('  rpc      :', health.rpcUrl);
log('  chainId  :', health.chainId, health.ok ? '(Braga, as expected)' : '(NOT Braga — wrong chain)');
log('  balance  :', String(health.balance));
log('  handshake:', health.ms, 'ms');
if (!health.ok) throw new Error(`connected to chain ${health.chainId}, expected Braga`);
if (BigInt(health.balance ?? 0n) === 0n) {
  throw new Error('the writer wallet has no balance on this chain — the write would stall one tx in');
}

log('\n# 2. one throwaway write');
const fingerprint = `sxf1_probe_${Date.now().toString(36)}`;
const built = {
  payload: { probe: 'arkiv-from-here', writtenAt: new Date().toISOString() },
  // Scoped to the probe project, so a read of the real registry cannot pick this up.
  attributes: [
    { key: 'project', value: PROBE_PROJECT },
    { key: 'entityType', value: 'probe' },
    { key: 'fingerprint', value: fingerprint },
  ],
  // Seconds, and an even number of them: 0.7.0 throws InvalidExpirationError on an
  // odd value where 0.6.8 silently rounded (A3).
  expiresIn: 3600,
};

const startedAt = Date.now();
const created = await arkiv.create(built);
log('  wrote in :', Date.now() - startedAt, 'ms');
log('  entity   :', created?.entityKey ?? created?.key ?? JSON.stringify(created).slice(0, 120));

log('\n# 3. read it back through the query index the gate uses');
const indexed = await arkiv.waitForIndexed({ entityType: 'probe', fingerprint });
if (!indexed.entities.length) {
  throw new Error('the write succeeded but never appeared in the query index');
}
log('  indexed in:', indexed.ms, 'ms after the receipt');

log('\n================ RESULT ================');
log('Arkiv writes work from this machine.');
log(`  handshake ${health.ms} ms · write ${Date.now() - startedAt} ms · index ${indexed.ms} ms`);
log('========================================');
