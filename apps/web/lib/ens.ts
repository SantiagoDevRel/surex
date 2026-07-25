/**
 * ENS, server side only.
 *
 * SERVER ONLY, and not by accident: `SUREX_ENS_SIGNING_KEY` is the key an ENS
 * client checks a CCIP-Read response against, and the resolver on Sepolia pins
 * its address. Anything that leaks it lets someone else sign a verdict in
 * SureX's name — and unlike an HTTP response, a signed one is meant to be
 * believed by a contract. Nothing here may ever be imported by a client
 * component, and the key must never become `NEXT_PUBLIC_*`.
 *
 * What lives here is everything pure: the label encoding, the text-record
 * table, and the digest. The route next door does IO and signing and nothing
 * else, so all of the logic worth testing is testable without a server.
 *
 * ⚠️ `signatureDigest()` is duplicated in Solidity — `makeSignatureHash()` in
 * `contracts/src/SureXOffchainResolver.sol`. The gateway signs what this
 * computes and the resolver checks what that computes; if the two ever disagree
 * every lookup fails `resolveWithProof` with no clue why. The same fixed vector
 * is pinned in BOTH suites (`apps/web/test/ens.test.mjs` and
 * `contracts/test/SureXOffchainResolver.t.sol`), so drift breaks a test.
 */

import { copyViolations, isFingerprint } from '@surex/core';
import { encodePacked, keccak256, type Address, type Hex } from 'viem';

import type { VerdictHead } from './types.ts';

/**
 * The label prefix. Deliberately NOT `sxf1_`: ENSIP-15 normalisation rejects a
 * mid-label underscore (`underscore allowed only at start`), so the fingerprint
 * is not a legal ENS label as written. FRICTION-LOG E1.
 */
export const LABEL_PREFIX = 'sxf1-';

/**
 * How much of the fingerprint the label carries. 40 hex chars = 160 bits, which
 * makes the label 45 characters.
 *
 * 45 and not 69 because clients disagree above 63: viem's `packetToBytes`
 * accepts up to 255 bytes per label, ethers' `dnsEncode` throws above 63. A
 * 69-char label would resolve in one and fail in the other. FRICTION-LOG E2.
 *
 * The truncation is a naming convenience, never the identity — `surex:fingerprint`
 * carries all 64 hex characters so a caller matches exactly rather than by prefix.
 */
export const LABEL_HEX_LENGTH = 40;

/** `sxf1_<64 hex>` → `sxf1-<40 hex>`, or `null` if it is not a fingerprint. */
export function labelFor(fingerprint: string): string | null {
  if (!isFingerprint(fingerprint)) return null;
  return LABEL_PREFIX + fingerprint.slice('sxf1_'.length, 'sxf1_'.length + LABEL_HEX_LENGTH);
}

/**
 * `sxf1-<40 hex>` → the 40 hex characters, or `null`.
 *
 * The inverse of `labelFor` only as far as it can be: 24 hex characters were
 * dropped, so this returns a PREFIX to search with, never a fingerprint. Naming
 * it `fingerprintPrefixOf` rather than `fingerprintOf` is the point.
 */
export function fingerprintPrefixOf(label: string): string | null {
  const lower = String(label ?? '').toLowerCase();
  if (!lower.startsWith(LABEL_PREFIX)) return null;
  const hex = lower.slice(LABEL_PREFIX.length);
  if (hex.length !== LABEL_HEX_LENGTH || !/^[0-9a-f]+$/.test(hex)) return null;
  return hex;
}

/** True when this fingerprint starts with the prefix a label carried. */
export function fingerprintMatchesPrefix(fingerprint: string, prefix: string): boolean {
  if (!isFingerprint(fingerprint)) return false;
  return fingerprint.slice('sxf1_'.length).startsWith(prefix);
}

/**
 * The full ENS name for a fingerprint, or `null` when no parent is configured.
 *
 * `null` is load-bearing on the UI side: with no parent there is no name, and
 * `apps/api/src/links.mjs` already sets the rule — a dead link that looks alive
 * is worse than no link. The row is omitted rather than rendered grey.
 */
export function ensNameFor(fingerprint: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const parent = (env.NEXT_PUBLIC_SUREX_ENS_PARENT ?? env.SUREX_ENS_PARENT)?.trim();
  if (!parent) return null;
  const label = labelFor(fingerprint);
  if (!label) return null;
  return `${label}.${parent.replace(/^\.+|\.+$/g, '')}`;
}

/** Where a human goes to look at the name. Sepolia unless told otherwise. */
export function ensAppUrl(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const chain = (env.NEXT_PUBLIC_SUREX_ENS_CHAIN ?? env.SUREX_ENS_CHAIN)?.trim() || 'sepolia';
  const host = chain === 'mainnet' ? 'app.ens.domains' : `${chain}.app.ens.domains`;
  return `https://${host}/name/${encodeURIComponent(name)}`;
}

/* ─────────────────────────────────────────────────────── the DNS wire name ─*/

/**
 * Undo the DNS wire encoding ENSIP-10 passes `name` in: a length byte, that many
 * bytes of label, repeated, terminated by a zero byte.
 *
 * Only the leftmost label is wanted — it carries the fingerprint prefix. The
 * parent is whatever the resolver was set on, and the gateway does not get to
 * have an opinion about it.
 *
 * Lives here rather than in the route because it is pure, and because the route
 * imports `next/server`, which bare Node cannot resolve — anything left in there
 * is untestable by the suite this repo actually runs.
 */
export function leftmostLabel(dnsEncoded: string): string | null {
  const bytes = dnsEncoded.startsWith('0x') ? dnsEncoded.slice(2) : dnsEncoded;
  if (bytes.length < 2) return null;
  const length = Number.parseInt(bytes.slice(0, 2), 16);
  // 0xfe is the ENSIP-10 encoded-label form: the label is a 32-byte hash, not
  // text, so there is no prefix to read out of it. Our labels are 45 characters
  // and never take that path, and guessing would be worse than declining.
  if (!Number.isFinite(length) || length === 0 || length > 63) return null;
  const hex = bytes.slice(2, 2 + length * 2);
  if (hex.length !== length * 2) return null;
  return Buffer.from(hex, 'hex').toString('utf8');
}

/* ────────────────────────────────────────────────────────── text records ───*/

/**
 * The records a lookup answers with.
 *
 * Every value is a closed enum, a number, an ISO date, a hash, or a URL this
 * file builds. Nothing model-generated is ever emitted — no `topFinding`, no
 * `disputeSummary`. Two reasons, and the second is the real one:
 *
 *   1. A text record is read completely out of context, which is exactly where
 *      a banned word does the most damage (AGENTS.md §4 binds every surface).
 *      Model prose cannot be copy-checked ahead of time; an enum can.
 *   2. A finding is an accusation about a named project. It belongs on a page
 *      that carries the evidence, the date, the model, and the override — not
 *      in a 32-byte-keyed record a wallet renders on its own.
 *
 * `url` is the standard ENS key rather than a `surex:` one, so a client that
 * already knows how to render a name's website lands on the evidence page.
 */
export const RECORD_KEYS = Object.freeze([
  'surex:state',
  'surex:severity',
  'surex:tier',
  'surex:reason',
  'surex:reviewed',
  'surex:fingerprint',
  'url',
] as const);

export type RecordKey = (typeof RECORD_KEYS)[number];

/** The web app's public base, for the `url` record. */
export function webBase(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.NEXT_PUBLIC_SUREX_WEB?.trim();
  return (raw && raw.length ? raw : 'https://arkiv-surex.vercel.app').replace(/\/+$/, '');
}

/**
 * Build the record table for one head.
 *
 * Runs the copy law over every value before returning, and THROWS rather than
 * returning a violating set. The test in `test/ens.test.mjs` walks the whole
 * enum space, but the test is the guard, not the only defence: a head arrives
 * from a network call at runtime, and the one thing this must never do is put a
 * banned word inside something signed.
 */
export function recordsFor(head: VerdictHead, env: NodeJS.ProcessEnv = process.env): Record<RecordKey, string> {
  const records: Record<RecordKey, string> = {
    'surex:state': String(head.state ?? 'unknown'),
    'surex:severity': String(head.severity ?? 0),
    'surex:tier': String(head.tier ?? 'C'),
    'surex:reason': String(head.reason ?? ''),
    'surex:reviewed': String(head.reviewedAt ?? head.updatedAt ?? ''),
    'surex:fingerprint': String(head.fingerprint ?? ''),
    url: `${webBase(env)}/r/${encodeURIComponent(String(head.fingerprint ?? ''))}`,
  };

  for (const [key, value] of Object.entries(records)) {
    const violations = copyViolations(value);
    if (violations.length) {
      throw new Error(
        `Copy law violated in ENS record "${key}": "${violations[0].word}" → use ${violations[0].instead}`,
      );
    }
  }
  return records;
}

/** One record, or the empty string — never `undefined`, which ABI-encodes badly. */
export function recordValue(head: VerdictHead, key: string, env: NodeJS.ProcessEnv = process.env): string {
  const records = recordsFor(head, env);
  return (records as Record<string, string>)[key] ?? '';
}

/* ────────────────────────────────────────────────────────────── the digest ──*/

export interface DigestInput {
  /** The resolver's own address. Binds a signature to one resolver. */
  resolver: Address;
  /** Unix seconds. `uint64` in the Solidity, so it is a bigint here. */
  expires: bigint;
  /** The original `resolve(bytes,bytes)` calldata, verbatim. */
  callData: Hex;
  /** The ABI-encoded answer. */
  result: Hex;
}

/**
 * The exact hash `SureXOffchainResolver.makeSignatureHash()` computes.
 *
 * `0x1900` is EIP-191 version `0x00` — "data with intended validator", the
 * validator being the resolver address that follows it. This is the ENS
 * reference construction, unchanged, so any standard CCIP-Read client verifies
 * a response without knowing anything about SureX.
 *
 * ⚠️ Signed RAW. `privateKeyToAccount().sign({ hash })`, never `signMessage()` —
 * the latter would wrap this in a second EIP-191 personal-message prefix and
 * `ecrecover` would return a stranger's address.
 */
export function signatureDigest({ resolver, expires, callData, result }: DigestInput): Hex {
  return keccak256(
    encodePacked(
      ['bytes2', 'address', 'uint64', 'bytes32', 'bytes32'],
      ['0x1900', resolver, expires, keccak256(callData), keccak256(result)],
    ),
  );
}

/* ───────────────────────────────────────────────────────── the relying key ──*/

export interface EnsConfig {
  /** The resolver this gateway is allowed to answer for. */
  resolver: Address;
  /** `0x`-prefixed 32-byte private key. */
  signingKey: Hex;
  /** Seconds a signature stays good for. */
  ttlSeconds: number;
}

export type EnsConfigResult = { ok: true; config: EnsConfig } | { ok: false; missing: string[]; detail: string };

/** How long a signed answer stays good. Long enough to survive a slow client,
 *  short enough that a captured response is not a durable claim. */
export const DEFAULT_TTL_SECONDS = 300;

/**
 * Read the gateway's configuration, or say precisely what is missing.
 *
 * There is no fallback and no demo mode, for the same reason `worldConfig()` has
 * none: the failure mode of a signing route with a default is a signature over
 * something nobody chose. Missing configuration is a 503 that names the
 * variables, never a manufactured answer.
 */
export function ensConfig(env: NodeJS.ProcessEnv = process.env): EnsConfigResult {
  const resolver = env.SUREX_ENS_RESOLVER_ADDRESS?.trim() ?? '';
  const signingKey = env.SUREX_ENS_SIGNING_KEY?.trim() ?? '';

  const missing: string[] = [];
  if (!resolver) missing.push('SUREX_ENS_RESOLVER_ADDRESS');
  if (!signingKey) missing.push('SUREX_ENS_SIGNING_KEY');
  if (missing.length) {
    return {
      ok: false,
      missing,
      detail:
        `The ENS gateway is not configured in this deployment: ${missing.join(', ')} ` +
        `${missing.length === 1 ? 'is' : 'are'} unset. Both come from the resolver deployed on Sepolia — ` +
        'its address, and the private key whose address it pins as the signer. ' +
        'Until they are set, nothing here will sign anything.',
    };
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(resolver)) {
    return { ok: false, missing: ['SUREX_ENS_RESOLVER_ADDRESS'], detail: 'SUREX_ENS_RESOLVER_ADDRESS must be a 20-byte hex address.' };
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(signingKey)) {
    return { ok: false, missing: ['SUREX_ENS_SIGNING_KEY'], detail: 'SUREX_ENS_SIGNING_KEY must be a 0x-prefixed 32-byte hex private key.' };
  }

  const rawTtl = Number(env.SUREX_ENS_TTL_SECONDS ?? DEFAULT_TTL_SECONDS);
  const ttlSeconds = Number.isFinite(rawTtl) && rawTtl > 0 ? Math.trunc(rawTtl) : DEFAULT_TTL_SECONDS;

  return { ok: true, config: { resolver: resolver as Address, signingKey: signingKey as Hex, ttlSeconds } };
}
