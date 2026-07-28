/**
 * Probe — Arkiv (Braga testnet): write one entity, read it back filtered by
 * `.createdBy(WRITER)`, and prove that filter excludes a colliding entity written by
 * a different wallet. Throwaway verification, not product code. It answers:
 *
 *   1. Does a write + `.createdBy` read round-trip at all?
 *   2. Does `.createdBy` actually exclude a foreign write with the same
 *      project + entityType + fingerprint? (load-bearing: a shared public
 *      testnet has no uniqueness constraint — without the filter, anyone can
 *      write a colliding verdict and the gate would read theirs.)
 *   3. What is the real indexing lag between the tx receipt and (a) getEntity
 *      and (b) the query index the gate actually reads from?
 *   4. What are the real semantics/units of `expiresIn`?
 *   5. Does `orderBy` exist and does it do anything?
 *   6. Is `updateEntity` really a full replacement that silently drops an
 *      entity out of a scoped query if an attribute is not re-included?
 *
 * Secrets: keys come from env only. Never hardcode, never log.
 *   ARKIV_WRITER_PK   — funded writer (the SureX Arkiv writer)
 *   ARKIV_FOREIGN_PK  — a different funded wallet, plays the attacker
 *
 * Run:  node probes/arkiv-write-read.mjs
 */
import { createPublicClient, createWalletClient } from '@arkiv-network/sdk'
import { braga } from '@arkiv-network/sdk/chains'
import { eq } from '@arkiv-network/sdk/query'
import { jsonToPayload } from '@arkiv-network/sdk/utils'
// `http` and `privateKeyToAccount` come from viem directly: SDK 0.7.0 removed the
// re-exports 0.6.8 had, so every 0.6.x snippet breaks at import (FRICTION-LOG A1).
import { http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const RPC = process.env.ARKIV_RPC_URL || 'https://braga.hoodi.arkiv.network/rpc'
const EXPIRES_IN = 3600 // seconds. Must be a positive integer and a multiple of 2 (block time) in SDK 0.7.0.

const need = (n) => {
  const v = (process.env[n] || '').trim()
  if (!v) throw new Error(`${n} not set — pass keys via env, never in the repo`)
  return v.startsWith('0x') ? v : '0x' + v
}
const writerAcct = privateKeyToAccount(need('ARKIV_WRITER_PK'))
const foreignAcct = privateKeyToAccount(need('ARKIV_FOREIGN_PK'))

const pub = createPublicClient({ chain: braga, transport: http(RPC) })
const writer = createWalletClient({ chain: braga, account: writerAcct, transport: http(RPC) })
const foreign = createWalletClient({ chain: braga, account: foreignAcct, transport: http(RPC) })

// Unique per run so re-runs never collide with an earlier run's entities.
const RUN = Date.now().toString(36)
const PROJECT = `surex-lisbon-probe-${RUN}`
const FINGERPRINT = `sxf1_${[...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('')}`

const log = (...a) => console.log(...a)
const step = (n, t) => log(`\n── ${n} · ${t} ${'─'.repeat(Math.max(0, 58 - t.length))}`)
const results = {}
let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  results[name] = ok
}

const attrsFor = (state, severity, tier) => [
  { key: 'project', value: PROJECT },
  { key: 'entityType', value: 'verdictHead' },
  { key: 'fingerprint', value: FINGERPRINT },
  { key: 'state', value: state },
  { key: 'severity', value: severity },
  { key: 'tier', value: tier },
]

// The verdict body never lives on Arkiv — Arkiv holds the queryable head pointing at
// the content-addressed blob. Clearly-labelled fake pointer here.
const payloadFor = (who) =>
  jsonToPayload({
    schema: 'surex.verdictHead/probe',
    note: 'PROBE — NOT A REAL VERDICT. Blob pointer below is fake.',
    writtenBy: who,
    sourceBlobId: 'FAKE_BLOB_source_0000000000000000000000000000000000000000000',
    verdictBlobId: 'FAKE_BLOB_verdict_000000000000000000000000000000000000000000',
    reviewedAt: new Date().toISOString(),
  })

const baseWhere = () => [
  eq('project', PROJECT),
  eq('entityType', 'verdictHead'),
  eq('fingerprint', FINGERPRINT),
]

/** Scoped query. Pass an address to filter by creator, or null for unfiltered. */
async function findByCreator(creator, { payload = false, limit } = {}) {
  let q = pub.buildQuery().where(baseWhere()).withAttributes(true).withMetadata(true)
  if (payload) q = q.withPayload(true)
  if (creator) q = q.createdBy(creator)
  if (limit) q = q.limit(limit)
  const res = await q.fetch()
  return res.entities
}

const keysOf = (entities) => entities.map((e) => String(e.key).toLowerCase())
const attr = (e, k) => e.attributes?.find((a) => a.key === k)?.value

async function pollUntil(fn, { timeoutMs = 15000, intervalMs = 250 } = {}) {
  const t0 = Date.now()
  let attempts = 0
  for (;;) {
    attempts++
    try {
      const v = await fn()
      if (v) return { ms: Date.now() - t0, attempts, value: v }
    } catch {
      /* not indexed yet */
    }
    if (Date.now() - t0 > timeoutMs) return { ms: null, attempts, value: null }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

async function main() {
  log(`Arkiv probe — Braga (${braga.id}) via ${RPC}`)
  log(`  writer  ${writerAcct.address}`)
  log(`  foreign ${foreignAcct.address}`)
  log(`  project ${PROJECT}`)
  log(`  fingerprint ${FINGERPRINT}`)

  // ── 0 · expiresIn semantics ────────────────────────────────────────────────
  // Cheap, offline: validation happens while encoding the tx, before it is sent.
  step(0, 'expiresIn semantics')
  let oddErr = null
  try {
    await writer.createEntity({
      payload: payloadFor('probe'),
      attributes: attrsFor('flagged', 4, 'B'),
      contentType: 'application/json',
      expiresIn: 3601, // odd number of seconds
    })
  } catch (e) {
    oddErr = e
  }
  check('expiresIn rejects a non-multiple-of-2 value', !!oddErr, oddErr ? `${oddErr.constructor.name}` : 'IT WAS ACCEPTED')
  results._expiresInOddError = oddErr ? `${oddErr.constructor.name}: ${oddErr.message}` : null

  // ── 1 · write ours ─────────────────────────────────────────────────────────
  step(1, 'WRITE — one verdictHead from the writer wallet')
  const tWrite = Date.now()
  const ours = await writer.createEntity({
    payload: payloadFor('writer'),
    attributes: attrsFor('flagged', 4, 'B'),
    contentType: 'application/json',
    expiresIn: EXPIRES_IN,
  })
  const writeMs = Date.now() - tWrite
  log(`  entityKey ${ours.entityKey}`)
  log(`  txHash    ${ours.txHash}`)
  log(`  createEntity() returned in ${writeMs} ms (it waits for the receipt)`)
  results.entityKey = ours.entityKey
  results.txHash = ours.txHash

  // ── 2 · index lag ──────────────────────────────────────────────────────────
  step(2, 'INDEX LAG — receipt → getEntity, and receipt → query index')
  const t0 = Date.now()
  const getLag = await pollUntil(async () => await pub.getEntity(ours.entityKey))
  log(`  getEntity visible after ${getLag.ms} ms (${getLag.attempts} polls)`)
  const queryLag = await pollUntil(async () => {
    const e = await findByCreator(writerAcct.address)
    return e.length > 0 ? e : null
  })
  log(`  query index visible after ${Date.now() - t0} ms total (${queryLag.attempts} polls after getEntity)`)
  check('entity readable via getEntity', getLag.value !== null, `${getLag.ms} ms`)
  check('entity readable via the query index', queryLag.value !== null, `${queryLag.ms} ms after getEntity`)
  results.getEntityLagMs = getLag.ms
  results.queryLagAfterGetEntityMs = queryLag.ms
  results.totalIndexLagMs = getLag.ms === null ? null : getLag.ms + (queryLag.ms ?? 0)

  const got = getLag.value
  if (got) {
    log(`  creator=${got.creator}  owner=${got.owner}`)
    log(`  createdAtBlock=${got.createdAtBlock}  expiresAtBlock=${got.expiresAtBlock}  Δ=${got.expiresAtBlock - got.createdAtBlock} blocks`)
    results.expiryBlocks = Number(got.expiresAtBlock - got.createdAtBlock)
    check(
      `expiresIn ${EXPIRES_IN}s == ${EXPIRES_IN / 2} blocks on chain`,
      Number(got.expiresAtBlock - got.createdAtBlock) === EXPIRES_IN / 2,
      `got ${got.expiresAtBlock - got.createdAtBlock}`,
    )
  }

  // ── 3 · read it back, filtered ─────────────────────────────────────────────
  step(3, 'READ — .createdBy(writer) with payload, limit 1')
  const mine = await findByCreator(writerAcct.address, { payload: true, limit: 1 })
  check('exactly 1 entity returned', mine.length === 1, `got ${mine.length}`)
  if (mine.length === 1) {
    const e = mine[0]
    check('it is the entity we wrote', String(e.key).toLowerCase() === ours.entityKey.toLowerCase())
    check('creator == writer', String(e.creator).toLowerCase() === writerAcct.address.toLowerCase())
    check('attributes round-tripped', attr(e, 'state') === 'flagged' && Number(attr(e, 'severity')) === 4 && attr(e, 'tier') === 'B')
    const body = e.toJson()
    check('payload round-tripped', body.schema === 'surex.verdictHead/probe')
  }

  // ── 4 · the adversarial half ───────────────────────────────────────────────
  step(4, 'COLLISION — same project+entityType+fingerprint, DIFFERENT wallet')
  const theirs = await foreign.createEntity({
    payload: payloadFor('foreign-attacker'),
    // Same identity attributes, different verdict — the attack itself.
    attributes: attrsFor('clean', 0, 'A'),
    contentType: 'application/json',
    expiresIn: EXPIRES_IN,
  })
  log(`  foreign entityKey ${theirs.entityKey}`)
  log(`  foreign txHash    ${theirs.txHash}`)
  results.foreignEntityKey = theirs.entityKey
  results.foreignTxHash = theirs.txHash

  const foreignVisible = await pollUntil(async () => {
    const e = await findByCreator(foreignAcct.address)
    return e.length > 0 ? e : null
  })
  check('foreign entity is indexed (so the test is real)', foreignVisible.value !== null, `${foreignVisible.ms} ms`)

  const unfiltered = await findByCreator(null)
  check(
    'UNFILTERED query returns BOTH (the collision is real)',
    unfiltered.length === 2 &&
      keysOf(unfiltered).includes(ours.entityKey.toLowerCase()) &&
      keysOf(unfiltered).includes(theirs.entityKey.toLowerCase()),
    `got ${unfiltered.length}: ${keysOf(unfiltered).join(', ')}`,
  )

  const filtered = await findByCreator(writerAcct.address)
  check(
    '.createdBy(WRITER) EXCLUDES the foreign write',
    filtered.length === 1 && keysOf(filtered)[0] === ours.entityKey.toLowerCase(),
    `got ${filtered.length}: ${keysOf(filtered).join(', ')}`,
  )
  check(
    '.createdBy(WRITER) never returns the attacker verdict',
    !keysOf(filtered).includes(theirs.entityKey.toLowerCase()),
  )
  const inverse = await findByCreator(foreignAcct.address)
  check(
    '.createdBy(FOREIGN) returns ONLY the foreign write',
    inverse.length === 1 && keysOf(inverse)[0] === theirs.entityKey.toLowerCase(),
    `got ${inverse.length}: ${keysOf(inverse).join(', ')}`,
  )

  // ── 5 · does orderBy do anything? ──────────────────────────────────────────
  // The writer's entity has severity 4, the foreign one severity 0 — so if server-side
  // ordering worked, asc and desc would differ.
  step(5, 'orderBy — does it exist, and does it do anything?')
  let orderByThrew = null
  let ascKeys = [], descKeys = []
  try {
    const a = await pub.buildQuery().where(baseWhere()).withAttributes(true).orderBy('severity', 'number', 'asc').fetch()
    const d = await pub.buildQuery().where(baseWhere()).withAttributes(true).orderBy('severity', 'number', 'desc').fetch()
    ascKeys = keysOf(a.entities)
    descKeys = keysOf(d.entities)
    log(`  asc  → ${ascKeys.map((k) => k.slice(0, 12)).join(', ')}  severities ${a.entities.map((e) => attr(e, 'severity')).join(',')}`)
    log(`  desc → ${descKeys.map((k) => k.slice(0, 12)).join(', ')}  severities ${d.entities.map((e) => attr(e, 'severity')).join(',')}`)
  } catch (e) {
    orderByThrew = e
    log(`  orderBy threw: ${e.message}`)
  }
  const orderByWorks = !orderByThrew && ascKeys.length === 2 && ascKeys.join() !== descKeys.join()
  results.orderByExists = !orderByThrew
  results.orderByHasEffect = orderByWorks
  log(`  → orderBy on the builder: ${orderByThrew ? 'THREW' : 'accepted silently'}; effect on result order: ${orderByWorks ? 'YES' : 'NONE'}`)

  // ── 6 · updateEntity is a full replacement ─────────────────────────────────
  step(6, 'updateEntity — full replacement, and the silent drop-out')
  const upd = await writer.updateEntity({
    entityKey: ours.entityKey,
    payload: payloadFor('writer-updated'),
    contentType: 'application/json',
    expiresIn: EXPIRES_IN,
    // Deliberately drop `project` — everything else re-included.
    attributes: [
      { key: 'entityType', value: 'verdictHead' },
      { key: 'fingerprint', value: FINGERPRINT },
      { key: 'state', value: 'flagged' },
      { key: 'severity', value: 4 },
      { key: 'tier', value: 'B' },
    ],
  })
  log(`  update txHash ${upd.txHash}`)
  const dropped = await pollUntil(async () => {
    const e = await findByCreator(writerAcct.address)
    return e.length === 0 ? 'gone' : null
  }, { timeoutMs: 15000 })
  check(
    'dropping an attribute removes the entity from the scoped query',
    dropped.value === 'gone',
    dropped.value === 'gone' ? `disappeared after ${dropped.ms} ms` : 'still returned — full-replace may NOT apply',
  )
  const stillThere = await pub.getEntity(ours.entityKey).then(() => true).catch(() => false)
  check('the entity itself still exists (it was scoped out, not deleted)', stillThere)

  // Restore, so the entity is back in scope for anyone inspecting it later.
  const restore = await writer.updateEntity({
    entityKey: ours.entityKey,
    payload: payloadFor('writer-restored'),
    contentType: 'application/json',
    expiresIn: EXPIRES_IN,
    attributes: attrsFor('flagged', 4, 'B'),
  })
  log(`  restore txHash ${restore.txHash}`)
  const back = await pollUntil(async () => {
    const e = await findByCreator(writerAcct.address)
    return e.length === 1 ? e : null
  })
  check('re-including the attribute brings it back', back.value !== null, `${back.ms} ms`)

  // ── summary ────────────────────────────────────────────────────────────────
  step('✓', 'SUMMARY')
  log(JSON.stringify(results, null, 2))
  log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('\nPROBE ABORTED:', e)
  process.exit(2)
})
