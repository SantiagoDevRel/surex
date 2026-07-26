#!/usr/bin/env node
// Vouch for a fingerprint as SureX-authored, deliberately, off the request path.
//
//   node scripts/allow-self-authored.mjs <sxf1_…> --why "our own news server, repo SantiagoDevRel/mcp-medellin-news"
//   node scripts/allow-self-authored.mjs --list
//
// WHY THIS IS A SEPARATE, MANUAL STEP.
//
// The allowlist is the one thing standing between an unaudited model verdict and a
// public accusation about a named piece of software (AGENTS.md §4). `buildVerdictHead`
// refuses `flagged` for anything not on it.
//
// The submit pipeline deliberately cannot write to it. It was briefly allowed to —
// adding the fingerprint whenever the submitted repository's GitHub owner was one of
// ours — and a security review reproduced why that is unsound: GitHub serves every
// commit in a repository's FORK NETWORK from the upstream namespace, so
//
//     curl -sSL --fail https://codeload.github.com/<us>/<repo>/tar.gz/<sha-from-a-fork>
//
// succeeds, and anyone who can push to a fork of one of our public repos chooses both
// the bytes and — through `package.json` — the fingerprint that would have been
// allowlisted. A guard that reads state the same request just wrote is one lock
// wearing two hats.
//
// So: a human looks at the fingerprint, knows it is ours, and says so here. That is
// slower on purpose. Until it is run, a self-owned flag publishes as
// `unreviewable / withheld`, which is honest and safe.
//
// NOTE the file is also REGENERATED from the fixture directory by
// `scripts/review-and-publish.mjs`, which would drop entries added here. That script
// writes a plain array; this one writes `{fingerprints, provenance}`. Both shapes load
// (see `loadSelfAuthored`), but a fixture republish still truncates the list — fail-safe
// (nothing gains the right to be flagged) and worth knowing before you wonder where an
// entry went.

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
    // Absent or unreadable is an EMPTY allowlist, never a guess. The failure mode
    // of a lost file must be "we cannot flag our own fixtures", not the reverse.
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
  // An allowlist entry nobody can explain later is indistinguishable from one added
  // by mistake, and this list authorises accusations.
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
// tmp-then-rename would be better under concurrency; this runs by hand, one at a time.
writeFileSync(path, `${JSON.stringify({ fingerprints: next, provenance }, null, 2)}\n`);

loadSelfAuthored({ reload: true });
console.log(`added ${fingerprint}`);
console.log(`  why: ${why}`);
console.log(`\n${next.length} fingerprint(s) may now be published as flagged. ${path}`);
