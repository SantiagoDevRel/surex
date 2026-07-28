/**
 * ENS, server side only, and not by accident: `SUREX_ENS_SIGNING_KEY` signs
 * verdicts a contract believes, so leaking it lets someone else sign in
 * SureX's name. Never import this from a client component; the key must never
 * become `NEXT_PUBLIC_*`.
 *
 * This file holds everything pure (label encoding, text-record table, digest);
 * the route next door does IO and signing.
 *
 * ⚠️ `signatureDigest()` is duplicated in `makeSignatureHash()`
 * (`contracts/src/SureXOffchainResolver.sol`) — if the two disagree every lookup
 * fails `resolveWithProof` silently. Pinned in both test suites so drift breaks a test.
 */

import { copyViolations, isFingerprint } from '@surex/core';
import { encodePacked, keccak256, type Address, type Hex } from 'viem';

import type { VerdictHead } from './types.ts';

/** Deliberately not `sxf1_`: ENSIP-15 rejects a mid-label underscore. */
export const LABEL_PREFIX = 'sxf1-';

/**
 * 40 hex chars (160 bits) → a 45-char label, not 69: clients disagree above the
 * 63-byte ENS label limit (viem accepts up to 255, ethers' `dnsEncode` throws).
 * The truncation is a naming convenience, not the identity — `surex:fingerprint`
 * carries all 64 hex characters for exact matching.
 */
export const LABEL_HEX_LENGTH = 40;

/** `sxf1_<64 hex>` → `sxf1-<40 hex>`, or `null` if it is not a fingerprint. */
export function labelFor(fingerprint: string): string | null {
  if (!isFingerprint(fingerprint)) return null;
  return LABEL_PREFIX + fingerprint.slice('sxf1_'.length, 'sxf1_'.length + LABEL_HEX_LENGTH);
}

/** `sxf1-<40 hex>` → the 40 hex characters, or `null`. Returns a prefix to search with, never a full fingerprint — 24 hex characters were dropped. */
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

/** The full ENS name for a fingerprint, or `null` when no parent is configured — the row is then omitted rather than rendered as a dead link. */
export function ensNameFor(fingerprint: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const parent = (env.NEXT_PUBLIC_SUREX_ENS_PARENT ?? env.SUREX_ENS_PARENT)?.trim();
  if (!parent) return null;
  const label = labelFor(fingerprint);
  if (!label) return null;
  return `${label}.${parent.replace(/^\.+|\.+$/g, '')}`;
}

/** Where a human goes to look at the name. Mainnet unless told otherwise. */
export function ensAppUrl(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const chain = (env.NEXT_PUBLIC_SUREX_ENS_CHAIN ?? env.SUREX_ENS_CHAIN)?.trim() || 'mainnet';
  const host = chain === 'mainnet' ? 'app.ens.domains' : `${chain}.app.ens.domains`;
  return `https://${host}/name/${encodeURIComponent(name)}`;
}

/* ─────────────────────────────────────────────────────── the DNS wire name ─*/

/**
 * Undo the DNS wire encoding ENSIP-10 passes `name` in (a length byte, that many
 * bytes of label, repeated). Only the leftmost label is wanted — it carries the
 * fingerprint prefix.
 */
export function leftmostLabel(dnsEncoded: string): string | null {
  const bytes = dnsEncoded.startsWith('0x') ? dnsEncoded.slice(2) : dnsEncoded;
  if (bytes.length < 2) return null;
  const length = Number.parseInt(bytes.slice(0, 2), 16);
  // length > 63 rejects the ENSIP-10 encoded-label form (0xfe): a 32-byte hash,
  // not text. SureX labels never take that path.
  if (!Number.isFinite(length) || length === 0 || length > 63) return null;
  const hex = bytes.slice(2, 2 + length * 2);
  if (hex.length !== length * 2) return null;
  return Buffer.from(hex, 'hex').toString('utf8');
}

/* ────────────────────────────────────────────────────────── text records ───*/

/**
 * The records a lookup answers with. Every value is a closed enum, a number, an
 * ISO date, a hash, or a URL — never model-generated prose: a text record is
 * read out of context (AGENTS.md §4), and a finding belongs on the evidence
 * page, not a 32-byte-keyed record a wallet renders on its own.
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
 * Build the record table for one head. Runs the copy law over every value and
 * throws on a violation, rather than signing a banned word — the test suite is
 * the guard, not the only defence, since a head arrives from a network call at
 * runtime.
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
 * The exact hash `SureXOffchainResolver.makeSignatureHash()` computes. `0x1900`
 * is EIP-191 "data with intended validator" — the standard ENS CCIP-Read
 * construction, unchanged.
 *
 * ⚠️ Sign this raw with `privateKeyToAccount().sign({ hash })`, never
 * `signMessage()` — the latter adds a second EIP-191 prefix and `ecrecover`
 * returns a stranger's address.
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
 * Read the gateway's configuration, or say precisely what is missing. No
 * fallback, no demo mode (same reason as `worldConfig()`) — missing config is a
 * 503 that names the variables, never a manufactured answer.
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
        `${missing.length === 1 ? 'is' : 'are'} unset. Both come from the resolver deployed on mainnet — ` +
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
