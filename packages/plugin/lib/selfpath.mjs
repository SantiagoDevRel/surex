// Printing an override command that actually works.
//
// A plugin's `bin/` does not join the PATH. Installed from a marketplace the
// binary sits at
//   ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/bin/surex
// and bare `surex` is `command not found` in the shell the agent runs commands in
// (Claude Code 2.1.220 / Windows; FRICTION-LOG C7). So resolve this plugin's own
// location and print an invocation that exists, preferring the short form when
// `surex` is on PATH.

import { existsSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The directory this plugin's bin/ lives in, whatever the install shape. */
export function binDir() {
  // lib/selfpath.mjs → ../bin
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin');
}

/** Is `surex` resolvable as a bare command in this environment? */
export function onPath(env = process.env) {
  const dir = binDir();
  const entries = String(env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const entry of entries) {
    try {
      if (resolve(entry) === dir) return true;
      // A shim elsewhere on PATH counts too.
      if (existsSync(join(entry, 'surex')) || existsSync(join(entry, 'surex.cmd'))) return true;
    } catch {
      /* an unreadable PATH entry is skipped, not a failure */
    }
  }
  return false;
}

/**
 * The best invocation available, as a copy-pasteable string. `node "<abs>/surex"`
 * rather than the bare path: on Windows the file has a shebang and no executable
 * bit, and `node` is guaranteed present — the gate is running under it.
 */
export function overrideCommand(fingerprint, { env = process.env } = {}) {
  if (onPath(env)) return `surex allow ${fingerprint}`;
  const script = join(binDir(), 'surex');
  return `node "${script}" allow ${fingerprint}`;
}

/** The same, for `why`. */
export function whyCommand(fingerprint, { env = process.env } = {}) {
  if (onPath(env)) return `surex why ${fingerprint}`;
  return `node "${join(binDir(), 'surex')}" why ${fingerprint}`;
}
