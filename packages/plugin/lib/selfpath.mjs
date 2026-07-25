// Printing an override command that actually works.
//
// The block message ends with the command that lets a user proceed anyway, and
// that command is the entire reason blocking is defensible: SureX's job is to
// stop nobody running a flagged server *unknowingly*, not to decide for them. A
// block a user cannot pass is a block that gets the gate uninstalled the first
// time it is wrong.
//
// So the command has to work. It was documented — and we had written down as
// verified — that executables in a plugin's `bin/` join the PATH while the plugin
// is enabled. **That is not true here.** Installed from a marketplace, the binary
// sits at
//   ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/bin/surex
// and `surex` is `command not found` in the shell the agent runs commands in.
// Measured on Claude Code 2.1.220 / Windows; FRICTION-LOG C7.
//
// Rather than print a command that does not exist, resolve our own location and
// print one that does — preferring the short form when it really is on PATH.

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
      /* an unreadable PATH entry is not our problem */
    }
  }
  return false;
}

/**
 * The best invocation available, as a copy-pasteable string.
 * `node "<abs>/surex"` is used rather than the bare path because the file has a
 * shebang and no executable bit on Windows, and `node` is guaranteed present —
 * the gate is running under it.
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
