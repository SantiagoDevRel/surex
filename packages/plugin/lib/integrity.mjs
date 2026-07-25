// Tier A: is the code about to run the code that was reviewed?
//
// This is the answer to the product's deepest structural weakness — a config
// fingerprint identifies an *install instruction*, not the bytes it resolves
// to. npm publishes a per-version `dist.integrity` (sha512 of the published
// tarball); the worker records it at review time and the gate compares it to
// what is actually installed. Agreement is Tier A. Absence is Tier B, honestly
// labelled. Disagreement is a MISMATCH, which downgrades and warns and
// deliberately does NOT block (FR-19): it is far more often a registry quirk or
// a local rebuild than an attack, and blocking on it would train users to turn
// the gate off.
//
// failure-modes §1.1 flags the hard part: `npx -y pkg` never creates a local
// node_modules — it resolves into ~/.npm/_npx/<hash>/ — and pnpm, yarn and bun
// all lay things out differently again. So this searches every layout it can,
// and reports WHERE it found the digest, because "we could not check" and "we
// checked and it matched" must never look the same to a user.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function ancestors(dir) {
  const out = [];
  let cur = resolve(dir);
  for (;;) {
    out.push(cur);
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return out;
}

/** An installed package's own manifest records the digest npm fetched it with. */
function fromInstalledManifest(root, name, version) {
  const path = join(root, 'node_modules', ...name.split('/'), 'package.json');
  const pkg = readJson(path);
  if (!pkg) return null;
  if (version && pkg.version !== version) return null;
  const integrity = pkg._integrity ?? pkg.dist?.integrity ?? null;
  if (!integrity) return null;
  return { integrity, source: path, layout: 'node_modules/_integrity' };
}

/** npm's lockfile v2/v3 keeps integrity per resolved path. */
function fromNpmLock(root, name, version) {
  const lock = readJson(join(root, 'package-lock.json'));
  if (!lock?.packages) return null;
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!key.endsWith(`node_modules/${name}`)) continue;
    if (version && entry.version !== version) continue;
    if (!entry.integrity) continue;
    return { integrity: entry.integrity, source: join(root, 'package-lock.json'), layout: 'package-lock.json' };
  }
  return null;
}

/**
 * pnpm's lockfile is YAML. Rather than take a YAML dependency — this package
 * must stay zero-dep — pull the one field we need with a scoped regex, and
 * return null rather than guess if the shape is not what we expect.
 */
function fromPnpmLock(root, name, version) {
  const path = join(root, 'pnpm-lock.yaml');
  if (!existsSync(path)) return null;
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { return null; }
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = version
    ? new RegExp(`^\\s+/?${escaped}@${version.replace(/\./g, '\\.')}[^:]*:\\s*$`, 'm')
    : new RegExp(`^\\s+/?${escaped}@[^:]*:\\s*$`, 'm');
  const at = text.search(re);
  if (at === -1) return null;
  const block = text.slice(at, at + 800);
  const m = block.match(/integrity:\s*(sha\d{3}-[A-Za-z0-9+/=]+)/);
  if (!m) return null;
  return { integrity: m[1], source: path, layout: 'pnpm-lock.yaml' };
}

/** yarn berry keeps a `checksum`, which is NOT an npm integrity string. */
function fromYarnLock(root, name, version) {
  const path = join(root, 'yarn.lock');
  if (!existsSync(path)) return null;
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { return null; }
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`"?${escaped}@[^"\\n]*"?:\\n(?:.*\\n)*?\\s+integrity\\s+(sha\\d{3}-[A-Za-z0-9+/=]+)`, 'm');
  const m = text.match(re);
  if (!m) return null;
  if (version && !new RegExp(`version\\s+"?${version.replace(/\./g, '\\.')}`).test(text.slice(text.search(re), text.search(re) + 400))) {
    return null;
  }
  return { integrity: m[1], source: path, layout: 'yarn.lock (v1)' };
}

/**
 * The case that actually matters: `npx -y pkg@1.2.3`.
 *
 * npx materialises the package under ~/.npm/_npx/<hash>/node_modules, with no
 * project node_modules anywhere. Each hash directory is a different arg set, so
 * we scan them and take the one whose version matches.
 */
function fromNpxCache(name, version, home) {
  const root = join(home, '.npm', '_npx');
  if (!existsSync(root)) return null;
  let dirs;
  try { dirs = readdirSync(root); } catch { return null; }
  for (const hash of dirs) {
    const hit = fromInstalledManifest(join(root, hash), name, version);
    if (hit) return { ...hit, layout: `npx cache (~/.npm/_npx/${hash})` };
    // The npx sandbox also carries its own lockfile in newer npm versions.
    const viaLock = fromNpmLock(join(root, hash), name, version);
    if (viaLock) return { ...viaLock, layout: `npx cache lockfile (~/.npm/_npx/${hash})` };
  }
  return null;
}

/**
 * Find a locally installed integrity digest for a package, or say why not.
 *
 * @returns {{integrity: string|null, source: string|null, layout: string|null, searched: string[]}}
 */
export function findLocalIntegrity(name, version, opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const home = opts.homedir ?? homedir();
  const searched = [];

  if (!name) return { integrity: null, source: null, layout: null, searched };

  for (const root of ancestors(cwd)) {
    for (const probe of [fromInstalledManifest, fromNpmLock, fromPnpmLock, fromYarnLock]) {
      const hit = probe(root, name, version);
      searched.push(`${probe.name} @ ${root}`);
      if (hit) return { ...hit, searched };
    }
  }

  const npx = fromNpxCache(name, version, home);
  searched.push(`npx cache @ ${join(home, '.npm', '_npx')}`);
  if (npx) return { ...npx, searched };

  return { integrity: null, source: null, layout: null, searched };
}

/**
 * The honest sentence for a verdict, given what we could and could not check.
 * Never says a check passed that did not run.
 */
export function integrityNote(result) {
  if (!result?.integrity) {
    return 'no integrity digest is readable for this install, so the bytes were not compared';
  }
  return `local digest read from ${result.layout}`;
}
