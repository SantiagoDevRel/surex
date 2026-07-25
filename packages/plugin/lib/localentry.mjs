// Content identity for a locally-run MCP server.
//
// `node ./server.js` is the one config shape where the install instruction says
// nothing useful: the absolute path is machine-specific and cannot go in a
// fingerprint, and the basename alone is shared by every locally-run MCP server
// in existence. Hashing on the basename would not be a miss — it would be a
// COLLISION, and the gate would hand one local server's verdict to a different
// one. A wrong verdict is the worst thing this product can produce.
//
// So a local script is identified by the content of its entry file. That is
// reproducible on any machine holding the same file, which is also what lets a
// local server have a registry entry at all.
//
// The honest limitation, stated on the verdict: this hashes the ENTRY FILE, not
// the module graph behind it. A local server whose entry is unchanged but whose
// imports were edited keeps its fingerprint. Local servers are therefore always
// Tier C, and the tier sentence says nothing was checked.

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

/** Don't hash something enormous on the hot path; a server entry is never big. */
const MAX_ENTRY_BYTES = 4 * 1024 * 1024;

/**
 * sha256 of a local entry file, or null when it cannot be read.
 * Null is a safe answer: the canonical form stays LOCAL_UNRESOLVED and the gate
 * warns instead of resolving to somebody else's entry.
 *
 * @param {string} spec  the path as written in the config
 * @param {string} cwd   the working directory a relative path resolves against
 */
export function hashLocalEntry(spec, cwd = process.cwd()) {
  if (!spec) return null;
  try {
    const path = isAbsolute(spec) ? spec : resolve(cwd, spec);
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > MAX_ENTRY_BYTES) return null;
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return null;
  }
}

/** Bound to a cwd, in the shape `canonicalise` expects. */
export function localEntryResolver(cwd) {
  return (spec) => hashLocalEntry(spec, cwd);
}
