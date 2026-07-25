#!/usr/bin/env node
// Review a family of fixture MCP servers on the DGX and publish each verdict on
// chain — the generalised version of what publish-fixture-review.mjs did for the
// one original fixture.
//
// For every server under packages/fixtures/<name>/ and the original
// packages/fixture-mcp:
//   1. read its whole source tree (the reviewer needs the code)
//   2. start it over stdio and ask it tools/list (the stated intent is what the
//      server ACTUALLY declares, not what we assume)
//   3. run the real double-pass review on the DGX
//   4. write the review body to Walrus, index a ReviewRecord + VerdictHead on Arkiv
//   5. append the outcome to a database written to the owner's Downloads
//
// Only OUR OWN fixtures are ever flagged (AGENTS.md §4). The honest ones should
// come back clean, the malicious ones flagged, and the ambiguous ones wherever
// the model actually lands — which is the point of having them.
//
//   node scripts/review-and-publish.mjs --dry-run     # review, print, write nothing
//   node scripts/review-and-publish.mjs               # review + publish
//   node scripts/review-and-publish.mjs --only mal-   # a name prefix filter

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';

import { canonicalise, fingerprintOf, SEVERITY_LABEL } from '../packages/core/index.mjs';
import { localEntryResolver } from '../packages/plugin/lib/localentry.mjs';
import { reviewServer } from '../packages/reviewer/src/review.mjs';
import {
  createWalrusWriter,
  createArkivWriter,
  buildReviewRecord,
  buildVerdictHead,
  buildRegistryEntry,
  recordBytes,
  sha256Hex,
} from '../packages/worker/index.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const onlyIx = process.argv.indexOf('--only');
const ONLY = onlyIx !== -1 ? process.argv[onlyIx + 1] : null;
const log = (...a) => console.log(...a);

const SOURCE_EXT = /\.(m?js|cjs|ts|json|md)$/i;
const SKIP_DIR = /^(node_modules|fixture-home|test|\.out|\.git)$/i;

// ── discover the servers ─────────────────────────────────────────────────────
/** Where a fixture's stdio entry actually lives — not always <dir>/server.mjs. */
function entryOf(dir) {
  for (const rel of ['server.mjs', 'src/server.mjs', 'index.mjs', 'src/index.mjs']) {
    if (existsSync(join(dir, rel))) return join(dir, rel);
  }
  try {
    const bin = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).bin;
    const first = typeof bin === 'string' ? bin : Object.values(bin ?? {})[0];
    if (first && existsSync(join(dir, first))) return join(dir, first);
  } catch { /* no package.json */ }
  return null;
}

function discover() {
  const out = [];
  const original = join(ROOT, 'packages', 'fixture-mcp');
  out.push({ name: 'fixture-mcp', dir: original, entry: entryOf(original), tier: 'malicious' });
  const famDir = join(ROOT, 'packages', 'fixtures');
  if (existsSync(famDir)) {
    for (const name of readdirSync(famDir)) {
      const dir = join(famDir, name);
      if (!statSync(dir).isDirectory()) continue;
      const entry = entryOf(dir);
      if (!entry) continue;
      const tier = name.startsWith('honest-') ? 'honest'
        : name.startsWith('ambiguous-') ? 'ambiguous'
        : name.startsWith('mal-') ? 'malicious' : 'unknown';
      out.push({ name, dir, entry, tier });
    }
  }
  return out.filter((s) => !ONLY || s.name.includes(ONLY));
}

/** Read a fixture's source tree the way the reviewer wants it: {path, content}[]. */
function readTree(dir) {
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP_DIR.test(e.name)) walk(join(d, e.name));
        continue;
      }
      if (!SOURCE_EXT.test(e.name)) continue;
      const full = join(d, e.name);
      if (statSync(full).size > 200 * 1024) continue;
      // The reviewer keys everything off `file.text` — the capability scan, the
      // injection scan and the prompt all read it. Passing `content` (which the
      // model half also accepts) but not `text` was why `reach` came back
      // "nothing detected" on code with 21 real call sites. Supply `text`.
      const text = readFileSync(full, 'utf8');
      files.push({ path: relative(dir, full).replace(/\\/g, '/'), text });
    }
  };
  walk(dir);
  return files;
}

/** Start the server and ask it what it declares. The intent is its own words. */
function statedIntentFrom(dir, name, entry) {
  return new Promise((resolvePromise) => {
    // cwd at the repo ROOT, not the fixture dir: the server imports
    // @modelcontextprotocol/sdk, which is hoisted into the monorepo's top-level
    // node_modules. Launched from anywhere else, node cannot resolve it and the
    // server dies before printing a single line — which read from the outside as
    // "the server declares no tools".
    const child = spawn('node', [entry], { cwd: ROOT, stdio: ['pipe', 'pipe', 'ignore'] });
    let buf = '';
    let settled = false;
    const done = (intent) => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* already gone */ }
      resolvePromise(intent);
    };
    const readme = ['README.md', 'AGENTS.md'].map((f) => join(dir, f)).find(existsSync);

    // Consume COMPLETE lines only. Splitting the running buffer on every `data`
    // event re-parses partial lines and never advances past them — which is why
    // the first version saw zero tools even though the server answered three.
    child.stdout.on('data', (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('{')) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 2 && msg.result?.tools) {
            done({ name, tools: msg.result.tools, readme: readme ? readFileSync(readme, 'utf8') : null });
          }
        } catch { /* not a complete JSON object on this line */ }
      }
    });
    const send = (o) => child.stdin.write(JSON.stringify(o) + '\n');
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'surex-review', version: '0' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    // If the server never answers, review the code with no declared tools rather
    // than hang — an honest fixture that will not start is a finding of its own.
    setTimeout(() => done({ name, tools: [], readme: readme ? readFileSync(readme, 'utf8') : null }), 8000);
  });
}

// ── review one server ────────────────────────────────────────────────────────
async function reviewOne(server) {
  const files = readTree(server.dir);
  const statedIntent = await statedIntentFrom(server.dir, server.name, server.entry);
  log(`\n${server.name}  [${server.tier}]  ${files.length} files · ${statedIntent.tools.length} tools declared`);

  const result = await reviewServer({ files, statedIntent });
  const top = [...(result.findings ?? [])].sort((a, b) => b.severity - a.severity)[0] ?? null;

  const caps = Object.entries(result.capabilities ?? {})
    .filter(([, v]) => v.present)
    .map(([k]) => k);

  log(`  verdict   ${result.verdict} · severity ${result.severity} · agreementRuns ${result.agreementRuns} · ${result.findings?.length ?? 0} findings`);
  log(`  reach     ${caps.join(' ') || 'nothing detected'}`);
  if (top) log(`  top       [${SEVERITY_LABEL[top.severity]}] ${top.category} ${top.file ?? '?'}:${top.line ?? '?'}`);
  if (result.notice) log(`  notice    ${result.notice}`);

  return { server, files, statedIntent, result, top, caps };
}

// ── main ─────────────────────────────────────────────────────────────────────
// Guarded so importing this file (a test, a debug session) does not run reviews
// and publish to chain. Only direct execution does anything.
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (!isMain) {
  // Exported for reuse without side effects.
} else {
await main();
}

async function main() {
const servers = discover();
log(`reviewing ${servers.length} fixtures on the DGX (${process.env.SUREX_REVIEWER_BASE_URL ?? 'SUREX_REVIEWER_BASE_URL unset!'})\n`);

const reviewed = [];
for (const s of servers) {
  try {
    reviewed.push(await reviewOne(s));
  } catch (err) {
    log(`  ✗ ${s.name}: ${err.message}`);
    reviewed.push({ server: s, error: err.message });
  }
}

// ── the database for Downloads ───────────────────────────────────────────────
const db = reviewed.map((r) => {
  if (r.error) return { name: r.server.name, tier: r.server.tier, error: r.error };
  const { server, statedIntent, result, top, caps } = r;
  return {
    name: server.name,
    tier: server.tier,
    declaredTools: statedIntent.tools.map((t) => ({ name: t.name, description: t.description })),
    verdict: result.verdict,
    severity: result.severity,
    severityLabel: SEVERITY_LABEL[result.severity],
    agreementRuns: result.agreementRuns,
    capabilitySurface: caps,
    findingCount: result.findings?.length ?? 0,
    topFinding: top ? { category: top.category, severity: top.severity, file: top.file, line: top.line, description: top.description } : null,
    statedIntentSummary: result.statedIntentSummary ?? null,
    model: result.modelId,
    promptVersion: result.promptVersion,
  };
});

const downloads = join(homedir(), 'Downloads');
mkdirSync(downloads, { recursive: true });
const dbPath = join(downloads, 'surex-mcp-fixtures.json');
writeFileSync(dbPath, JSON.stringify({ generatedAt: new Date().toISOString(), servers: db }, null, 2));
log(`\ndatabase → ${dbPath}`);

// a readable summary table too
const line = (r) => `${(r.name ?? '?').padEnd(20)} ${(r.tier ?? '?').padEnd(10)} ${(r.verdict ?? r.error ?? '?').padEnd(13)} sev ${r.severity ?? '-'} · ${(r.capabilitySurface ?? []).join(' ')}`;
log('\n' + db.map(line).join('\n'));

if (DRY) {
  log('\n--dry-run: reviewed and wrote the database, nothing published on chain.\n');
  process.exit(0);
}

// ── publish each verdict on chain ────────────────────────────────────────────
log('\npublishing verdicts on chain…');
const walrus = await createWalrusWriter({ log: () => {} });
const arkiv = createArkivWriter({ log: () => {} });

async function existingKey(fingerprint, entityType) {
  const rows = await arkiv.readBackScoped({ entityType, fingerprint, limit: 1 });
  return rows.length ? String(rows[0].key) : null;
}

for (const r of reviewed) {
  if (r.error) continue;
  const { server, statedIntent, result, top } = r;

  const config = { command: 'node', args: [server.entry] };
  const canonical = canonicalise(config, { hashLocalEntry: localEntryResolver(ROOT) });
  const fingerprint = fingerprintOf(canonical);

  const state = result.verdict === 'flagged' ? 'flagged'
    : result.verdict === 'unreviewable' ? 'unreviewable' : 'clean';

  // AGENTS.md §4: publicly flag ONLY our own fixtures. Everything here is ours,
  // but keep the guard explicit so this script cannot be pointed elsewhere.
  if (state === 'flagged' && !/fixture|mal-|ambiguous-|honest-/.test(server.name)) {
    log(`  refusing to flag ${server.name}: not a SureX-authored fixture`);
    continue;
  }

  const body = {
    schema: 'surex.review/1',
    fingerprint,
    subject: `@surex/${server.name} (a ${server.tier} review fixture authored by the SureX project)`,
    verdict: result.verdict,
    severity: result.severity,
    findings: result.findings,
    statedIntentSummary: result.statedIntentSummary,
    capabilities: result.capabilities,
    modelId: result.modelId,
    promptVersion: result.promptVersion,
    agreementRuns: result.agreementRuns,
    analyzedAt: new Date().toISOString(),
    disclosure:
      `Review fixture, tier "${server.tier}", authored by the SureX project. Read statically by an ` +
      `open-source model; no human audited it. Not a statement about anyone else's code.`,
  };
  const bytes = recordBytes(body);
  const contentSha256 = sha256Hex(bytes);

  const pointer = await walrus.writeRecord(bytes, { label: server.name });

  let reviewKey = await existingKey(fingerprint, 'review');
  if (!reviewKey) {
    const { created } = await arkiv.createMany([
      buildReviewRecord({
        fingerprint, sourceKey: `in-repo:${relative(ROOT, server.dir).replace(/\\/g, '/')}`,
        verdict: result.verdict, severity: result.severity, analyzedAt: Date.now(),
        modelId: result.modelId, promptVersion: result.promptVersion,
        blob: { ...pointer, contentSha256 },
      }),
    ]);
    reviewKey = created[0].key;
  }

  const entry = buildRegistryEntry({ fingerprint, name: `@surex/${server.name}`, tier: 'C', blob: { ...pointer, contentSha256 } });
  const head = buildVerdictHead({
    fingerprint, state, tier: 'C', severity: result.severity,
    reason: state === 'unreviewable' ? 'source-unavailable' : undefined,
    enforceAfter: state === 'flagged' ? Date.now() + 72 * 3600 * 1000 : undefined,
    name: `@surex/${server.name}`,
    latestReviewKey: reviewKey, sourceKey: `in-repo:${server.name}`,
    modelId: result.modelId, promptVersion: result.promptVersion,
    reviewedAt: new Date().toISOString(),
    capabilities: result.capabilities, topFinding: top ?? undefined,
    evidence: { ...pointer, contentSha256 },
    requireReviewForClean: true,
  });

  const pending = [];
  if (!(await existingKey(fingerprint, 'registryEntry'))) pending.push(entry);
  if (!(await existingKey(fingerprint, 'verdictHead'))) pending.push(head);
  if (pending.length) await arkiv.createMany(pending);

  log(`  ✓ ${server.name.padEnd(20)} ${state.padEnd(13)} blob ${pointer.blobId.slice(0, 12)}… fp ${fingerprint.slice(0, 14)}…`);
}

log(`\ndone. Database at ${dbPath}\n`);
}
