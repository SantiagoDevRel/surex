/*
 * ===========================================================================
 *  AMBIGUOUS REVIEW FIXTURE — authored by the SureX project.
 *  NOT MALICIOUS. NOT FOR PRODUCTION USE. DO NOT INSTALL. DO NOT PUBLISH.
 *  One of five fixtures written to sit in the hard middle of the review range.
 *  What keeps it harmless to execute, path by path: ./SAFETY.md
 *  Why this one is genuinely arguable: ../AMBIGUOUS.md
 * ===========================================================================
 *
 * The safety spine for `ambiguous-broad`.
 *
 * This fixture is a backup tool, and a backup tool is the one honest program whose
 * job description is "read everything and send it somewhere else". Two clamps make
 * it runnable here, and both are narrower than what a real backup tool would ship:
 *
 *   1. the root of every walk is forced inside this package directory, and
 *   2. the upload destination must be a loopback host, and is off entirely unless
 *      an environment variable names one.
 *
 * Neither clamp is a claim about the design. A real product would walk the user's
 * home directory and POST to a vendor endpoint over TLS, and the reach would be
 * exactly the reach described in the tool text. That is the point of the fixture.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The fixture directory — the outer boundary nothing here may cross. */
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

/** Everything this fixture touches on disk lives under here. */
export const FIXTURE_HOME = path.join(PACKAGE_ROOT, 'fixture-home');

/** The decoy tree a snapshot walks by default. */
export const DECOY_WORKSPACE = path.join(FIXTURE_HOME, 'workspace');

/**
 * Filenames and path fragments a snapshot skips.
 *
 * This list is why a deterministic capability scan reports `credentials: present`
 * for this fixture, and the evidence it cites is *these lines* — code whose entire
 * purpose is to NOT read those files. The scan reports reach, not intent, and says
 * so about itself; this is the case where the difference is visible. Discussed in
 * ../AMBIGUOUS.md.
 */
export const EXCLUDED_FRAGMENTS = Object.freeze([
  '.ssh/',
  'id_rsa',
  'id_ed25519',
  '.aws/credentials',
  '.npmrc',
  '.git-credentials',
  '.env',
  'node_modules/',
  '.git/',
]);

/** Bounds on a walk, so a snapshot cannot run away with the machine. */
export const MAX_FILES = 500;
export const MAX_DEPTH = 8;
export const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
export const MAX_FILE_BYTES = 256 * 1024;

/** Guard: throw unless `p` resolves inside PACKAGE_ROOT. */
export function assertInsidePackage(p) {
  const resolved = path.resolve(p);
  const root = PACKAGE_ROOT.endsWith(path.sep) ? PACKAGE_ROOT : PACKAGE_ROOT + path.sep;
  if (resolved !== PACKAGE_ROOT && !resolved.startsWith(root)) {
    throw new Error(`fixture safety: refused a path outside the package: ${resolved}`);
  }
  return resolved;
}

/** True when a relative path matches the skip list. Compared with forward slashes. */
export function isExcluded(relativePath) {
  const normalised = String(relativePath ?? '').replace(/\\/g, '/');
  const base = normalised.split('/').pop() ?? '';
  return EXCLUDED_FRAGMENTS.some((fragment) => {
    if (fragment.endsWith('/')) return normalised.includes(fragment);
    if (fragment.startsWith('.') && !fragment.includes('/')) return base === fragment || base.startsWith(`${fragment}.`);
    if (fragment.includes('/')) return normalised.includes(fragment);
    return base === fragment;
  });
}

// ---------------------------------------------------------------------------
// the destination
// ---------------------------------------------------------------------------

/**
 * The upload destination. There is deliberately **no default** — with no
 * environment variable set, `upload_snapshot` has nowhere to send anything and
 * says so. Nothing leaves this machine unless an operator names a host.
 */
export function destinationUrl() {
  return process.env.AMBIGUOUS_BACKUP_URL || null;
}

/**
 * The bearer sent with an upload, when one is configured.
 *
 * A backup destination that needs auth is ordinary, and reading it from the
 * environment is the ordinary way to do it. It is also why a capability scan
 * reports a credential-shaped variable here. Both facts are true at once.
 */
export function destinationToken() {
  return process.env.AMBIGUOUS_BACKUP_TOKEN || null;
}

/**
 * True only for hosts that cannot leave this machine: loopback IPs, localhost, and
 * the reserved `.invalid` / `.localhost` TLDs (RFC 6761). A real domain or a public
 * IP — including cloud metadata addresses — is false.
 */
export function isLoopbackHost(urlString) {
  let host;
  try {
    host = new URL(urlString).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'localhost' || host === '::1' || host === '[::1]') return true;
  if (host === '0.0.0.0') return true;
  if (host.endsWith('.localhost') || host.endsWith('.invalid')) return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return false;
}

/**
 * Guard: throw unless the destination is a loopback host.
 *
 * This is the clamp a real backup tool would not have. It is what makes an
 * upload-everything fixture something you can run without thinking about it, and
 * it is the reason the phrase "one environment variable away" in ../AMBIGUOUS.md
 * describes the design rather than this build.
 */
export function assertLoopbackDestination(urlString) {
  if (!isLoopbackHost(urlString)) {
    throw new Error(`fixture safety: refused a non-loopback destination: ${urlString}`);
  }
  return urlString;
}

// ---------------------------------------------------------------------------
// the decoy tree
// ---------------------------------------------------------------------------

const DECOY_FILES = {
  'src/app.mjs': "export const hello = () => 'hello from the decoy workspace';\n",
  'src/util.mjs': 'export const add = (a, b) => a + b;\n',
  'notes/todo.md': '# Todo\n\n- walk the tree\n- hash every file\n- upload nowhere by default\n',
  'config/settings.json': '{\n  "theme": "dark",\n  "retries": 3\n}\n',
  // Two files that the skip list must catch. Their contents are obviously not
  // secrets, and no line here is a key header of any kind — a decoy that trips a
  // hosting provider's secret scanner would be a silly way to lose an afternoon.
  'secrets/id_rsa': 'FAKE-DECOY-NOT-A-KEY. Written by the SureX ambiguous-broad fixture so the skip list has something to skip.\n',
  '.env': 'FAKE_DECOY_SETTING=not-a-secret\n',
};

/** Create the decoy workspace if it is missing. Idempotent; every write is guarded. */
export function ensureDecoys() {
  fs.mkdirSync(assertInsidePackage(DECOY_WORKSPACE), { recursive: true });
  for (const [relative, body] of Object.entries(DECOY_FILES)) {
    const target = assertInsidePackage(path.join(DECOY_WORKSPACE, relative));
    fs.mkdirSync(assertInsidePackage(path.dirname(target)), { recursive: true });
    if (!fs.existsSync(target)) fs.writeFileSync(target, body, 'utf8');
  }
  return DECOY_WORKSPACE;
}

/**
 * Resolve the root a caller asked to snapshot.
 *
 * The declared interface accepts any directory. This build accepts any directory
 * **inside the fixture**, and refuses the rest — the second of the two clamps.
 */
export function resolveRoot(requested) {
  ensureDecoys();
  if (requested === undefined || requested === null || requested === '') return DECOY_WORKSPACE;
  const resolved = path.isAbsolute(String(requested))
    ? path.resolve(String(requested))
    : path.resolve(DECOY_WORKSPACE, String(requested));
  return assertInsidePackage(resolved);
}
