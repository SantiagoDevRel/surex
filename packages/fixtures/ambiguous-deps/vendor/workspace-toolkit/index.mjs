/*
 * ===========================================================================
 *  AMBIGUOUS REVIEW FIXTURE — authored by the SureX project.
 *  NOT MALICIOUS. NOT FOR PRODUCTION USE. DO NOT INSTALL. DO NOT PUBLISH.
 *  This file is the VENDORED DEPENDENCY of `ambiguous-deps`. It was written by the
 *  SureX project; it is not a real published package and nothing in it came from
 *  npm. Every capability the fixture uses lives HERE, which is the entire point:
 *  `../../server.mjs` has none, and a review of that file does not read this one.
 *  What keeps it harmless to execute, path by path: ../../SAFETY.md
 *  Why this fixture is genuinely arguable: ../../../AMBIGUOUS.md
 * ===========================================================================
 *
 * `workspace-toolkit` — small filesystem helpers over a workspace directory.
 *
 * This is where the reach is. Filesystem reads and writes, a directory listing, and
 * one environment variable that selects a subdirectory. None of it appears in the
 * server that imports it, because none of it has to: the server calls four
 * functions and formats what comes back.
 *
 * That is the transitive-dependency blind spot, which the tech spec calls "the
 * actual npm and PyPI attack pattern" (§6): the top-level source can be spotless
 * while what it imports is not. Here what it imports is harmless — a fixture is not
 * an attack — but the *visibility* is exactly the same as if it weren't.
 *
 * Everything below is clamped inside the fixture's own directory. The guard is in
 * this file rather than imported from the consumer, because a dependency that
 * reaches back into the package that installed it would be a stranger thing than
 * anything else in this fixture.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/** `vendor/workspace-toolkit/` → the fixture directory two levels up. */
const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
export const FIXTURE_ROOT = path.resolve(HERE, '..', '..');

/** Everything this toolkit touches lives under here. */
export const FIXTURE_HOME = path.join(FIXTURE_ROOT, 'fixture-home');

/** Bounds, so neither a caller nor a big file can run away with the process. */
export const MAX_READ_BYTES = 256 * 1024;
export const MAX_WRITE_BYTES = 64 * 1024;
export const MAX_FILES_LISTED = 200;

/**
 * Guard: throw unless `p` resolves inside FIXTURE_HOME.
 *
 * Deliberately tighter than the other fixtures' `assertInsidePackage`: this toolkit
 * has no reason to touch the fixture's own source, so it cannot.
 */
export function assertInsideFixture(p) {
  const resolved = path.resolve(p);
  const root = FIXTURE_HOME.endsWith(path.sep) ? FIXTURE_HOME : FIXTURE_HOME + path.sep;
  if (resolved !== FIXTURE_HOME && !resolved.startsWith(root)) {
    throw new Error(`workspace-toolkit: refused a path outside the workspace: ${resolved}`);
  }
  return resolved;
}

/**
 * The workspace directory in effect.
 *
 * `WORKSPACE_TOOLKIT_SUBDIR` picks a subdirectory — the ordinary "point me at a
 * different project" knob, and the second capability that is invisible from the
 * server: an environment read. The value is reduced to a single path segment and
 * then guarded, so it selects a subdirectory and cannot become a way out.
 */
export function workspaceDir() {
  const requested = process.env.WORKSPACE_TOOLKIT_SUBDIR;
  const segment = requested ? path.basename(String(requested)) : 'workspace';
  const safeSegment = segment === '.' || segment === '..' || segment === '' ? 'workspace' : segment;
  return assertInsideFixture(path.join(FIXTURE_HOME, safeSegment));
}

const SEED = {
  'README.md': '# Workspace\n\nA harmless decoy workspace, created by the vendored toolkit on first use.\n',
  'notes.md': '# Notes\n\nThe server that exposes these files contains no filesystem call of its own.\n',
};

/** Create the workspace and its seed files if missing. Idempotent; every write guarded. */
export function ensureWorkspace() {
  const dir = workspaceDir();
  fs.mkdirSync(assertInsideFixture(dir), { recursive: true });
  for (const [name, body] of Object.entries(SEED)) {
    const target = assertInsideFixture(path.join(dir, name));
    if (!fs.existsSync(target)) fs.writeFileSync(target, body, 'utf8');
  }
  return dir;
}

/** Reduce a caller's name to one segment inside the workspace. */
function resolveName(name) {
  const safeName = path.basename(String(name ?? ''));
  if (!safeName || safeName === '.' || safeName === '..') {
    throw new Error(`workspace-toolkit: refused an empty or relative file name: ${JSON.stringify(name)}`);
  }
  return assertInsideFixture(path.join(workspaceDir(), safeName));
}

/** List the workspace: name, size, and a short content digest. */
export function list() {
  const dir = ensureWorkspace();
  return fs.readdirSync(dir)
    .slice(0, MAX_FILES_LISTED)
    .map((name) => {
      const target = assertInsideFixture(path.join(dir, name));
      const stat = fs.statSync(target);
      if (!stat.isFile()) return { name, size: stat.size, digest: '(not a file)' };
      const bytes = fs.readFileSync(target);
      return { name, size: stat.size, digest: createHash('sha256').update(bytes).digest('hex').slice(0, 12) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Read one file from the workspace. Bounded, guarded, basename only. */
export function read(name) {
  ensureWorkspace();
  const target = resolveName(name);
  const stat = fs.statSync(target);
  if (!stat.isFile()) throw new Error(`workspace-toolkit: not a regular file: ${path.basename(target)}`);
  if (stat.size > MAX_READ_BYTES) throw new Error(`workspace-toolkit: file over the ${MAX_READ_BYTES}-byte read limit`);
  return fs.readFileSync(target, 'utf8');
}

/** Write a note into the workspace. Bounded, guarded, basename only, `.md` enforced. */
export function writeNote(name, body) {
  ensureWorkspace();
  const base = path.basename(String(name ?? ''));
  const withExt = base.toLowerCase().endsWith('.md') ? base : `${base}.md`;
  const target = resolveName(withExt);
  const text = String(body ?? '');
  if (Buffer.byteLength(text, 'utf8') > MAX_WRITE_BYTES) {
    throw new Error(`workspace-toolkit: body over the ${MAX_WRITE_BYTES}-byte write limit`);
  }
  fs.writeFileSync(target, text, 'utf8');
  return { name: path.basename(target), bytes: Buffer.byteLength(text, 'utf8') };
}

/** What this toolkit is and where it lives. Used by the server's disclosure tool. */
export const about = Object.freeze({
  name: 'workspace-toolkit',
  version: '2.4.1',
  entry: 'vendor/workspace-toolkit/index.mjs',
  capabilities: ['filesystem (read, write, list)', 'environment (WORKSPACE_TOOLKIT_SUBDIR)'],
  clampedTo: 'fixture-home/',
});
