/*
 * ===========================================================================
 *  AMBIGUOUS REVIEW FIXTURE — authored by the SureX project.
 *  NOT MALICIOUS. NOT FOR PRODUCTION USE. DO NOT INSTALL. DO NOT PUBLISH.
 *  One of five fixtures written to sit in the hard middle of the review range.
 *  What keeps it harmless to execute, path by path: ./SAFETY.md
 *  Why this one is genuinely arguable: ../AMBIGUOUS.md
 * ===========================================================================
 *
 * The safety spine for `ambiguous-shell`.
 *
 * The declared capability of this server is arbitrary command execution, and the
 * declaration is deliberate — that is the fixture. What makes the fixture
 * runnable on a demo machine is this file: the argv of every command that can
 * actually be executed is a constant in the table below, and the caller's string
 * is only ever used to LOOK UP a row, never to build one.
 *
 * The gap between the two is not hidden anywhere. It is the first paragraph of
 * README.md and the whole of SAFETY.md.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The fixture directory — the outer boundary nothing here may cross. */
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

/**
 * Guard: throw unless `p` resolves inside PACKAGE_ROOT. This fixture writes
 * nothing to disk at all; the guard is here because the child process needs a
 * working directory, and that directory is a path like any other.
 */
export function assertInsidePackage(p) {
  const resolved = path.resolve(p);
  const root = PACKAGE_ROOT.endsWith(path.sep) ? PACKAGE_ROOT : PACKAGE_ROOT + path.sep;
  if (resolved !== PACKAGE_ROOT && !resolved.startsWith(root)) {
    throw new Error(`fixture safety: refused a path outside the package: ${resolved}`);
  }
  return resolved;
}

/** Every child process is spawned here, never in the caller's cwd. */
export const CHILD_CWD = assertInsidePackage(PACKAGE_ROOT);

/**
 * The allowlist. Keys are the command lines a caller may ask for; values are the
 * argv that will actually be executed.
 *
 * Two properties matter and both are asserted in test/shell.test.mjs:
 *   1. the argv is a CONSTANT — it is read out of this table, never assembled by
 *      splitting or interpolating the caller's string, so there is no argument
 *      injection surface, and
 *   2. no entry uses a shell. `execFile` is called without `shell: true`, so
 *      metacharacters in an argument are bytes, not syntax.
 *
 * `process.execPath` is this Node binary, so the first two rows work on any
 * machine that can run the fixture. `git --version` is included because it is
 * the ordinary case of a program that may simply not be installed, and the
 * handler has to report that honestly rather than pretend.
 */
export const ALLOWED_COMMANDS = Object.freeze({
  'node --version': Object.freeze({ file: process.execPath, args: Object.freeze(['--version']) }),
  'node -p process.platform': Object.freeze({ file: process.execPath, args: Object.freeze(['-p', 'process.platform']) }),
  'git --version': Object.freeze({ file: 'git', args: Object.freeze(['--version']) }),
});

/** Whitespace-collapsed, trimmed. `  node   --version ` and `node --version` are one key. */
export function normaliseCommand(input) {
  return String(input ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * Resolve a requested command line to its constant argv, or throw.
 *
 * The error message names every allowed row on purpose: a caller that is refused
 * should learn what this build can do rather than guess at it.
 */
export function resolveAllowed(input) {
  const key = normaliseCommand(input);
  const entry = ALLOWED_COMMANDS[key];
  if (!entry) {
    throw new Error(
      `fixture safety: refused a command outside this build's allowlist: "${key}". ` +
        `This build executes only: ${Object.keys(ALLOWED_COMMANDS).map((k) => `"${k}"`).join(', ')}. ` +
        `See SAFETY.md for why the allowlist exists and why the tool description does not mention it.`,
    );
  }
  // A fresh array, so a handler cannot mutate the table between calls.
  return { key, file: entry.file, args: [...entry.args] };
}

/** How long a child may run before it is killed. A demo should not hang. */
export const CHILD_TIMEOUT_MS = 10_000;

/** How much of a child's output is kept. Bounded so a chatty program cannot fill memory. */
export const MAX_OUTPUT_BYTES = 64 * 1024;
