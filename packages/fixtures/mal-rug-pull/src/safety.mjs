/*
 * ===========================================================================
 *  DELIBERATELY MALICIOUS FIXTURE — authored by the SureX project.
 *  DO NOT INSTALL. DO NOT PUBLISH. It is written to LOOK malicious on purpose,
 *  so SureX has something real to flag. What keeps it harmless to execute is
 *  documented, path by path, in packages/fixtures/MALICIOUS.md — read it before
 *  running anything here.
 * ===========================================================================
 *
 * The safety spine (a sibling of packages/fixture-mcp/src/safety.mjs). Every
 * dangerous-looking path in this fixture's tools routes through the helpers here,
 * and each helper's whole job is to keep the blast radius inside this package
 * directory:
 *   - the "credentials" the tools read are decoys this package writes itself,
 *   - the "exfiltration" sink defaults to a loopback address and the send is
 *     refused for any non-loopback host, and is off unless explicitly armed.
 * The maliciousness is legible in the source; the runtime effect is a no-op.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The package directory — the outer boundary nothing here may cross. */
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Everything the fixture touches on disk lives under here. */
export const FIXTURE_HOME = path.join(PACKAGE_ROOT, 'fixture-home');

/** The decoy the tools read instead of your real ~/.ssh/id_rsa. */
export const DECOY_SSH_KEY_PATH = path.join(FIXTURE_HOME, '.ssh', 'id_rsa');

/** A second decoy, for the tools whose story is stealing cloud credentials. */
export const DECOY_AWS_CREDENTIALS_PATH = path.join(FIXTURE_HOME, '.aws', 'credentials');

/** Where any honest-facade tool reads from. */
export const DECOY_NOTES_DIR = path.join(FIXTURE_HOME, 'notes');

/**
 * The default outbound sink. Port 9 is the TCP discard port; 127.0.0.1 is the
 * loopback interface. Nothing leaves the machine. An operator can override the
 * URL, but `assertLoopbackSink` refuses anything that is not loopback, so the
 * override cannot turn this into a real exfiltration channel.
 */
export const DEFAULT_SINK = 'http://127.0.0.1:9/surex-fixture-sink';

/** The kill switch. The covert send is skipped entirely unless this is "1". */
export function armed() {
  return process.env.SUREX_FIXTURE_ARM === '1';
}

/** The sink URL actually in effect (env override allowed, loopback enforced). */
export function sinkUrl() {
  return process.env.SUREX_FIXTURE_SINK || DEFAULT_SINK;
}

/**
 * True only for hosts that cannot leave this machine: loopback IPs, localhost,
 * and the reserved `.invalid` / `.localhost` TLDs (RFC 6761). Anything else —
 * a real domain, a public IP — is false.
 */
export function isLoopbackHost(urlString) {
  let host;
  try {
    host = new URL(urlString).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'localhost' || host === '::1' || host === '[::1]') return true;
  if (host === '0.0.0.0') return true;
  if (host.endsWith('.localhost') || host.endsWith('.invalid')) return true;
  // 127.0.0.0/8 — the whole loopback block.
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return false;
}

/**
 * Guard: throw unless `p` resolves inside PACKAGE_ROOT. Used before every read
 * and write, so a crafted argument can never escape the package sandbox.
 */
export function assertInsidePackage(p) {
  const resolved = path.resolve(p);
  const root = PACKAGE_ROOT.endsWith(path.sep) ? PACKAGE_ROOT : PACKAGE_ROOT + path.sep;
  if (resolved !== PACKAGE_ROOT && !resolved.startsWith(root)) {
    throw new Error(`fixture safety: refused a path outside the package: ${resolved}`);
  }
  return resolved;
}

/** Guard: throw unless the sink is a loopback host. */
export function assertLoopbackSink(urlString) {
  if (!isLoopbackHost(urlString)) {
    throw new Error(`fixture safety: refused a non-loopback sink: ${urlString}`);
  }
  return urlString;
}

// The PEM header is assembled at runtime rather than committed as one literal.
// The contents are obviously fake, but the intact header line is precisely the
// pattern a hosting provider's secret scanner blocks a push on — and getting the
// repo flagged over a decoy would be a silly way to lose an afternoon.
const PEM = (kind) => `-----${kind} OPENSSH PRIVATE ` + `KEY-----`;

const DECOY_SSH_KEY = [
  PEM('BEGIN'),
  'THIS-IS-A-FAKE-DECOY-KEY-WRITTEN-BY-A-SUREX-FIXTURE',
  'It is NOT a real private key. It exists only so the fixture has a',
  'credential-shaped file to read from INSIDE its own package directory,',
  'instead of ever touching your real ~/.ssh. See MALICIOUS.md.',
  'AAAA' + '0'.repeat(60),
  PEM('END'),
  '',
].join('\n');

const DECOY_AWS_CREDENTIALS = [
  '[default]',
  '# FAKE decoy written by a SureX fixture. Not real AWS credentials.',
  'aws_access_key_id = ' + 'AKIA' + 'FAKEDECOYSUREX000',
  'aws_secret_access_key = 0000-this-is-a-decoy-not-a-real-secret-0000',
  '',
].join('\n');

const DECOY_NOTES = {
  'onboarding.md':
    '# Onboarding notes\n\n' +
    'The gate blocks a tool call before the server runs.\n' +
    'Arkiv holds the verdict head; Walrus holds the reviewed bytes.\n',
  'roadmap.md':
    '# Roadmap notes\n\n' +
    'Ship the fixtures first — they are the only thing we ever flag.\n',
};

/**
 * Create the decoy files if they are missing. Idempotent, and every write is
 * checked to be inside FIXTURE_HOME first. Called on startup so a fresh clone
 * (or a repo that did not track the dotfiles) still has something to read.
 */
export function ensureDecoys() {
  assertInsidePackage(FIXTURE_HOME);
  const sshDir = path.dirname(DECOY_SSH_KEY_PATH);
  fs.mkdirSync(assertInsidePackage(sshDir), { recursive: true });
  if (!fs.existsSync(DECOY_SSH_KEY_PATH)) {
    fs.writeFileSync(assertInsidePackage(DECOY_SSH_KEY_PATH), DECOY_SSH_KEY, 'utf8');
  }
  const awsDir = path.dirname(DECOY_AWS_CREDENTIALS_PATH);
  fs.mkdirSync(assertInsidePackage(awsDir), { recursive: true });
  if (!fs.existsSync(DECOY_AWS_CREDENTIALS_PATH)) {
    fs.writeFileSync(assertInsidePackage(DECOY_AWS_CREDENTIALS_PATH), DECOY_AWS_CREDENTIALS, 'utf8');
  }
  fs.mkdirSync(assertInsidePackage(DECOY_NOTES_DIR), { recursive: true });
  for (const [name, body] of Object.entries(DECOY_NOTES)) {
    const target = path.join(DECOY_NOTES_DIR, name);
    if (!fs.existsSync(target)) fs.writeFileSync(assertInsidePackage(target), body, 'utf8');
  }
}
