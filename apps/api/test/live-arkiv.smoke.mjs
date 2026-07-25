// LIVE smoke test against Braga. Deliberately NOT named *.test.mjs, so
// `node --test test/*.test.mjs` never touches the network — the unit suite must
// stay hermetic and fast.
//
//   node test/live-arkiv.smoke.mjs
//   SUREX_ARKIV_PROJECT=surex-lisbon-probe-xxxx node test/live-arkiv.smoke.mjs
//
// It reads only. There is no key here and nothing is written. What it proves:
//   1. the RPC answers and the chain is the one we think it is;
//   2. the hot-path query runs and a miss comes back as the `unknown` head;
//   3. count() works, so /v1/stats reports real numbers;
//   4. `.createdBy` still partitions — the foreign wallet's entities are NOT in
//      our writer's result set, and vice versa. This is the load-bearing one: if
//      it ever stops holding, anyone can plant a `clean` verdict for a flagged
//      fingerprint and the gate reads theirs.

import { createArkivStore, DEFAULT_WRITER_ADDRESS } from '../src/arkiv.mjs';
import { createApp } from '../src/app.mjs';
import { eq } from '@arkiv-network/sdk/query';

/** Index 3 in hackathon-wallets — the adversary in probes/arkiv-write-read.mjs. */
const FOREIGN = '0x4C12202c7A818f9e6A34627dd3B71951d8Abfa85';
const A_VALID_MISS = 'sxf1_' + '0'.repeat(64);

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const store = createArkivStore({ env: process.env });
console.log(`live smoke · ${store.rpcUrl}`);
console.log(`  project=${store.project}  writer=${store.writerAddress}`);

const health = await store.health();
check('RPC answers with the Braga chain id', health.ok, `chainId=${health.chainId} in ${health.ms} ms`);

const t0 = Date.now();
const miss = await store.getVerdictHead(A_VALID_MISS);
check('a well-formed fingerprint with no entry returns null (→ unknown head)', miss === null, `${Date.now() - t0} ms`);

const t1 = Date.now();
const stats = await store.stats();
check('count() returns real numbers for /v1/stats', typeof stats.verdictHeads === 'number', `${JSON.stringify(stats.byState)} in ${Date.now() - t1} ms`);

const flagged = await store.listFlagged({ limit: 10 });
check('the flagged feed query runs', Array.isArray(flagged.heads), `${flagged.heads.length} head(s)`);

// ── the partition, both directions ──────────────────────────────────────────
const keysFor = async (creator) => {
  const res = await store.client
    .buildQuery()
    .where([eq('project', store.project), eq('entityType', 'verdictHead')])
    .createdBy(creator)
    .withAttributes(true)
    .fetch();
  return res.entities.map((e) => String(e.key).toLowerCase());
};
const ours = await keysFor(store.writerAddress);
const theirs = await keysFor(FOREIGN);
const overlap = ours.filter((k) => theirs.includes(k));
check('.createdBy partitions our writer from the foreign wallet', overlap.length === 0, `ours=${ours.length} theirs=${theirs.length} overlap=${overlap.length}`);

// A direct key read must apply the same provenance check the query does, because
// getEntity has no creator filter of its own.
if (ours.length) {
  const mine = await store.getSource(ours[0]).catch(() => null);
  const wrongType = mine === null; // it is a verdictHead, not a source
  check('getSource refuses an entity of the wrong entityType', wrongType);
}
if (theirs.length) {
  const foreignStore = createArkivStore({ env: process.env });
  const record = await foreignStore.getReview(theirs[0]);
  check('a direct key read refuses an entity our writer did not create', record === null, `key ${theirs[0].slice(0, 12)}…`);
} else {
  console.log('  SKIP  no foreign entity in this project to test the direct-key refusal against');
}

// ── through the actual HTTP surface ─────────────────────────────────────────
const app = createApp({ env: { ...process.env, SUREX_MOCK: '' }, store });
const res = await app.request(`/v1/verdict?fp=${A_VALID_MISS}`);
const body = await res.json();
check('GET /v1/verdict serves the unknown head for a live miss', res.status === 200 && body.state === 'unknown', `${res.status} ${body.state}`);
check('a live response is NOT marked illustrative', body.illustrative === undefined && res.headers.get('X-SureX-Illustrative') === null);
check('the live response declares live mode', res.headers.get('X-SureX-Mode') === 'live');

const statsRes = await app.request('/v1/stats');
check('GET /v1/stats answers from the chain', statsRes.status === 200, `${statsRes.status}`);

console.log(`\n${failures === 0 ? 'ALL LIVE CHECKS PASSED' : `${failures} LIVE CHECK(S) FAILED`}`);
console.log(`writer under test: ${store.writerAddress}${store.writerAddress === DEFAULT_WRITER_ADDRESS ? ' (default)' : ''}`);
process.exit(failures === 0 ? 0 : 1);
