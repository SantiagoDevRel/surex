// Content identity for a locally-run MCP server.
//
// `node ./server.js` gives nothing fingerprintable: the absolute path is
// machine-specific and the basename is shared by every locally-run MCP server on
// earth, so hashing either is a collision — one local server's verdict handed to
// another. The entry file's content is used instead, which reproduces on any
// machine holding the same file.
//
// The limitation, stated on the verdict: this hashes the entry file, not the
// module graph behind it, so a local server whose imports changed keeps its
// fingerprint. Local servers are therefore always Tier C.

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

/** Don't hash something enormous on the hot path; a server entry is never big. */
const MAX_ENTRY_BYTES = 4 * 1024 * 1024;

/**
 * sha256 of a local entry file, or null when it cannot be read — null keeps the
 * canonical form at LOCAL_UNRESOLVED, so the gate warns rather than resolving to
 * somebody else's entry.
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
