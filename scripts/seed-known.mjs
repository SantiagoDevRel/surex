#!/usr/bin/env node
// Seed the MCP servers people actually run.
//
// The first seed crawled 50 real servers out of the official registry and every
// one of them was an unrecognisable name — `@certscore/mcp`, `borealhost-mcp`,
// `fodda-mcp`. Real data that reads as fake, which for a registry is just as bad:
// the owner's first question on seeing it was "are these placeholders?".
//
// The cause is not the crawler. **The official registry does not contain the
// canonical @modelcontextprotocol servers.** Searching it for github, filesystem,
// playwright or postgres returns Smithery mirrors and one-off forks; the packages
// every MCP user has in their config are simply not published there. Verified by
// query, and logged as a friction entry.
//
// So this seeds them from npm instead, and says so: `seedSource` records npm and
// not the registry, because a seeded entry that lies about where it came from is
// worse than one nobody recognises.
//
// It also does something the crawl could not: these fingerprints are the ones a
// real config produces, so the gate stops answering `unknown` for the servers on
// the machine in front of you.
//
//   node scripts/seed-known.mjs --dry-run     # resolve + licence gate, no writes
//   node scripts/seed-known.mjs               # write

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalise, fingerprintOf, tierOf } from '../packages/core/index.mjs';
import {
  createWalrusWriter,
  createArkivWriter,
  buildRegistryEntry,
  buildVerdictHead,
  licenceGate,
  recordBytes,
  sha256Hex,
} from '../packages/worker/index.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = join(ROOT, 'packages', 'worker', 'state', 'seed-known.json');
const DRY = process.argv.includes('--dry-run');
const log = (...a) => console.log(...a);

/**
 * Well-known, npm-published MCP servers. Every one is checked against npm before
 * it is seeded — anything that 404s is skipped and reported, never invented.
 *
 * The `npx -y <pkg>` form is what gets fingerprinted, deliberately: that is what a
 * real config contains, and under SXF-1 a pinned spec is a different entry. Seeding
 * the pinned form would produce entries no user's config can ever match.
 */
const KNOWN = [
  '@modelcontextprotocol/server-github',
  '@modelcontextprotocol/server-filesystem',
  '@modelcontextprotocol/server-postgres',
  '@modelcontextprotocol/server-slack',
  '@modelcontextprotocol/server-memory',
  '@modelcontextprotocol/server-sequential-thinking',
  '@modelcontextprotocol/server-brave-search',
  '@modelcontextprotocol/server-puppeteer',
  '@modelcontextprotocol/server-everything',
  '@modelcontextprotocol/server-gitlab',
  '@modelcontextprotocol/server-google-maps',
  '@modelcontextprotocol/server-sentry',
  '@modelcontextprotocol/server-redis',
  '@modelcontextprotocol/server-sqlite',
  '@playwright/mcp',
  '@upstash/context7-mcp',
  '@supabase/mcp-server-supabase',
  '@notionhq/notion-mcp-server',
  'firecrawl-mcp',
  'mcp-remote',
];

async function npmMeta(name) {
  const res = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}`, {
    // NOT the abbreviated format: `application/vnd.npm.install-v1+json` strips
    // `license`, `description` and `repository` (6 keys instead of 24), so every
    // package would have been recorded with a null licence.
    headers: { accept: 'application/json' },
  });
  if (!res.ok) return { ok: false, status: res.status };
  const j = await res.json();
  const latest = j['dist-tags']?.latest;
  const v = j.versions?.[latest] ?? {};
  return {
    ok: true,
    version: latest ?? null,
    licence: typeof v.license === 'string' ? v.license : (v.license?.type ?? null),
    description: j.description ?? v.description ?? null,
    repo: typeof v.repository === 'string' ? v.repository : (v.repository?.url ?? null),
    integrity: v.dist?.integrity ?? null,
    deprecated: Boolean(v.deprecated),
  };
}

// ── resolve ─────────────────────────────────────────────────────────────────
log(`\nresolving ${KNOWN.length} well-known MCP servers against npm…\n`);
const candidates = [];
const skipped = [];

for (const name of KNOWN) {
  const meta = await npmMeta(name);
  if (!meta.ok) {
    skipped.push({ name, why: `npm ${meta.status}` });
    log(`  ✗ ${name.padEnd(48)} npm ${meta.status} — skipped, not invented`);
    continue;
  }

  const config = { command: 'npx', args: ['-y', name] };
  const canonical = canonicalise(config);
  const fingerprint = fingerprintOf(canonical);
  const tier = tierOf(canonical);

  const gate = await licenceGate(
    {
      name,
      pkg: { registryType: 'npm', identifier: name, version: meta.version },
      repo: meta.repo ? { url: String(meta.repo).replace(/^git\+/, '').replace(/\.git$/, '') } : null,
    },
    { fetchRepoFiles: true },
  );

  candidates.push({
    fingerprint,
    name,
    canonical,
    canonicalConfig: config,
    tier,
    latestVersion: meta.version,
    description: meta.description,
    repo: meta.repo,
    integrity: meta.integrity,
    deprecated: meta.deprecated,
    licence: gate,
    seedSource: `npm:${name} — well-known MCP server, NOT listed in the official MCP registry`,
  });

  log(
    `  ✓ ${name.padEnd(48)} ${String(meta.version).padEnd(10)} ${(gate.spdx ?? gate.detail ?? '?').slice(0, 18).padEnd(19)} ${gate.eligible ? 'eligible' : 'LICENCE-BLOCKED'}  ${fingerprint.slice(0, 14)}…`,
  );
}

const eligible = candidates.filter((c) => c.licence.eligible);
log(`\n${candidates.length} resolved · ${eligible.length} licence-eligible · ${candidates.length - eligible.length} blocked · ${skipped.length} not on npm`);
if (candidates.some((c) => c.deprecated)) {
  log(`note: ${candidates.filter((c) => c.deprecated).length} are marked deprecated on npm — seeded anyway, because a config in the wild still points at them`);
}

if (DRY) {
  log('\n--dry-run: nothing written.\n');
  process.exit(0);
}

// ── write ───────────────────────────────────────────────────────────────────
const saved = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { quilt: null, seeded: {} };
const todo = candidates.filter((c) => !saved.seeded[c.fingerprint]);
log(`\n${todo.length} to write (${Object.keys(saved.seeded).length} already on file)`);
if (!todo.length) {
  log('nothing to do.\n');
  process.exit(0);
}

const walrus = await createWalrusWriter({ log: (m) => log(m) });
const arkiv = createArkivWriter({ log: (m) => log(m) });

// One quilt for all of them: a standalone blob per entry would be two Sui
// transactions each, and the first seed proved that does not fit the wallet.
const records = todo.map((c) => ({
  identifier: c.fingerprint,
  body: {
    schema: 'surex.entry/1',
    fingerprint: c.fingerprint,
    name: c.name,
    canonicalConfig: c.canonicalConfig,
    canonical: c.canonical,
    tier: c.tier,
    latestVersion: c.latestVersion,
    // The package's own words, quoted. Not SureX copy.
    description: c.description,
    repo: c.repo,
    npmIntegrityLatest: c.integrity,
    licence: { spdx: c.licence.spdx ?? null, source: c.licence.source ?? null, eligible: c.licence.eligible },
    seedSource: c.seedSource,
    disclosure:
      'Seeded because this is a server people actually run, resolved from npm. NOBODY HAS REVIEWED THIS ' +
      'CODE. The entry exists so the gate can recognise the configuration, not to say anything about it.',
    capturedAt: new Date().toISOString(),
  },
}));

let quilt = saved.quilt;
let patches;
if (quilt) {
  log(`\nwalrus: reusing certified quilt ${quilt.blobId}`);
  patches = asPatchArray(saved.patches);
} else {
  const written = await walrus.writeQuiltOfRecords(records, { label: 'known-server entries' });
  quilt = written.quilt ?? written;
  // writeQuiltOfRecords returns a MAP, not an array. JSON.stringify turns a Map
  // into `{}`, so the first attempt certified a quilt and then lost every patch
  // pointer to the checkpoint — the ids cannot be re-derived without the write
  // flow, which cost one orphaned quilt. Normalise to an array before anything
  // else touches it.
  patches = asPatchArray(written.patches ?? written.pointers);
  writeFileSync(STATE, JSON.stringify({ quilt, patches, seeded: saved.seeded }, null, 2));
}
log(`  quilt      ${quilt.blobId}`);
log(`  registerTx ${quilt.registerTx}`);
log(`  certifyTx  ${quilt.certifyTx}`);

/**
 * writeQuiltOfRecords returns a Map keyed by identifier. Two traps, both paid for:
 * JSON.stringify turns a Map into `{}` (so a checkpoint loses every pointer), and
 * `[...map.values()]` throws away the KEYS — which are the identifiers, the only
 * thing tying a patch to the record it holds. Preserve them.
 */
function asPatchArray(p) {
  if (!p) return [];
  if (Array.isArray(p)) return p;
  if (typeof p.entries === 'function') {
    return [...p.entries()].map(([identifier, v]) => ({ identifier, ...v }));
  }
  return Object.entries(p).map(([identifier, v]) => ({ identifier, ...v }));
}

const pointerFor = (fp) => {
  const p = (patches ?? []).find((x) => x.identifier === fp || x.id === fp);
  return p ? { ...quilt, ...p, addressing: 'quilt-patch', quiltBlobId: quilt.blobId } : { ...quilt };
};

// Assert the mapping BEFORE building anything: a pointer that does not carry a
// contentSha256, or that belongs to another record, is how a registry ends up
// citing evidence it cannot verify. Fail here rather than write it.
for (const c of todo) {
  const p = (patches ?? []).find((x) => x.identifier === c.fingerprint);
  if (!p) throw new Error(`no quilt patch mapped for ${c.name} (${c.fingerprint})`);
  if (!p.contentSha256) throw new Error(`patch for ${c.name} has no contentSha256`);
}
log(`  mapping verified: ${todo.length}/${todo.length} patches carry an identifier and a digest`);

const entities = [];
for (const c of todo) {
  const blob = pointerFor(c.fingerprint);
  entities.push(buildRegistryEntry({ fingerprint: c.fingerprint, name: c.name, tier: c.tier, blob }));
  entities.push(
    buildVerdictHead({
      fingerprint: c.fingerprint,
      // NEVER clean. Nothing here has been reviewed; a licence-ineligible entry is
      // `unreviewable` with the reason, and everything else is `unknown`.
      state: c.licence.eligible ? 'unknown' : 'unreviewable',
      reason: c.licence.eligible ? undefined : 'licence',
      tier: c.tier,
      severity: 0,
      name: c.name,
      seedSource: c.seedSource,
      evidence: blob,
    }),
  );
}

const { created, txHashes } = await arkiv.createMany(entities, { chunk: 25 });
log(`\narkiv: ${created.length} entities in ${txHashes.length} tx`);
for (const c of todo) saved.seeded[c.fingerprint] = { name: c.name, at: new Date().toISOString() };
writeFileSync(STATE, JSON.stringify({ quilt, patches, seeded: saved.seeded }, null, 2));

log(`\ndone. ${todo.length} well-known servers seeded, all as unknown or unreviewable — never clean.\n`);
