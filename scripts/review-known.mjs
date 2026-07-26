#!/usr/bin/env node
// Review the servers that are already in the registry as `unknown`, and replace
// that non-answer with a real one.
//
// `seed-known.mjs` writes every entry `unknown` because it resolves a package's
// licence and never runs the reviewer. This points the same reviewer that reads the
// fixtures at those servers and publishes what it finds.
//
// What it reviews: the published npm tarball, not the GitHub repo. A seeded
// fingerprint is of `npx -y <pkg>`, and what that command executes is the tarball;
// reviewing the repo would produce a verdict about bytes the user never runs. The
// version and its `dist.integrity` are recorded with the verdict, and the tier stays
// **C**: `npx -y` floats, so tomorrow's install may resolve to a different version.
//
// It executes third-party code. Getting a server's stated intent means starting it
// and calling `tools/list`. Mitigations, all real but none of them a sandbox:
// `npm install --ignore-scripts`, a scrubbed environment with no tokens and a
// throwaway HOME, a timeout, and everything under a temp directory outside the repo.
// `--no-exec` turns it off and falls back to the README alone.
//
//   node scripts/review-known.mjs --dry-run              # review everything, write nothing
//   node scripts/review-known.mjs --dry-run --limit 5    # the first 5
//   node scripts/review-known.mjs --dry-run --only playwright
//   node scripts/review-known.mjs --publish              # write to chain (needs the wallet)
//
// Publishing rules, and they are not negotiable:
//   · `clean` is only ever written with a real review attached to it.
//   · `unreviewable` carries the reason it could not be read.
//   · a **flag against a named third party is never published by this script**.
//     It is written to the report, and a human decides. AGENTS.md §4 forbids the
//     automatic version, and a permanent Walrus blob accusing a real project on
//     an unaudited model verdict is not something to find out was wrong later.

import { writeFileSync, mkdirSync, existsSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { SEVERITY_LABEL } from '../packages/core/index.mjs';
import { reviewServer } from '../packages/reviewer/src/review.mjs';
import { resolveConfig } from '../packages/reviewer/src/model.mjs';
import { licenceGate } from '../packages/worker/index.mjs';
import { statedIntentFrom } from './lib/server-source.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const PUBLISH = argv.includes('--publish');
const EXEC = !argv.includes('--no-exec');
/**
 * Everything except the model: resolve, licence-gate, fetch, extract, install, start,
 * ask `tools/list`, budget the files — then stop and report. The fragile half of this
 * pipeline is not the review, and finding out which tarball or install breaks should
 * cost seconds rather than an hour of GPU.
 */
const NO_REVIEW = argv.includes('--no-review');
/**
 * Publish the verdicts already measured, without reviewing again. A full pass is
 * ~40 minutes of GPU; the report on disk is the record of what was measured, so a
 * publish that aborts on its last step need not re-derive it.
 */
const FROM_REPORT = argv.includes('--from-report');
const ONLY = flag('--only');
const LIMIT = Number(flag('--limit', '0')) || 0;
const API = flag('--api', 'https://arkiv-surex-api.vercel.app');
const WORK = flag('--work', join(tmpdir(), 'surex-review-known'));
const log = (...a) => console.log(...a);

/**
 * The prompt budget, sized for the review model's context and not for the fixtures.
 * `qwen3-coder-next:surex32k` is 32 768 tokens with 8 192 reserved for the reply, and
 * **ollama silently drops tokens rather than refusing** — over the line the result is
 * a confident verdict about a file the model never received. 40 000 characters is
 * ~12–16k tokens, leaving room for the instructions and the answer.
 */
export const REVIEW_LIMITS = Object.freeze({
  // Per-file, deliberately close to the total: a published MCP server is usually one
  // compiled file, and a cap tuned for "many small files" truncates it mid-way — at
  // 12 000 the model saw 63% of server-memory's dist/index.js and flagged the path
  // construction, the only code it had.
  maxCharsPerFile: 32_000,
  maxTotalChars: 40_000,
  maxFiles: 24,
  // A real README is longer than a fixture's (server-memory's is 10 667 characters,
  // and it documents the behaviour the reviewer was flagging as undeclared). When a
  // server will not start, this text is the entire case for the defence.
  maxReadmeChars: 12_000,
});

/**
 * Driven off `/v1/registry?state=unknown` rather than a hardcoded array so the two
 * cannot drift: whatever is unknown on chain today is what gets reviewed.
 */
async function loadUnknown() {
  const res = await fetch(`${API}/v1/registry?state=unknown&limit=200`);
  if (!res.ok) throw new Error(`registry read failed: HTTP ${res.status}`);
  const body = await res.json();
  return (body.heads ?? []).map((h) => ({
    fingerprint: h.fingerprint,
    name: h.name,
    tier: h.tier ?? 'C',
    arkivEntityKey: h.arkivEntityKey ?? null,
  }));
}

/**
 * The npm package name, or `null` for an OCI image reference. Pulling an image is a
 * different pipeline, and guessing at a matching npm name would attach a verdict to
 * the wrong artifact — those stay `unknown`, with the reason in the report.
 */
function npmNameOf(name) {
  if (/^(docker\.io|ghcr\.io|quay\.io|registry\.k8s\.io)\//i.test(name)) return null;
  // `pkg@1.2.3` → `pkg`, without eating the leading @ of a scope.
  const at = name.lastIndexOf('@');
  return at > 0 ? name.slice(0, at) : name;
}

async function npmMeta(name) {
  const res = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}`, {
    // Not the abbreviated `application/vnd.npm.install-v1+json` format: it strips
    // `license`, `description` and `repository`, so every licence reads null.
    headers: { accept: 'application/json' },
  });
  if (!res.ok) return { ok: false, status: res.status };
  const j = await res.json();
  const version = j['dist-tags']?.latest;
  const v = j.versions?.[version] ?? {};
  return {
    ok: true,
    version: version ?? null,
    tarball: v.dist?.tarball ?? null,
    integrity: v.dist?.integrity ?? null,
    licence: typeof v.license === 'string' ? v.license : (v.license?.type ?? null),
    description: j.description ?? v.description ?? null,
    repo: typeof v.repository === 'string' ? v.repository : (v.repository?.url ?? null),
    deprecated: Boolean(v.deprecated),
  };
}

const safeDir = (name) => name.replace(/[^a-z0-9._-]+/gi, '_');

/**
 * Does what npm published match what was downloaded? `dist.integrity` is a
 * Subresource Integrity string over the tarball (`sha512-<base64>`), and recomputing
 * it is the difference between reviewing the package and reviewing whatever the
 * network returned. A mismatch is fatal, not a warning.
 */
export function integrityMatches(bytes, integrity) {
  if (!integrity) return { checked: false, ok: false, detail: 'npm published no integrity hash for this version' };
  const [algorithm, expected] = String(integrity).split('-');
  if (!algorithm || !expected) return { checked: false, ok: false, detail: `unrecognised integrity string ${integrity}` };
  let actual;
  try {
    actual = createHash(algorithm).update(bytes).digest('base64');
  } catch {
    return { checked: false, ok: false, detail: `unsupported integrity algorithm ${algorithm}` };
  }
  return actual === expected
    ? { checked: true, ok: true, detail: `${algorithm} matches npm` }
    : { checked: true, ok: false, detail: `${algorithm} MISMATCH — downloaded bytes are not the published tarball` };
}

/** Download and extract the published tarball. Returns the package directory. */
async function fetchTarball(name, tarballUrl, integrity) {
  const dir = join(WORK, safeDir(name));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const tgz = join(dir, 'package.tgz');

  const res = await fetch(tarballUrl);
  if (!res.ok) throw new Error(`tarball HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const integrityCheck = integrityMatches(bytes, integrity);
  if (integrityCheck.checked && !integrityCheck.ok) {
    throw new Error(integrityCheck.detail);
  }
  writeFileSync(tgz, bytes);

  // Extracted from `dir` with a relative filename, never an absolute one. GNU tar
  // reads an argument containing a colon as `host:path`, so `tar -xzf C:\…\pkg.tgz`
  // fails with "Cannot connect to C: resolve failed" on every package; Windows'
  // bsdtar accepts it. A relative path has no colon and works under both.
  execFileSync('tar', ['-xzf', 'package.tgz'], { cwd: dir, stdio: 'ignore', timeout: 120_000 });
  // npm tarballs always root at `package/`, but a few republished ones do not.
  const inner = join(dir, 'package');
  return { dir: existsSync(inner) ? inner : dir, integrityCheck };
}

const SOURCE_EXT = /\.(m?js|cjs|ts|mts|cts|json)$/i;
const SKIP_DIR = /^(node_modules|\.git|test|tests|__tests__|examples?|docs?|coverage|\.github)$/i;
/**
 * Lockfiles are never source, and one of them is generated here: `npm install` writes
 * `package-lock.json` into the extracted directory, so a tree read after the install
 * spends its budget on dependency metadata this script produced. The tree is read
 * before the install as well — this is the second line of defence.
 */
const SKIP_FILE = /^(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|tsconfig\.tsbuildinfo)$/i;

/** Every reviewable file in the extracted package. Not budgeted — that is later. */
export function readPackage(dir) {
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP_DIR.test(e.name)) walk(join(d, e.name));
        continue;
      }
      if (!SOURCE_EXT.test(e.name) || SKIP_FILE.test(e.name)) continue;
      const full = join(d, e.name);
      if (statSync(full).size > 1024 * 1024) continue; // a 1 MB single file is a bundle
      files.push({ path: relative(dir, full).replace(/\\/g, '/'), text: readFileSync(full, 'utf8') });
    }
  };
  walk(dir);
  return files;
}

/**
 * A published bundle is not source: `dist/index.js` on one 400 000-character line is
 * technically available, and a model reading mangled identifiers with no structure
 * returns `clean` for a server it did not understand — the single most dangerous
 * output this system can produce. Detected and reported as `unreviewable` with the
 * reason. Pure and tested, because it decides whether a verdict is published at all.
 */
export function readability(files) {
  // `.d.ts` is excluded: a minified `dist/index.js` shipped next to a hand-shaped
  // `dist/index.d.ts` would otherwise pass this gate on the declarations alone, and a
  // review of types finds nothing to find and says `clean`.
  const code = (files ?? []).filter((f) =>
    /\.(m?js|cjs|ts|mts|cts)$/i.test(f.path) && !/\.d\.(m?ts|cts)$/i.test(f.path));
  if (!code.length) return { readable: false, reason: 'no JavaScript or TypeScript source in the published package (type declarations do not count)' };

  const judged = code.map((f) => {
    const lines = f.text.split('\n');
    const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
    const avg = f.text.length / Math.max(1, lines.length);
    // Two independent tells, either is enough: one enormous line (a bundler's
    // output), or a large file whose average line is far past what a human writes.
    const minified = longest > 5_000 || (f.text.length > 50_000 && avg > 300);
    return { path: f.path, minified, longest, avg: Math.round(avg), chars: f.text.length };
  });

  const readable = judged.filter((j) => !j.minified);
  const readableChars = readable.reduce((n, j) => n + j.chars, 0);

  // Vendored minified files next to real source are normal; the gate only refuses
  // when there is nothing left worth reading.
  if (!readable.length) {
    return { readable: false, reason: 'every published JavaScript file is a bundled or minified artifact', judged };
  }
  if (readableChars < 500) {
    return { readable: false, reason: 'the published package contains almost no readable source', judged };
  }
  return { readable: true, judged, readableChars };
}

/**
 * Which files the model gets, in priority order, inside the budget.
 *
 * `package.json` is always first and is never dropped: the manifest is where a
 * supply-chain attack lives, and a budget that can drop it cannot see that attack
 * class at all.
 */
export function selectForReview(files, limits = REVIEW_LIMITS) {
  const manifest = files.filter((f) => f.path === 'package.json');
  const rest = files.filter((f) => f.path !== 'package.json');
  const hasSource = rest.some((f) => /^(src|lib)\//i.test(f.path));

  const rank = (f) => {
    // Type declarations rank last whatever directory they live in. `@monnet/mcp` sent
    // the model 23 `.d.ts` files out of 24 and drew a severity-3 flag out of a
    // function signature. They stay eligible as context, but never displace code.
    if (/\.d\.(m?ts|cts)$/i.test(f.path)) return 9;
    if (/^(src|lib)\//i.test(f.path)) return 0;
    if (/^(index|server|main|cli)\.(m?js|cjs|ts)$/i.test(f.path)) return 1;
    // A dist/ bundle is the last thing worth spending budget on when real source
    // shipped alongside it.
    if (/^(dist|build|out)\//i.test(f.path)) return hasSource ? 4 : 2;
    return 3;
  };
  const ordered = [...rest].sort((a, b) => rank(a) - rank(b) || a.text.length - b.text.length);

  const kept = [...manifest];
  const dropped = [];
  let total = manifest.reduce((n, f) => n + Math.min(f.text.length, limits.maxCharsPerFile), 0);
  for (const f of ordered) {
    const size = Math.min(f.text.length, limits.maxCharsPerFile);
    if (kept.length >= limits.maxFiles || total + size > limits.maxTotalChars) {
      dropped.push(f.path);
      continue;
    }
    kept.push(f);
    total += size;
  }
  return { kept, dropped, chars: total };
}

/**
 * An environment with nothing in it worth stealing. The servers being started read
 * credentials from the environment by design, so the review passes none of the real
 * ones on; HOME points at a throwaway directory so a server that writes config does
 * it there.
 */
function scrubbedEnv(sandboxHome) {
  mkdirSync(sandboxHome, { recursive: true });
  const keep = ['PATH', 'SystemRoot', 'windir', 'COMSPEC', 'TEMP', 'TMP', 'PATHEXT', 'NUMBER_OF_PROCESSORS', 'OS'];
  const env = {};
  for (const k of keep) if (process.env[k]) env[k] = process.env[k];
  env.HOME = sandboxHome;
  env.USERPROFILE = sandboxHome;
  env.npm_config_yes = 'true';
  env.NO_COLOR = '1';
  return env;
}

function entryOfPackage(dir) {
  let pkg = {};
  try { pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')); } catch { /* none */ }
  const candidates = [];
  const bin = pkg.bin;
  if (typeof bin === 'string') candidates.push(bin);
  else for (const v of Object.values(bin ?? {})) candidates.push(v);
  if (pkg.main) candidates.push(pkg.main);
  candidates.push('index.js', 'dist/index.js', 'build/index.js', 'src/index.js');
  for (const rel of candidates) {
    const full = join(dir, String(rel).replace(/^\.\//, ''));
    if (existsSync(full) && statSync(full).isFile()) return full;
  }
  return null;
}

async function statedIntentOf(pkgDir, name) {
  const readmeOnly = () => {
    const readme = ['README.md', 'readme.md', 'README.markdown'].map((f) => join(pkgDir, f)).find(existsSync);
    return {
      name,
      tools: [],
      readme: readme ? readFileSync(readme, 'utf8').slice(0, REVIEW_LIMITS.maxReadmeChars) : null,
      toolSource: 'readme-only',
    };
  };
  if (!EXEC) return readmeOnly();

  const entry = entryOfPackage(pkgDir);
  if (!entry) return readmeOnly();

  try {
    // --ignore-scripts is the important flag: it is what stops a hostile
    // postinstall from running on this machine while the review looks for one.
    execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=dev', '--silent'], {
      cwd: pkgDir, stdio: 'ignore', timeout: 180_000, shell: process.platform === 'win32',
      env: { ...scrubbedEnv(join(pkgDir, '..', 'home')), npm_config_ignore_scripts: 'true' },
    });
  } catch { /* review it without deps; the spawn below will simply fail */ }

  const intent = await statedIntentFrom({
    dir: pkgDir, name, entry, cwd: pkgDir,
    env: scrubbedEnv(join(pkgDir, '..', 'home')),
    // Longer than the fixtures' 8 s: a real server may build a browser driver or an
    // index before serving `tools/list` (`@playwright/mcp` and `server-everything`
    // both timed out at 8 s). Not enumerating is survivable — the README carries the
    // claims and `toolSource` records it — but it costs a review's sharpest axis.
    timeoutMs: 20_000,
  });
  if (!intent.readme) {
    const readme = ['README.md', 'readme.md'].map((f) => join(pkgDir, f)).find(existsSync);
    if (readme) intent.readme = readFileSync(readme, 'utf8').slice(0, REVIEW_LIMITS.maxReadmeChars);
  }
  return intent;
}

async function reviewOne(entry, config) {
  const out = { ...entry, npmName: npmNameOf(entry.name) };

  if (!out.npmName) {
    return { ...out, outcome: 'skipped', publish: null, why: 'not an npm package (OCI image reference) — a different pipeline is needed to read it' };
  }

  const meta = await npmMeta(out.npmName);
  if (!meta.ok) {
    return { ...out, outcome: 'skipped', publish: null, why: `npm ${meta.status} — the package is not resolvable, nothing invented` };
  }
  Object.assign(out, { version: meta.version, integrity: meta.integrity, repo: meta.repo, deprecated: meta.deprecated, description: meta.description });

  const gate = await licenceGate(
    { name: out.npmName, pkg: { registryType: 'npm', identifier: out.npmName, version: meta.version },
      repo: meta.repo ? { url: String(meta.repo).replace(/^git\+/, '').replace(/\.git$/, '') } : null },
    { fetchRepoFiles: true },
  );
  out.licence = { spdx: gate.spdx, eligible: gate.eligible, source: gate.source, undetermined: Boolean(gate.undetermined) };
  if (gate.undetermined) {
    // The licence could not be read — a timeout or rate limit, not an answer.
    // Publishing `unreviewable / licence` on a failed HTTP request would say nobody
    // may store somebody's correctly licensed source. Leave the entry alone.
    return { ...out, outcome: 'skipped', publish: null, why: gate.detail };
  }
  if (!gate.eligible) {
    // No source upload for a licence that does not permit redistribution — the gate
    // runs before anything is read, not after.
    return { ...out, outcome: 'unreviewable', reason: 'licence', publish: 'unreviewable',
      why: `licence not redistribution-permitting (${gate.spdx ?? gate.detail ?? 'no licence signal'})` };
  }

  if (!meta.tarball) {
    return { ...out, outcome: 'unreviewable', reason: 'source-unavailable', publish: 'unreviewable', why: 'npm lists no tarball for the latest version' };
  }

  let pkgDir;
  try {
    const fetched = await fetchTarball(out.npmName, meta.tarball, meta.integrity);
    pkgDir = fetched.dir;
    out.integrityCheck = fetched.integrityCheck;
  } catch (err) {
    return { ...out, outcome: 'unreviewable', reason: 'source-unavailable', publish: 'unreviewable', why: `could not fetch or extract the tarball: ${err.message}` };
  }

  const files = readPackage(pkgDir);
  const read = readability(files);
  out.filesInPackage = files.length;
  out.readability = { readable: read.readable, reason: read.reason ?? null };
  if (!read.readable) {
    return { ...out, outcome: 'unreviewable', reason: 'source-unavailable', publish: 'unreviewable', why: read.reason };
  }

  const statedIntent = await statedIntentOf(pkgDir, out.npmName);
  out.toolSource = statedIntent.toolSource;
  out.declaredTools = (statedIntent.tools ?? []).map((t) => ({ name: t.name, description: t.description }));

  const selection = selectForReview(files);
  out.reviewedFiles = selection.kept.map((f) => f.path);
  out.notReviewedFiles = selection.dropped;
  out.promptChars = selection.chars;

  if (NO_REVIEW) {
    return { ...out, outcome: 'ready', publish: null,
      why: `${selection.kept.length} file(s) / ${selection.chars} chars would go to the model; ${selection.dropped.length} would not` };
  }

  const result = await reviewServer(
    { files: selection.kept, statedIntent },
    { config, limits: REVIEW_LIMITS, allowCache: false, writeCache: false },
  );

  const top = [...(result.findings ?? [])].sort((a, b) => b.severity - a.severity)[0] ?? null;
  Object.assign(out, {
    verdict: result.verdict,
    severity: result.severity,
    severityLabel: SEVERITY_LABEL[result.severity],
    agreementRuns: result.agreementRuns,
    findingCount: (result.findings ?? []).length,
    findings: result.findings ?? [],
    topFinding: top,
    capabilitySurface: Object.entries(result.capabilities ?? {}).filter(([, v]) => v.present).map(([k]) => k),
    statedIntentSummary: result.statedIntentSummary ?? null,
    modelId: result.modelId,
    promptVersion: result.promptVersion,
    sourceCoverage: result.run?.sourceCoverage ?? null,
    // Per-reading status. Without it "1 usable run of 2" cannot say whether the other
    // reading timed out, returned prose, or was rejected as contradictory — three
    // different problems with three different fixes.
    readings: (result.run?.runs ?? []).map((x) => ({
      variant: x.variant, ok: x.ok, parsed: x.parsed, error: x.error, ms: x.ms,
    })),
    reviewErrors: result.reviewErrors ?? null,
    notice: result.notice ?? null,
    _result: result,
  });

  /**
   * A `clean` verdict claims the reviewer read the code and found nothing, which is
   * only true if it read all of it. The prompt is budgeted and the tail of a large
   * package is dropped, so any omission downgrades `clean` to `unreviewable` with the
   * omission listed. This only ever weakens the answer — a flag is unaffected,
   * because finding something in the part that was read is still finding something.
   */
  const omitted = (result.run?.sourceCoverage?.filesOmittedOrTruncated ?? 0) + (selection.dropped?.length ?? 0);
  if (result.verdict === 'clean' && omitted > 0) {
    return { ...out, outcome: 'unreviewable', reason: 'partial-source', publish: 'unreviewable',
      why: `the review found nothing, but ${omitted} file(s) were omitted or truncated — a clean verdict about code the model did not read is not a cautious answer, it is a false one` };
  }

  if (result.verdict === 'clean') return { ...out, outcome: 'clean', publish: 'clean' };
  if (result.verdict === 'flagged') {
    /**
     * Held, and said so on chain. Leaving these `unknown` reads as "nobody has
     * looked", which is publication bias — every clean review shown and every other
     * one silently omitted, with `unknown` quietly meaning two things. `withheld` is
     * the factual category: a review ran, its findings are not published, a human
     * decides. No accusation, no findings, no severity.
     */
    return { ...out, outcome: 'flagged', publish: 'withheld',
      why: 'a flag against a named third party is held for a human to release — the registry records that a review ran and its result is withheld, which is not the same as nobody having looked' };
  }
  return { ...out, outcome: result.verdict, reason: result.reason ?? 'source-unavailable', publish: 'unreviewable', why: result.notice ?? null };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) await main();

async function main() {
  const config = resolveConfig();
  if (!config.baseUrl && !NO_REVIEW) {
    console.error('SUREX_REVIEWER_BASE_URL is unset — there is nothing to review against.');
    process.exit(2);
  }
  if (NO_REVIEW && PUBLISH) {
    console.error('--no-review cannot publish: there would be no review to publish.');
    process.exit(2);
  }

  if (FROM_REPORT) {
    const path = join(homedir(), 'Downloads', 'surex-known-review.json');
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    log(`
publishing from ${path} (generated ${saved.generatedAt}) — no review re-run
`);
    return publish(saved.servers ?? []);
  }

  let entries = await loadUnknown();
  if (ONLY) entries = entries.filter((e) => e.name.includes(ONLY));
  if (LIMIT) entries = entries.slice(0, LIMIT);

  log(`\n${entries.length} unknown entries · model ${config.modelId} · exec ${EXEC ? 'ON' : 'off'} · work ${WORK}`);
  log(PUBLISH ? 'MODE: publish\n' : 'MODE: dry run — nothing will be written on chain\n');
  mkdirSync(WORK, { recursive: true });

  const results = [];
  for (const [i, entry] of entries.entries()) {
    const t0 = Date.now();
    let row;
    try {
      row = await reviewOne(entry, config);
    } catch (err) {
      row = { ...entry, outcome: 'error', publish: null, why: err.message };
    }
    row.ms = Date.now() - t0;
    results.push(row);
    const detail = row.verdict
      ? `sev ${row.severity} · ${row.findingCount} findings · ${(row.capabilitySurface ?? []).join(' ') || 'no reach detected'}`
      : (row.why ?? '');
    log(`  ${String(i + 1).padStart(2)}/${entries.length} ${String(row.name).slice(0, 42).padEnd(44)} ${String(row.outcome).padEnd(13)} ${detail}`);
  }

  const tally = results.reduce((acc, r) => ({ ...acc, [r.outcome]: (acc[r.outcome] ?? 0) + 1 }), {});
  log('\n' + '─'.repeat(72));
  log(Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(' · '));

  // How many servers actually stated what they declare. "The code does more than the
  // tools say" needs the tools, so a low number here is a caveat on the whole run.
  const started = results.filter((r) => r.toolSource);
  const enumerated = started.filter((r) => r.toolSource === 'tools/list');
  if (started.length) {
    const why = started.filter((r) => r.toolSource !== 'tools/list')
      .reduce((acc, r) => ({ ...acc, [r.toolSource]: (acc[r.toolSource] ?? 0) + 1 }), {});
    log(`declared tools enumerated for ${enumerated.length}/${started.length} servers` +
      (Object.keys(why).length ? ` · not enumerated: ${Object.entries(why).map(([k, v]) => `${k} ×${v}`).join(', ')}` : '') +
      '\n(the rest were reviewed against their README alone, and each verdict records which)');
  }
  const held = results.filter((r) => r.outcome === 'flagged');
  if (held.length) {
    log(`\n${held.length} FLAG(S) HELD for a human decision — none of these is published by this script:`);
    for (const r of held) {
      log(`  · ${r.name} @${r.version}  sev ${r.severity} ${r.severityLabel}`);
      if (r.topFinding) log(`      ${r.topFinding.file ?? '?'}:${r.topFinding.line ?? '?'} — ${String(r.topFinding.description ?? '').slice(0, 160)}`);
    }
  }
  log('─'.repeat(72));

  const downloads = join(homedir(), 'Downloads');
  mkdirSync(downloads, { recursive: true });
  const path = join(downloads, 'surex-known-review.json');
  writeFileSync(path, JSON.stringify({
    generatedAt: new Date().toISOString(),
    model: config.modelId,
    promptLimits: REVIEW_LIMITS,
    execUsed: EXEC,
    tally,
    servers: results.map(({ _result, ...rest }) => rest),
  }, null, 2));
  log(`\nreport → ${path}`);

  if (!PUBLISH) {
    log('\ndry run: nothing written on chain. Read the report, then re-run with --publish.\n');
    return;
  }
  await publish(results);
}

/**
 * The last gate before the wallet: nothing on the publish path may carry a flag
 * against a package this project did not write (AGENTS.md §4). Separate, exported and
 * tested rather than an `if` inside publish(), so deleting the check fails the suite
 * instead of quietly turning this into a machine that accuses real projects on an
 * unaudited model verdict.
 */
export function assertNoThirdPartyFlags(rows) {
  for (const r of rows ?? []) {
    // What is being written, never what the model said: `withheld` exists to publish
    // something safe about a flagged review, so every withheld row carries
    // `verdict: 'flagged'` by definition and refusing on that aborts the publish on
    // exactly the rows this guard is designed to permit.
    if (r.publish === 'flagged' || r.state === 'flagged') {
      throw new Error(
        `refusing to publish a flag for the third-party package ${r.name} — ` +
        'a human releases those (AGENTS.md §4)',
      );
    }
    // The other direction, and the more dangerous one: a flag must never be
    // laundered into silence. If the model flagged it, `clean` is not available.
    if (r.verdict === 'flagged' && r.publish === 'clean') {
      throw new Error(
        `refusing to publish ${r.name} as clean: the review flagged it. A held flag ` +
        'publishes as `withheld`, never as nothing found.',
      );
    }
  }
  return rows;
}

async function publish(results) {
  const { createWalrusWriter, createArkivWriter, buildReviewRecord, buildVerdictHead, recordBytes, sha256Hex } =
    await import('../packages/worker/index.mjs');

  const publishable = results.filter((r) => ['clean', 'unreviewable', 'withheld'].includes(r.publish));
  if (!publishable.length) {
    log('nothing to publish.\n');
    return;
  }

  assertNoThirdPartyFlags(publishable);

  /**
   * Build every head before anything is written, with a stand-in evidence pointer,
   * purely to see whether the worker would refuse it. The write order below is quilt
   * (two paid Sui transactions) → review records → heads, so a head the worker
   * rejects — an `unreviewable` with no reason, a `clean` with no review — would
   * otherwise throw after the blob was paid for, leaving a certified quilt nothing
   * points at and half the registry updated.
   *
   * The probe pointer is shaped exactly like a real one: `evidenceOf` requires
   * `nShards` and `encodingType`, since blob IDs are deterministic over both content
   * and network configuration, and a probe that skips them tests nothing.
   */
  const PROBE = {
    blobId: 'probe', suiObjectId: 'probe', contentSha256: 'probe',
    registerTx: 'probe', certifyTx: 'probe', encodingType: 'RS2', nShards: 1000,
  };
  for (const r of publishable) {
    try {
      buildVerdictHead({
        fingerprint: r.fingerprint,
        state: r.publish === 'clean' ? 'clean' : 'unreviewable',
        reason: r.publish === 'withheld' ? 'withheld' : (r.publish === 'unreviewable' ? r.reason : undefined),
        tier: r.tier ?? 'C',
        severity: r.publish === 'clean' ? r.severity ?? 0 : 0,
        name: r.name,
        // Truthy is enough: the probe asks "would this be refused", not "is this the
        // final entity". The real call passes the key created below.
        latestReviewKey: r.publish === 'clean' ? 'probe' : undefined,
        modelId: r.modelId, promptVersion: r.promptVersion,
        evidence: r.publish === 'clean' ? PROBE : undefined,
        requireReviewForClean: true,
      });
    } catch (err) {
      throw new Error(`refusing to start the publish: ${r.name} would be rejected by the worker — ${err.message}`);
    }
  }
  log(`  preflight: ${publishable.length} head(s) would be accepted`);

  const withReview = publishable.filter((r) => r.publish === 'clean');
  log(`\npublishing ${publishable.length} verdicts (${withReview.length} with a review body)…`);

  const walrus = await createWalrusWriter({ log: () => {} });
  const arkiv = createArkivWriter({ log: (m) => log(m) });

  // One quilt for every review body: a standalone blob per entry is two Sui
  // transactions each, which does not fit the wallet at this scale (FRICTION-LOG S1,
  // S3 — the publisher does not dedupe and the SDK re-charges).
  const bodies = withReview.map((r) => ({
    identifier: r.fingerprint,
    body: {
      schema: 'surex.review/1',
      fingerprint: r.fingerprint,
      subject: `${r.npmName}@${r.version} (npm tarball)`,
      verdict: r.verdict,
      severity: r.severity,
      findings: r.findings,
      statedIntentSummary: r.statedIntentSummary,
      capabilities: r.capabilitySurface,
      declaredTools: r.declaredTools,
      toolSource: r.toolSource,
      npmIntegrity: r.integrity,
      reviewedFiles: r.reviewedFiles,
      filesNotReviewed: r.notReviewedFiles,
      sourceCoverage: r.sourceCoverage,
      modelId: r.modelId,
      promptVersion: r.promptVersion,
      agreementRuns: r.agreementRuns,
      analyzedAt: new Date().toISOString(),
      disclosure:
        `Read statically by an open-source model from the published npm tarball of ${r.npmName}@${r.version}; ` +
        'no human audited it. The configuration reviewed is the unpinned `npx -y` form, so a later install may ' +
        'resolve to a different version — this verdict is about the version named above and nothing else.',
    },
  }));

  const written = bodies.length ? await walrus.writeQuiltOfRecords(bodies, { label: 'known-server reviews' }) : null;
  const quilt = written?.quilt ?? written ?? null;
  const patches = written ? asPatchArray(written.patches ?? written.pointers) : [];
  if (quilt) log(`  quilt ${quilt.blobId} · registerTx ${quilt.registerTx} · certifyTx ${quilt.certifyTx}`);

  const pointerFor = (fp) => {
    const p = patches.find((x) => x.identifier === fp);
    if (!p) throw new Error(`no quilt patch mapped for ${fp}`);
    if (!p.contentSha256) throw new Error(`patch for ${fp} carries no contentSha256`);
    return { ...quilt, ...p, addressing: 'quilt-patch', quiltBlobId: quilt.blobId };
  };

  // The review records first: a head may not claim `clean` without one, and
  // buildVerdictHead enforces that.
  const reviewKeys = new Map();
  if (withReview.length) {
    const { created } = await arkiv.createMany(withReview.map((r) => buildReviewRecord({
      fingerprint: r.fingerprint,
      sourceKey: `npm:${r.npmName}@${r.version}`,
      verdict: r.verdict, severity: r.severity, analyzedAt: Date.now(),
      modelId: r.modelId, promptVersion: r.promptVersion,
      blob: pointerFor(r.fingerprint),
    })), { chunk: 25 });
    created.forEach((c, i) => reviewKeys.set(withReview[i].fingerprint, c.key));
    log(`  ${created.length} review records written`);
  }

  // Replace the existing heads, never add: getVerdictHead() reads with limit 1, so a
  // second head for the same fingerprint is picked at random. updateEntity is a full
  // replacement and buildVerdictHead emits the complete entity, project attribute
  // included — without it the entity stays on chain and silently leaves every scoped
  // query.
  //
  // The existing head is re-read from chain, not from the /v1 projection: the API's
  // `entityToHead` does not surface `seedSource`, and a full replacement built from
  // that view would drop it permanently.
  const updates = [];
  const noHead = [];
  for (const r of publishable) {
    const [existing] = await arkiv.readBackScoped({ entityType: 'verdictHead', fingerprint: r.fingerprint, limit: 1 });
    if (!existing) { noHead.push(r); continue; }
    // `entity.toJson()` is how the read path decodes a payload (apps/api
    // payloadToObject) — the SDK decodes, and nothing here guesses at an encoding.
    let priorPayload = {};
    try {
      const body = existing.toJson?.();
      if (body && typeof body === 'object') priorPayload = body;
    } catch { /* not JSON — carry nothing forward */ }

    updates.push({
      entityKey: String(existing.key),
      built: buildVerdictHead({
        fingerprint: r.fingerprint,
        state: r.publish === 'clean' ? 'clean' : 'unreviewable',
        reason: r.publish === 'withheld' ? 'withheld' : (r.publish === 'unreviewable' ? r.reason : undefined),
        tier: r.tier ?? 'C',
        severity: r.publish === 'clean' ? r.severity ?? 0 : 0,
        name: r.name,
        latestReviewKey: reviewKeys.get(r.fingerprint),
        sourceKey: r.version ? `npm:${r.npmName}@${r.version}` : undefined,
        integrity: r.integrity ?? undefined,
        modelId: r.modelId, promptVersion: r.promptVersion,
        reviewedAt: r.verdict ? new Date().toISOString() : undefined,
        capabilities: r.capabilitySurface,
        // Carried, not regenerated: how this entry entered the registry is a fact
        // about the past, and re-deriving it would be inventing it.
        seedSource: priorPayload.seedSource,
        evidence: r.publish === 'clean' ? pointerFor(r.fingerprint) : undefined,
        requireReviewForClean: true,
      }),
    });
  }

  if (noHead.length) {
    log(`  ! ${noHead.length} entries have no verdict head on chain and were left untouched: ${noHead.map((r) => r.name).join(', ')}`);
  }

  const res = await arkiv.updateMany(updates, { chunk: 25 });
  log(`  ${updates.length} heads replaced in ${res.txHashes?.length ?? '?'} tx`);
  log('\ndone.\n');
}

function asPatchArray(p) {
  if (!p) return [];
  if (Array.isArray(p)) return p;
  if (typeof p.entries === 'function') return [...p.entries()].map(([identifier, v]) => ({ identifier, ...v }));
  return Object.entries(p).map(([identifier, v]) => ({ identifier, ...v }));
}
