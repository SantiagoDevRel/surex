#!/usr/bin/env node
// Vouch for a fingerprint as SureX-authored, deliberately, off the request path.
//
//   node scripts/allow-self-authored.mjs <sxf1_…> --why "our own news server, repo SantiagoDevRel/mcp-medellin-news"
//   node scripts/allow-self-authored.mjs --list
//
// MANUAL ON PURPOSE. The allowlist is the only thing between an unaudited model
// verdict and a public accusation about named software (AGENTS.md §4) — `buildVerdictHead`
// refuses `flagged` for anything not on it — so the submit pipeline must never write
// to it. Deriving membership from the submitted repo's GitHub owner is unsound:
// codeload serves every commit in a FORK NETWORK from the upstream namespace, so
// anyone who can push to a fork of one of our public repos picks both the bytes and,
// through `package.json`, the fingerprint that would have been allowlisted. Until a
// human runs this, a self-owned flag publishes as `unreviewable / withheld`.
//
// NOTE `scripts/review-and-publish.mjs` REGENERATES this file from the fixture
// directory and drops entries added here. It writes a plain array, this writes
// `{fingerprints, provenance}`; both shapes load (see `loadSelfAuthored`), but a
// fixture republish still truncates the list — fail-safe, and worth knowing before
// you wonder where an entry went.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { selfAuthoredPath, loadSelfAuthored } from '../packages/worker/src/entities.mjs';
import { isFingerprint } from '../packages/core/index.mjs';

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};

const path = fileURLToPath(selfAuthoredPath());

function read() {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (Array.isArray(parsed)) return { fingerprints: parsed.map(String), provenance: {} };
    return { fingerprints: (parsed?.fingerprints ?? []).map(String), provenance: parsed?.provenance ?? {} };
  } catch {
    // Absent or unreadable is an EMPTY allowlist, never a guess: a lost file must
    // fail towards "we cannot flag our own fixtures", not the reverse.
    return { fingerprints: [], provenance: {} };
  }
}

if (argv.includes('--list') || !argv.length) {
  const { fingerprints, provenance } = read();
  console.log(`${fingerprints.length} fingerprint(s) may be published as flagged:\n`);
  for (const fp of fingerprints) {
    const p = provenance[fp];
    console.log(`  ${fp}`);
    if (p) console.log(`      ${p.why ?? '(no reason recorded)'} — added ${p.addedAt ?? 'at an unknown time'}`);
  }
  if (!fingerprints.length) console.log('  (none — nothing can be flagged publicly)');
  console.log(`\n${path}`);
  process.exit(0);
}

const fingerprint = argv.find((a) => a.startsWith('sxf1_'));
const why = flag('--why');

if (!fingerprint || !isFingerprint(fingerprint)) {
  console.error('usage: node scripts/allow-self-authored.mjs <sxf1_…64 hex> --why "<why this is ours>"');
  console.error('       node scripts/allow-self-authored.mjs --list');
  process.exit(1);
}
if (!why) {
  console.error('refusing to add a fingerprint with no --why. Say how you know this is ours.');
  process.exit(1);
}

const { fingerprints, provenance } = read();
if (fingerprints.includes(fingerprint)) {
  console.log(`${fingerprint} is already on the allowlist — nothing to do.`);
  process.exit(0);
}

const next = [...fingerprints, fingerprint];
provenance[fingerprint] = { why, addedAt: new Date().toISOString(), addedBy: 'scripts/allow-self-authored.mjs' };

mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, `${JSON.stringify({ fingerprints: next, provenance }, null, 2)}\n`);

loadSelfAuthored({ reload: true });
console.log(`added ${fingerprint}`);
console.log(`  why: ${why}`);
console.log(`\n${next.length} fingerprint(s) may now be published as flagged. ${path}`);
