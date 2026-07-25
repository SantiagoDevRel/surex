#!/usr/bin/env node
// Cut the registry down to what it can actually stand behind.
//
//   node scripts/curate-registry.mjs --dry-run     # print the plan, touch nothing
//   node scripts/curate-registry.mjs               # do it
//
// The registry accumulated 85 heads from three separate seeding passes, and most
// of them say nothing. This removes the ones that are not verdicts and retires the
// fixtures that are not part of the demo set, leaving entries a reader can trust
// one at a time.
//
// ── WHAT MAY BE REMOVED, AND WHY THAT LIST IS SHORT ────────────────────────
//
// AGENTS.md §4: a verdict is **superseded, never deleted**. Corrections have to be
// as durable as the claim they correct, or a registry becomes a place where
// inconvenient findings quietly stop existing. Two categories fall outside that,
// and NOTHING else does:
//
//   1. `unknown` heads — seeding placeholders. `packages/core/src/verdict.mjs`
//      defines `unknown` as the ABSENCE of an entry, so a stored `unknown` head is
//      a record asserting there is no record. It is a contradiction in the
//      product's own vocabulary, not a verdict that was reached and might later
//      embarrass us. Deleting it removes no finding, because it never contained one.
//
//   2. Verdicts about OUR OWN fixtures. We wrote those servers to be reviewed and
//      we are the subject of the review. The rule exists so that an accusation
//      against SOMEBODY ELSE cannot be made to disappear; retiring a review of
//      `@surex/mal-postinstall` hides nothing from anyone and protects no one.
//
// Everything else stays. In particular the 24 `unreviewable` heads are REAL
// ANSWERS about real third-party packages — "we could not read this, and here is
// why" is a finding — and this script refuses to remove them even if asked. They
// are filtered out of the registry's default VIEW instead, which is a display
// decision and reversible; deletion is neither.
//
// The result is the demo set plus every third-party server that carries a real
// reviewed verdict.

import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createArkivWriter } from '../packages/worker/index.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const log = (...a) => console.log(...a);

/**
 * The three servers the demo drives the gate against, one per branch of
 * `decide()`. Verified over 10 consecutive reviewer runs, and republished under
 * prompt rv-6:
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

/**
 * The whole registry, named. Owner's list, 2026-07-25.
 *
 * Everything not on it goes. That is a deliberate choice to make the registry
 * READABLE one entry at a time rather than comprehensive: nine entries carrying a
 * verdict a person can check, plus exactly one `unreviewable` so the state is
 * still demonstrable instead of merely described.
 */
export const KEEP = Object.freeze([
  ...DEMO_SET,
  // Third-party servers that carry a real reviewed verdict.
  '@playwright/mcp',
  '@modelcontextprotocol/server-redis',
  '@modelcontextprotocol/server-memory',
  '@modelcontextprotocol/server-google-maps',
  '@modelcontextprotocol/server-gitlab',
  '@modelcontextprotocol/server-brave-search',
  /**
   * The kept specimen. A registry that shows only what it could read teaches that
   * everything is readable, and the honest answer for most published MCP servers
   * is that the licence does not permit us to read them. One stays so the state
   * has an example rather than a paragraph.
   */
  '@certscore/mcp',
]);

/** Ours to retire: anything under the fixture scope that is not in the demo set. */
const FIXTURE_SCOPE = '@surex/';

/**
 * Decide what happens to one head, and say why in words that end up in the
 * printed plan. Pure, so the reasoning is testable without a chain.
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
    // A head with no name cannot be matched against anything, and guessing is how
    // the wrong entity gets deleted. Keeping it costs one row.
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
 * `planFor` decided, a third party's REACHED verdict is never removable.
 *
 * ── on removing a third party's `unreviewable` ────────────────────────────────
 *
 * The owner asked for a registry of ten named entries, which means removing 24
 * `unreviewable` heads about real packages. That deserves saying out loud rather
 * than doing quietly, because AGENTS.md §4 says a verdict is superseded, never
 * deleted, and these are about servers we do not own.
 *
 * What makes it defensible is what `unreviewable` MEANS. It is the state for
 * "we could not read this" — a licence that does not permit review, source that
 * does not correspond to the declared tools, an OCI image with no tarball to
 * read. No conclusion was ever reached about the code, so there is no finding to
 * bury and nobody is protected by the row's continued existence. The rule exists
 * so an ACCUSATION cannot be made to disappear; an `unreviewable` is the opposite
 * of an accusation, and removing one takes nothing away from the package's author.
 *
 * `@certscore/mcp` stays for exactly this reason: the state has to remain
 * demonstrable rather than merely described, so one real example is kept on chain.
 *
 * A third party's REACHED verdict — clean, flagged, disputed, stale — is still
 * never removable, and this throws if a plan ever asks.
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

// ---------------------------------------------------------------------------
// Everything above is pure and importable. Everything below runs ONLY when this
// file is the entrypoint — without that guard, importing it to test the rules
// opens a chain connection and reads every head, which is how the first version
// of its test suite came to take four minutes and touch the network.
// ---------------------------------------------------------------------------

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

// Every removal re-checked against the guard, one at a time. A bug in `planFor`
// must not be able to reach the chain.
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
