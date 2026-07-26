// AUTO-GENERATED — do not edit.
// Vendored from packages/core/src by scripts/sync-core.mjs, because the plugin
// runs on a user's machine with nothing installed. Edit the original and re-run
// `pnpm sync:core`.
// SXF-1 — the install-config fingerprint.
//
// Normative, and versioned on purpose: a change to canonicalisation changes
// every key in the registry, so the version string is part of the hashed input.
// Spec: docs/surex-tech-spec.md §2.
//
// Node stdlib only. This file is vendored verbatim into the Claude Code plugin,
// which must run with zero installed dependencies — see scripts/sync-core.mjs.

import { createHash } from 'node:crypto';

export const SXF_VERSION = 'SXF-1';

/** Runners we can parse a package out of. Anything else becomes `other:<name>`. */
const KNOWN_RUNNERS = new Set(['npx', 'uvx', 'node', 'python', 'python3', 'bun', 'deno', 'docker']);

/** Runner ceremony that carries no identity. Dropped before anything else. */
const CEREMONY = new Set(['-y', '--yes', '-q', '--quiet', '--silent', '--no-install']);

/**
 * Flags whose value changes between machines or runs without changing what the
 * server *is*. Dropped with their value when they take one.
 */
const TRANSIENT_FLAGS = new Set([
  '--port', '-p',
  '--debug',
  '--verbose', '-v',
  '--log-level', '--loglevel',
  '--cwd',
]);

/** Transient flags that consume the following argument as their value. */
const TRANSIENT_WITH_VALUE = new Set(['--port', '-p', '--log-level', '--loglevel', '--cwd']);

/** Docker flags that consume the following argument, so we don't mistake it for the image. */
const DOCKER_VALUE_FLAGS = new Set([
  '-e', '--env', '-v', '--volume', '--name', '--network', '-p', '--publish',
  '-w', '--workdir', '-u', '--user', '--mount', '--label', '-l', '--entrypoint',
]);

const UNPINNED = 'unpinned';

/**
 * A local script whose entry-file content was not supplied. Deliberately not a
 * usable identity: it means "we cannot tell these apart", and the gate must warn
 * rather than resolve it to somebody else's verdict.
 */
export const LOCAL_UNRESOLVED = 'local-unresolved';

/** A version string only counts as pinned if it names exactly one artifact. */
function isPinnedVersion(version) {
  if (!version) return false;
  if (version.startsWith('sha256:')) return true; // docker digest
  // Ranges, tags and wildcards all resolve to "whatever is newest today".
  if (/^[\^~><=*]|x|latest|next|beta|alpha|canary|\|\||\s-\s/i.test(version)) return false;
  return /^\d+\.\d+\.\d+/.test(version) || /^\d+\.\d+$/.test(version) || /^\d+$/.test(version);
}

/** Split `@scope/name@1.2.3`, `name@1.2.3`, `name` — scope leading @ must survive. */
export function parseNpmSpec(spec) {
  if (!spec) return null;
  // A git / URL / local install can never be pinned to a published artifact.
  if (/^(git\+|https?:|file:|github:|gitlab:|bitbucket:|\.{1,2}\/|\/)/i.test(spec) || spec.includes('#')) {
    return { name: spec, version: UNPINNED };
  }
  const at = spec.lastIndexOf('@');
  if (at > 0) {
    const name = spec.slice(0, at);
    const version = spec.slice(at + 1);
    return { name, version: isPinnedVersion(version) ? version : UNPINNED };
  }
  return { name: spec, version: UNPINNED };
}

/** `pkg==1.2.3` (pip/uv) or `pkg@1.2.3`, whichever the caller wrote. */
function parsePythonSpec(spec) {
  if (!spec) return null;
  const m = spec.match(/^([A-Za-z0-9._-]+)\s*==\s*(.+)$/);
  if (m) return { name: m[1], version: isPinnedVersion(m[2]) ? m[2] : UNPINNED };
  return parseNpmSpec(spec);
}

/** `registry/org/image:tag` or `image@sha256:…`. */
function parseDockerImage(spec) {
  if (!spec) return null;
  const atDigest = spec.indexOf('@sha256:');
  if (atDigest > 0) {
    return { name: spec.slice(0, atDigest), version: spec.slice(atDigest + 1) };
  }
  // A colon only marks a tag if it is after the last slash (else it's a port).
  const lastSlash = spec.lastIndexOf('/');
  const colon = spec.lastIndexOf(':');
  if (colon > lastSlash && colon !== -1) {
    const version = spec.slice(colon + 1);
    return { name: spec.slice(0, colon), version: isPinnedVersion(version) ? version : UNPINNED };
  }
  return { name: spec, version: UNPINNED };
}

/**
 * Shells that exist only to launch the real command. On Windows an MCP server is
 * almost always `cmd /c npx <pkg>` where macOS has `npx <pkg>`; without
 * unwrapping the two hash differently AND the Windows form loses the package name
 * entirely, so the gate recognises almost nothing while looking like it works.
 */
const SHELL_WRAPPERS = {
  cmd: ['/c', '/k'],
  sh: ['-c'],
  bash: ['-c'],
  zsh: ['-c'],
  pwsh: ['-command', '-c'],
  powershell: ['-command', '-c'],
};

/** Quote-aware split, for the `sh -c "npx pkg --flag"` single-string form. */
function splitCommandLine(line) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** Peel `cmd /c …`, `sh -c "…"` and friends until the real command is exposed. */
export function unwrapShell(command, args) {
  let cmd = command;
  let list = Array.isArray(args) ? args.map(String) : [];
  // Bounded: a wrapper chain deeper than this is pathological, not portable.
  for (let depth = 0; depth < 3; depth++) {
    const base = String(cmd ?? '').split(/[\\/]/).pop().toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/i, '');
    const flags = SHELL_WRAPPERS[base];
    if (!flags) break;
    const at = list.findIndex((a) => flags.includes(String(a).toLowerCase()));
    if (at === -1) break;
    let rest = list.slice(at + 1);
    if (rest.length === 1 && /\s/.test(rest[0])) rest = splitCommandLine(rest[0]);
    if (!rest.length) break;
    cmd = rest[0];
    list = rest.slice(1);
  }
  return { command: cmd, args: list };
}

function isFlag(arg) {
  return typeof arg === 'string' && arg.startsWith('-');
}

/** Absolute paths are machine-specific and say nothing about identity. */
function isAbsolutePath(arg) {
  return /^([A-Za-z]:[\\/]|[\\/]{1,2}|~[\\/])/.test(arg);
}

/**
 * Does this package spec actually name a file on this machine rather than a
 * published artifact? A registry reference (`github:owner/repo`, a URL, a scoped
 * npm name) is not local even though it contains a slash.
 */
export function isLocalEntrySpec(spec) {
  if (!spec || typeof spec !== 'string') return false;
  if (/^(git\+|https?:|github:|gitlab:|bitbucket:|npm:|jsr:|@)/i.test(spec)) return false;
  if (/^([.~]|[\\/]|[A-Za-z]:[\\/])/.test(spec)) return true;
  return /\.(m?js|cjs|ts|mts|cts|py|rb|php)$/i.test(spec);
}

/**
 * `/usr/local/bin/npx` and `C:\Program Files\nodejs\npx.cmd` must fingerprint
 * identically, so the runner is the lowercased basename with any Windows
 * executable suffix removed.
 */
export function normaliseRunner(command) {
  if (!command) return 'other:';
  const base = String(command).split(/[\\/]/).pop().toLowerCase();
  const bare = base.replace(/\.(exe|cmd|bat|ps1)$/i, '');
  return KNOWN_RUNNERS.has(bare) ? bare : `other:${bare}`;
}

/**
 * Extract the package and return the residual args.
 * Residual arg ORDER IS PRESERVED — most CLIs are order-sensitive, so sorting
 * them would collapse two materially different servers onto one fingerprint.
 */
function extractPackage(runner, args) {
  const rest = [];
  let pkg = null;
  let i = 0;

  if (runner === 'docker') {
    // Skip the subcommand and every flag (plus the values they consume) until
    // the first bare token, which is the image.
    while (i < args.length) {
      const a = args[i];
      if (a === 'run' || a === 'create') { i++; continue; }
      if (isFlag(a)) {
        if (a.includes('=')) { i++; continue; }
        if (DOCKER_VALUE_FLAGS.has(a)) { i += 2; continue; }
        i++;
        continue;
      }
      pkg = { ...parseDockerImage(a), _spec: a };
      i++;
      break;
    }
  } else if (runner === 'npx' || runner === 'bun' || runner === 'deno') {
    while (i < args.length) {
      const a = args[i];
      if (CEREMONY.has(a)) { i++; continue; }
      if (a === 'run' || a === 'x' || a === 'dlx') { i++; continue; }
      // `deno run --allow-net ./server.ts` — permissions come BEFORE the entry and
      // ARE identity-relevant, so keep them and keep scanning rather than breaking
      // and never finding the script.
      if (isFlag(a)) {
        if (runner === 'deno') { rest.push(a); i++; continue; }
        break;
      }
      pkg = { ...parseNpmSpec(a), _spec: a };
      i++;
      break;
    }
  } else if (runner === 'uvx' || runner === 'python' || runner === 'python3') {
    while (i < args.length) {
      const a = args[i];
      if (CEREMONY.has(a)) { i++; continue; }
      if (a === '-m') { i++; continue; }
      if (isFlag(a)) break;
      pkg = { ...parsePythonSpec(a), _spec: a };
      i++;
      break;
    }
  } else if (runner === 'node') {
    while (i < args.length) {
      const a = args[i];
      if (CEREMONY.has(a)) { i++; continue; }
      if (isFlag(a)) break;
      // `node ./server.js` names a local file, never a published artifact. The
      // absolute path cannot go in the fingerprint (machine-specific), and the
      // basename alone is NOT an identity — every locally-run MCP server is
      // `node server.js`, so they would all collide onto one entry and the gate
      // would apply one server's verdict to another's code. The identity is the
      // CONTENT of the entry file (see `hashLocalEntry`), which is also
      // reproducible across machines. Without a resolver this stays unresolved
      // and the gate treats it as unidentifiable.
      pkg = { name: String(a).split(/[\\/]/).pop(), version: LOCAL_UNRESOLVED, _spec: String(a) };
      i++;
      break;
    }
  }

  // Everything after the package spec, minus ceremony, transients and paths.
  for (; i < args.length; i++) {
    const a = args[i];
    if (CEREMONY.has(a)) continue;
    if (isAbsolutePath(a)) continue;
    const bare = a.includes('=') ? a.slice(0, a.indexOf('=')) : a;
    if (TRANSIENT_FLAGS.has(bare)) {
      if (!a.includes('=') && TRANSIENT_WITH_VALUE.has(bare)) i++; // drop its value too
      continue;
    }
    rest.push(a);
  }

  return { pkg: pkg ?? { name: '', version: UNPINNED }, rest };
}

/**
 * Local proxies that carry no identity of their own — `npx mcp-remote <url>` is a
 * remote server wearing a stdio costume. Fingerprinting the shim would put every
 * remote server behind one entry.
 */
const STDIO_TO_REMOTE_PROXIES = new Set(['mcp-remote', 'supergateway', '@modelcontextprotocol/mcp-remote']);

/**
 * Canonical form for a stdio server. Spec §2.2.
 *
 * @param {object} def   the server definition, after ${VAR} expansion
 * @param {{hashLocalEntry?: (path: string) => string|null}} [opts]
 *   `hashLocalEntry` resolves a local script's entry file to a content digest.
 *   Absent, a local script stays LOCAL_UNRESOLVED rather than colliding with
 *   every other `node server.js` in existence.
 */
export function canonicaliseStdio(def, opts = {}) {
  const unwrapped = unwrapShell(def.command, def.args);
  const runner = normaliseRunner(unwrapped.command);
  const { pkg, rest } = extractPackage(runner, unwrapped.args);

  if (STDIO_TO_REMOTE_PROXIES.has(pkg.name)) {
    const url = rest.find((a) => /^https?:\/\//i.test(a));
    // A proxy with no visible URL stays a stdio entry, not a wrong remote one.
    if (url) return canonicaliseRemote({ url });
  }

  // Any runner can be pointed at a local script, not just `node` — same collision
  // problem, same treatment.
  let name = pkg.name;
  let version = pkg.version;
  if (isLocalEntrySpec(pkg._spec)) {
    name = String(pkg._spec).split(/[\\/]/).pop();
    version = LOCAL_UNRESOLVED;
  }

  if (version === LOCAL_UNRESOLVED && typeof opts.hashLocalEntry === 'function') {
    const digest = opts.hashLocalEntry(pkg._spec);
    // Content identity: reproducible on any machine holding the same file.
    if (digest) version = `local:${String(digest).slice(0, 16)}`;
  }

  return {
    v: SXF_VERSION,
    transport: 'stdio',
    runner,
    package: { name, version },
    args: rest,
    // `env` is excluded entirely (NFR-2): values are secrets, and keys leak
    // little enough that dropping them costs nothing.
  };
}

/**
 * Canonical form for a remote server. Spec §2.3.
 * This identifies an ENDPOINT, not a version of anything, so it is always Tier C.
 */
export function canonicaliseRemote(def) {
  const url = new URL(def.url);
  let path = url.pathname.replace(/\/+$/, '');
  if (path === '') path = '/';
  return {
    v: SXF_VERSION,
    transport: url.protocol === 'ws:' || url.protocol === 'wss:' ? 'ws' : 'http',
    host: url.hostname.toLowerCase(),
    path,
    // query string and `headers` excluded — auth lives in both.
  };
}

/** Recursively stable stringify. Key order must never depend on insertion order. */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/**
 * Canonicalise one MCP server definition, as it appears in a client config
 * AFTER ${VAR} expansion.
 */
export function canonicalise(def, opts = {}) {
  if (!def || typeof def !== 'object') throw new TypeError('server definition must be an object');
  const isRemote = def.url || def.type === 'http' || def.type === 'sse' || def.type === 'ws';
  return isRemote ? canonicaliseRemote(def) : canonicaliseStdio(def, opts);
}

/**
 * True when a canonical form does not identify anything specific enough to look
 * up. The gate must warn on these rather than resolve them, because the entry it
 * would find belongs to a different server.
 */
export function isUnidentifiable(canonical) {
  return canonical?.transport === 'stdio' && canonical?.package?.version === LOCAL_UNRESOLVED;
}

/** `sxf1_` + sha256 of the canonical form, hex, lowercase. Spec §2.4. */
export function fingerprintOf(canonical) {
  const hash = createHash('sha256').update(stableStringify(canonical), 'utf8').digest('hex');
  return `sxf1_${hash}`;
}

/** Convenience: config block in, fingerprint out. */
export function fingerprint(def) {
  return fingerprintOf(canonicalise(def));
}

/**
 * Tier. Spec §2.5.
 *
 * A is only reachable when the reviewed artifact's integrity digest matches the
 * one installed locally. B means the version string matches but the bytes were
 * never compared. C means nothing was checked, and the verdict may be about
 * code that is not the code about to run.
 */
export function tierOf(canonical, { recordedIntegrity = null, localIntegrity = null } = {}) {
  if (canonical.transport !== 'stdio') return 'C';
  if (canonical.package?.version === UNPINNED || !canonical.package?.version) return 'C';
  if (!recordedIntegrity || !localIntegrity) return 'B';
  // A mismatch is NOT tier A and NOT a block — it downgrades to `stale` and warns
  // (FR-19); blocking on what is usually a registry quirk trains users to disable
  // the gate.
  return recordedIntegrity === localIntegrity ? 'A' : 'MISMATCH';
}

/**
 * Server name out of a hook's `tool_name` — the hook payload carries no
 * server-name field (FRICTION-LOG C3). Plugin-provided servers are named
 * `mcp__plugin_<plugin>_<server>__<tool>`, so a naive three-way split on `__`
 * gets them wrong.
 */
export function parseServerFromToolName(toolName) {
  if (typeof toolName !== 'string') return null;
  const m = toolName.match(/^mcp__(plugin_[^_]+_)?(.+?)__(.+)$/);
  if (!m) return null;
  return { plugin: m[1] ? m[1].slice('plugin_'.length, -1) : null, server: m[2], tool: m[3] };
}

export const _internals = { isPinnedVersion, parseDockerImage, parsePythonSpec, UNPINNED };
