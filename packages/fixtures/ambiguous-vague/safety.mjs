/*
 * ===========================================================================
 *  AMBIGUOUS REVIEW FIXTURE — authored by the SureX project.
 *  NOT MALICIOUS. NOT FOR PRODUCTION USE. DO NOT INSTALL. DO NOT PUBLISH.
 *  One of five fixtures written to sit in the hard middle of the review range.
 *  What keeps it harmless to execute, path by path: ./SAFETY.md
 *  Why this one is genuinely arguable: ../AMBIGUOUS.md
 * ===========================================================================
 *
 * The safety spine for `ambiguous-vague`.
 *
 * This is the narrowest fixture of the five. Its whole runtime effect is one JSON
 * file inside its own directory. There is no network call, no child process, no
 * environment read and no credential path anywhere in it — which is the point:
 * the only thing a reviewer can object to here is the WORDING of its tool
 * descriptions, and this file exists so that claim can be checked rather than
 * taken on faith.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The fixture directory — the outer boundary nothing here may cross. */
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

/** Everything this fixture touches on disk lives under here. */
export const FIXTURE_HOME = path.join(PACKAGE_ROOT, 'fixture-home');

/** The one file. Created on first use, never read from anywhere else. */
export const STORE_PATH = path.join(FIXTURE_HOME, 'workspace.json');

/** Guard: throw unless `p` resolves inside PACKAGE_ROOT. */
export function assertInsidePackage(p) {
  const resolved = path.resolve(p);
  const root = PACKAGE_ROOT.endsWith(path.sep) ? PACKAGE_ROOT : PACKAGE_ROOT + path.sep;
  if (resolved !== PACKAGE_ROOT && !resolved.startsWith(root)) {
    throw new Error(`fixture safety: refused a path outside the package: ${resolved}`);
  }
  return resolved;
}

/** Bounds, so a caller cannot grow the store without limit. */
export const MAX_ITEMS = 200;
export const MAX_ITEM_LENGTH = 500;

const EMPTY = { items: [], updatedAt: null };

/** Create the store if it is missing. Idempotent; every path is guarded first. */
export function ensureStore() {
  fs.mkdirSync(assertInsidePackage(FIXTURE_HOME), { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(assertInsidePackage(STORE_PATH), JSON.stringify(EMPTY, null, 2), 'utf8');
  }
}

/** Read the store. A corrupt file is treated as empty rather than thrown at a caller. */
export function readStore() {
  ensureStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(assertInsidePackage(STORE_PATH), 'utf8'));
    return {
      items: Array.isArray(parsed?.items) ? parsed.items.filter((i) => typeof i === 'string') : [],
      updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : null,
    };
  } catch {
    return { ...EMPTY };
  }
}

/** Write the store. Bounded, guarded, and the only write this fixture performs. */
export function writeStore(items) {
  ensureStore();
  const clean = (Array.isArray(items) ? items : [])
    .filter((i) => typeof i === 'string')
    .map((i) => i.slice(0, MAX_ITEM_LENGTH))
    .slice(0, MAX_ITEMS);
  const body = { items: clean, updatedAt: new Date().toISOString() };
  fs.writeFileSync(assertInsidePackage(STORE_PATH), JSON.stringify(body, null, 2), 'utf8');
  return body;
}
