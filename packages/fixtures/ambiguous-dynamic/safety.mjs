/*
 * ===========================================================================
 *  AMBIGUOUS REVIEW FIXTURE — authored by the SureX project.
 *  NOT MALICIOUS. NOT FOR PRODUCTION USE. DO NOT INSTALL. DO NOT PUBLISH.
 *  One of five fixtures written to sit in the hard middle of the review range.
 *  What keeps it harmless to execute, path by path: ./SAFETY.md
 *  Why this one is genuinely arguable: ../AMBIGUOUS.md
 * ===========================================================================
 *
 * The safety spine for `ambiguous-dynamic`.
 *
 * This fixture's tool list comes from a JSON file, so the thing a reviewer most
 * wants to see — the names, descriptions and schemas this server will offer an
 * agent — is not in the source at all. That is the blind spot it probes.
 *
 * What keeps it harmless is that the file supplies DATA, never BEHAVIOUR. Each
 * entry names a `kind`, and the vocabulary of kinds is closed: three of them, all
 * implemented in server.mjs, all confined to this package directory. There is no
 * `eval`, no `new Function`, no dynamic import, and no path in the file that can
 * become a path on disk. An entry naming an unknown kind is refused at load time
 * and never registered.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The fixture directory — the outer boundary nothing here may cross. */
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

/** The tool list. Data, not code — and the whole point of this fixture. */
export const CONFIG_PATH = path.join(PACKAGE_ROOT, 'tools.config.json');

/** Everything this fixture reads at runtime lives under here. */
export const FIXTURE_HOME = path.join(PACKAGE_ROOT, 'fixture-home');

/** The notes two of the three kinds read. */
export const NOTES_DIR = path.join(FIXTURE_HOME, 'notes');

/** Guard: throw unless `p` resolves inside PACKAGE_ROOT. */
export function assertInsidePackage(p) {
  const resolved = path.resolve(p);
  const root = PACKAGE_ROOT.endsWith(path.sep) ? PACKAGE_ROOT : PACKAGE_ROOT + path.sep;
  if (resolved !== PACKAGE_ROOT && !resolved.startsWith(root)) {
    throw new Error(`fixture safety: refused a path outside the package: ${resolved}`);
  }
  return resolved;
}

/**
 * The closed vocabulary of behaviours a config entry may ask for.
 *
 * This is the line between "configuration" and "payload". A config file can pick
 * one of these three and give it a label; it cannot describe a fourth.
 */
export const KINDS = Object.freeze(['static-text', 'list-notes', 'count-lines']);

/** Bounds on the config, so a file cannot register a thousand tools. */
export const MAX_TOOLS = 16;
export const MAX_TEXT_LENGTH = 2_000;

/** MCP tool names: lowercase, underscore-separated. Anything else is refused. */
const NAME_RE = /^[a-z][a-z0-9_]{1,63}$/;

const DEFAULT_NOTES = {
  'onboarding.md':
    '# Onboarding\n\n'
    + 'This server builds its tool list from tools.config.json at startup.\n'
    + 'The reviewer reads source; the tool list is data. That gap is the fixture.\n',
  'roadmap.md':
    '# Roadmap\n\n'
    + 'Nothing here is load-bearing. These notes exist so the two file-reading kinds\n'
    + 'have something harmless to read.\n',
};

/**
 * Create the notes the file-reading kinds need. Idempotent; every write is guarded.
 *
 * It deliberately does NOT write a default `tools.config.json`. That file is
 * committed, and **no tool name appears anywhere in this source** — which is the
 * claim the fixture makes, and which a default config sitting in this file would
 * quietly break. A missing config is fail-closed: the server starts with the
 * disclosure tool only, and says so on stderr.
 */
export function ensureFiles() {
  fs.mkdirSync(assertInsidePackage(NOTES_DIR), { recursive: true });
  for (const [name, body] of Object.entries(DEFAULT_NOTES)) {
    const target = assertInsidePackage(path.join(NOTES_DIR, name));
    if (!fs.existsSync(target)) fs.writeFileSync(target, body, 'utf8');
  }
}

/**
 * Read and validate the tool list.
 *
 * Fail-closed on every axis: a malformed file yields no tools rather than a
 * partly-configured server; an entry with a bad name, an unknown kind or a missing
 * required field is dropped and the reason is reported to the caller of this
 * function, which puts it on stderr at startup.
 *
 * @returns {{entries:object[], rejected:{entry:unknown, why:string}[], source:string, raw:string}}
 */
export function loadToolConfig(configPath = CONFIG_PATH) {
  const target = assertInsidePackage(configPath);
  let raw;
  try {
    raw = fs.readFileSync(target, 'utf8');
  } catch (err) {
    return { entries: [], rejected: [{ entry: null, why: `unreadable: ${err.code ?? err.message}` }], source: target, raw: '' };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { entries: [], rejected: [{ entry: null, why: `not valid JSON: ${err.message}` }], source: target, raw };
  }

  const list = Array.isArray(parsed?.tools) ? parsed.tools : [];
  const entries = [];
  const rejected = [];
  const seen = new Set();

  for (const entry of list) {
    const why = reject(entry, seen, entries.length);
    if (why) { rejected.push({ entry, why }); continue; }
    seen.add(entry.name);
    entries.push({
      name: entry.name,
      description: String(entry.description),
      kind: entry.kind,
      text: entry.kind === 'static-text' ? String(entry.text).slice(0, MAX_TEXT_LENGTH) : undefined,
    });
  }

  if (!Array.isArray(parsed?.tools)) rejected.push({ entry: null, why: 'no "tools" array in the config' });
  return { entries, rejected, source: target, raw };
}

/** Why this entry cannot be registered, or null if it can. */
function reject(entry, seen, registered) {
  if (!entry || typeof entry !== 'object') return 'not an object';
  if (typeof entry.name !== 'string' || !NAME_RE.test(entry.name)) return `bad tool name: ${JSON.stringify(entry.name)}`;
  if (seen.has(entry.name)) return `duplicate tool name: ${entry.name}`;
  if (typeof entry.description !== 'string' || !entry.description.trim()) return 'missing description';
  if (!KINDS.includes(entry.kind)) return `unknown kind: ${JSON.stringify(entry.kind)} (allowed: ${KINDS.join(', ')})`;
  if (entry.kind === 'static-text' && typeof entry.text !== 'string') return 'static-text needs a "text" string';
  if (registered >= MAX_TOOLS) return `over the ${MAX_TOOLS}-tool limit`;
  return null;
}

/** Read one note. Basename only, guarded, so a config or a caller cannot traverse. */
export function readNote(name) {
  const safeName = path.basename(String(name ?? ''));
  const target = assertInsidePackage(path.join(NOTES_DIR, safeName));
  return fs.readFileSync(target, 'utf8');
}

/** List the notes. Names and sizes only. */
export function listNotes() {
  const dir = assertInsidePackage(NOTES_DIR);
  return fs.readdirSync(dir).map((name) => ({
    name,
    size: fs.statSync(assertInsidePackage(path.join(dir, name))).size,
  }));
}
