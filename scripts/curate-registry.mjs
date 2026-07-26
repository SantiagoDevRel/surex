#!/usr/bin/env node
// Cut the registry down to what it can actually stand behind.
//
//   node scripts/curate-registry.mjs --dry-run     # print the plan, touch nothing
//   node scripts/curate-registry.mjs               # do it
//
// What may be removed, and why that list is short. AGENTS.md §4: a verdict is
// **superseded, never deleted**, or a registry becomes a place where inconvenient
// findings quietly stop existing. Exactly three categories fall outside that rule:
//
//   1. `unknown` heads — seeding placeholders. `packages/core/src/verdict.mjs`
//      defines `unknown` as the absence of an entry, so a stored `unknown` head is a
//      record asserting there is no record. Deleting it removes no finding.
//   2. Verdicts about SureX's own fixtures. The rule exists so an accusation against
//      somebody else cannot be made to disappear; retiring a review of a server this
//      project wrote hides nothing from anyone.
//   3. A third party's `unreviewable` — no conclusion was ever reached. See the note
//      on `assertRemovable`, which is where that case is argued and enforced.
//
// A third party's reached verdict is never removable, whatever the plan says.

import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createArkivWriter } from '../packages/worker/index.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const log = (...a) => console.log(...a);

/**
 * The three servers the demo drives the gate against, one per branch of `decide()`:
 *
 *   honest-weather        clean,   severity 0  → allow
 *   ambiguous-telemetry   flagged, severity 2  → warn  ("are you sureX…?")
 *   mal-tool-shadow       flagged, severity 3  → ask   (stop; the human answers)
 */
export const DEMO_SET = Object.freeze([
  '@surex/honest-weather',
  '@surex/ambiguous-telemetry',
  '@surex/mal-tool-shadow',
]);

/** The whole registry, named — everything not on it goes. */
export const KEEP = Object.freeze([
  ...DEMO_SET,
  // Third-party servers that carry a real reviewed verdict.
  '@playwright/mcp',
  '@modelcontextprotocol/server-redis',
  '@modelcontextprotocol/server-memory',
  '@modelcontextprotocol/server-google-maps',
  '@modelcontextprotocol/server-gitlab',
  '@modelcontextprotocol/server-brave-search',
  // The kept `unreviewable` specimen: one stays on chain so the state has a live
  // example rather than only a paragraph describing it.
  '@certscore/mcp',
]);

/** Ours to retire: anything under the fixture scope that is not in the demo set. */
const FIXTURE_SCOPE = '@surex/';

/**
 * Decide what happens to one head, and say why in words that end up in the printed
 * plan. Pure, so the reasoning is testable without a chain.
 *
 * @returns {{action:'keep'|'remove', why:string}}
 */
export function planFor(head) {
  const name = String(head?.name ?? '');
  const state = String(head?.state ?? '');

  if (name && KEEP.includes(name)) {
    return { action: 'keep', why: DEMO_SET.includes(name) ? 'the demo set' : 'on the keep list' };
  }
  if (!name) {
    // Unmatchable against anything, and guessing is how the wrong entity gets deleted.
    return { action: 'keep', why: 'unnamed — never removed on an assumption' };
  }
  if (state === 'unknown') {
    return { action: 'remove', why: 'a seeding placeholder — `unknown` is the absence of an entry' };
  }
  if (name.startsWith(FIXTURE_SCOPE)) {
    return { action: 'remove', why: 'a verdict about our own fixture, which we are the subject of' };
  }
  if (state === 'unreviewable') {
    return { action: 'remove', why: 'no verdict was reached about it — see the note on assertRemovable' };
  }
  return { action: 'keep', why: `a reviewed third-party verdict (${state})` };
}

/**
 * The guard, kept separate from the plan so it cannot be reasoned around: whatever
 * `planFor` decided, a third party's reached verdict — clean, flagged, disputed,
 * stale — is never removable, and this throws if a plan ever asks.
 *
 * A third party's `unreviewable` is removable, and that is the one case worth
 * arguing. `unreviewable` means "we could not read this" — a licence that does not
 * permit review, source that does not match the declared tools, an OCI image with no
 * tarball. No conclusion was reached about the code, so there is no finding to bury;
 * §4 exists so an accusation cannot be made to disappear, and this is the opposite of
 * one.
 */
export function assertRemovable(head) {
  const name = String(head?.name ?? '');
  const state = String(head?.state ?? '');
  const ours = name.startsWith(FIXTURE_SCOPE);
  const reached = !['unknown', 'unreviewable'].includes(state);
  if (!name) throw new Error('refusing to remove an unnamed head');
  if (!ours && reached) {
    throw new Error(
      `refusing to remove ${name}: a ${state} verdict about a third party is superseded, never deleted (AGENTS.md §4)`,
    );
  }
  return true;
}

// Everything above is pure and importable; everything below runs only under the
// entrypoint guard at the bottom. Without it, importing this to test the rules opens
// a chain connection and reads every head.

async function main() {
const arkiv = createArkivWriter({ log: (m) => log(' ', m) });

log(`# registry curation${DRY ? ' (DRY RUN — nothing is written)' : ''}`);
const health = await arkiv.health();
log(`  ${arkiv.rpcUrl} · chain ${health.chainId} · writer ${arkiv.address}`);
if (!health.ok) throw new Error(`connected to chain ${health.chainId}, expected Braga`);

log('\n# reading every verdict head this writer owns');
const { entities: heads, pages, truncated } = await arkiv.readAllScoped({ entityType: 'verdictHead' });
if (truncated) throw new Error('the head query is still truncated — the cursor loop did not finish');
log(`  ${heads.length} heads over ${pages} page(s)`);

/** Attributes come back as a list; the plan needs them as an object. */
const attrs = (e) => Object.fromEntries((e.attributes ?? []).map((a) => [a.key, a.value]));

const rows = heads.map((e) => {
  const a = attrs(e);
  return { entityKey: e.entityKey ?? e.key, name: a.name, state: a.state, severity: a.severity };
});

const planned = rows.map((r) => ({ ...r, ...planFor(r) }));
const removing = planned.filter((p) => p.action === 'remove');
const keeping = planned.filter((p) => p.action === 'keep');

// Re-checked one at a time, so a bug in `planFor` cannot reach the chain.
for (const r of removing) assertRemovable(r);

const byWhy = new Map();
for (const r of removing) byWhy.set(r.why, (byWhy.get(r.why) ?? 0) + 1);

log(`\n# plan — remove ${removing.length}, keep ${keeping.length}`);
for (const [why, n] of byWhy) log(`  remove ${String(n).padStart(3)} · ${why}`);
log('');
for (const k of keeping.filter((k) => k.state !== 'unreviewable')) {
  log(`  keep    ${String(k.name).padEnd(44)} ${k.state}${k.severity ? ` sev ${k.severity}` : ''} · ${k.why}`);
}
const hidden = keeping.filter((k) => k.state === 'unreviewable').length;
if (hidden) log(`  keep    ${hidden} unreviewable — on chain, out of the default view`);

const missing = DEMO_SET.filter((n) => !rows.some((r) => r.name === n));
if (missing.length) {
  log(`\n  ! not on chain yet, publish before the demo: ${missing.join(', ')}`);
}

if (DRY) {
  log('\ndry run — nothing was written.');
  return;
}

log(`\n# removing ${removing.length} heads`);
let done = 0;
const { removed, failures } = await arkiv.remove(
  removing.map((r) => r.entityKey),
  {
    onEach: ({ ok }) => {
      done += 1;
      if (done % 10 === 0 || done === removing.length) log(`  ${done}/${removing.length}`);
      if (!ok) log('  ! one failed, continuing');
    },
  },
);

log(`\n# done — removed ${removed}, ${failures.length} failure(s)`);
for (const f of failures.slice(0, 10)) log(`  ! ${f.entityKey}: ${f.error}`);
log(`\nRe-read the registry to confirm: curl -s $API/v1/stats | jq .registry.byState`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
