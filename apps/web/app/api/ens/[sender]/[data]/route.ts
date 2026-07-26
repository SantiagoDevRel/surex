/**
 * `GET /api/ens/<sender>/<data>.json` — the ERC-3668 (CCIP-Read) gateway. The
 * resolver on Sepolia reverts with `OffchainLookup` pointing here; the client
 * fetches it and hands what comes back to `resolveWithProof`, which rejects
 * anything not signed by the key the resolver pins. So this route is the only
 * thing standing between the registry and a signature a contract will trust.
 *
 * The failure mode of a signing route is not an error, it's a believable lie,
 * so three cases refuse rather than sign: a `sender` that isn't our resolver
 * (400), the registry unreachable or truncated (500), or an illustrative/
 * ambiguous head (500). A label with no match is different from all three —
 * that's a real, honest `unknown`.
 */

import { NextResponse } from 'next/server';
import { ROUTES, parseVerdictHead } from '@surex/core';
import {
  decodeFunctionData,
  encodeAbiParameters,
  parseAbi,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { apiBase } from '@/lib/api.ts';
import {
  ensConfig,
  fingerprintMatchesPrefix,
  fingerprintPrefixOf,
  leftmostLabel,
  recordValue,
  signatureDigest,
} from '@/lib/ens.ts';
import type { VerdictHead } from '@/lib/types.ts';

export const dynamic = 'force-dynamic';

const RESOLVE_ABI = parseAbi(['function resolve(bytes name, bytes data) view returns (bytes)']);
const TEXT_ABI = parseAbi(['function text(bytes32 node, string key) view returns (string)']);
const ADDR_ABI = parseAbi(['function addr(bytes32 node) view returns (address)']);

/** `text(bytes32,string)` and `addr(bytes32)`. Anything else answers empty. */
const TEXT_SELECTOR = '0x59d1d43c';
const ADDR_SELECTOR = '0x3b3b57de';

/* ───────────────────────────────────────────────────────────── the registry */

interface RegistryListing {
  heads: VerdictHead[];
  truncated: boolean;
}

// `truncated` is carried rather than dropped — on a truncated listing, "no
// match" is not something this route can know.
const CACHE_MS = 60_000;
let cache: { at: number; listing: RegistryListing } | null = null;

async function registryListing(): Promise<RegistryListing | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.listing;

  let body: unknown;
  try {
    const res = await fetch(`${apiBase()}${ROUTES.registry({ limit: 500 })}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    body = await res.json();
  } catch {
    return null;
  }

  const raw = body as { heads?: unknown[]; truncated?: boolean } | null;
  if (!raw || !Array.isArray(raw.heads)) return null;

  const heads = raw.heads
    .map((h) => parseVerdictHead(h) as VerdictHead | null)
    .filter((h): h is VerdictHead => h !== null);

  const listing: RegistryListing = { heads, truncated: raw.truncated === true };
  cache = { at: Date.now(), listing };
  return listing;
}

type Lookup =
  | { kind: 'head'; head: VerdictHead }
  | { kind: 'unknown'; label: string }
  | { kind: 'refuse'; error: string; detail: string };

/** Label → head, or an honest refusal. Never a guess. */
async function lookup(label: string): Promise<Lookup> {
  const prefix = fingerprintPrefixOf(label);
  if (!prefix) {
    // Not one of our labels at all. A real answer: this name has no entry.
    return { kind: 'unknown', label };
  }

  const listing = await registryListing();
  if (!listing) {
    return {
      kind: 'refuse',
      error: 'registry_unreachable',
      detail: 'The registry could not be read, so there is nothing to sign. This is not an answer of "unknown".',
    };
  }

  const matches = listing.heads.filter((h) => fingerprintMatchesPrefix(h.fingerprint, prefix));

  if (matches.length > 1) {
    return {
      kind: 'refuse',
      error: 'ambiguous_label',
      detail: `${matches.length} entries share the prefix ${prefix}. Refusing to pick one.`,
    };
  }

  if (matches.length === 0) {
    if (listing.truncated) {
      return {
        kind: 'refuse',
        error: 'registry_truncated',
        detail: 'The registry listing was truncated, so "no entry" is not knowable from it.',
      };
    }
    // Reachable, complete, and nobody has submitted this install configuration.
    // That is a fact about the registry, and it is what `unknown` means.
    return { kind: 'unknown', label };
  }

  const head = matches[0];
  if (head.illustrative === true) {
    return {
      kind: 'refuse',
      error: 'illustrative_entry',
      detail: 'That entry is demo data. It is shown on the site behind a banner and it will not be signed.',
    };
  }
  return { kind: 'head', head };
}

/* ─────────────────────────────────────────────────────────────── the route */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sender: string; data: string }> },
): Promise<Response> {
  const cfg = ensConfig();
  if (!cfg.ok) {
    // A configuration error, said plainly. Not a signature.
    return NextResponse.json(
      { error: 'ens_gateway_not_configured', detail: cfg.detail, missing: cfg.missing },
      { status: 503 },
    );
  }

  const { sender, data: rawData } = await params;

  // ERC-3668 clients' template ends `.json`, so the segment arrives with the suffix attached.
  const callData = rawData.replace(/\.json$/i, '') as Hex;

  if (sender.toLowerCase() !== cfg.config.resolver.toLowerCase()) {
    // 4xx on purpose: ERC-3668 says a client must not retry another URL on a 4xx,
    // and there is nothing to retry — this key answers for one resolver.
    return NextResponse.json(
      {
        error: 'unknown_sender',
        detail: `This gateway signs for ${cfg.config.resolver} only. It was asked to sign for ${sender}.`,
      },
      { status: 400 },
    );
  }

  let name: Hex;
  let inner: Hex;
  try {
    const decoded = decodeFunctionData({ abi: RESOLVE_ABI, data: callData });
    [name, inner] = decoded.args as [Hex, Hex];
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_calldata', detail: `not a resolve(bytes,bytes) call: ${err instanceof Error ? err.message : 'unknown'}` },
      { status: 400 },
    );
  }

  const label = leftmostLabel(name);
  if (!label) {
    return NextResponse.json({ error: 'invalid_name', detail: 'the DNS-encoded name had no readable leftmost label' }, { status: 400 });
  }

  const selector = inner.slice(0, 10).toLowerCase();

  // Anything we don't answer resolves to empty, not an error — an unsupported
  // record type just has nothing under that key.
  let result: Hex = '0x';

  if (selector === TEXT_SELECTOR) {
    const { args } = decodeFunctionData({ abi: TEXT_ABI, data: inner });
    const key = args[1] as string;

    const found = await lookup(label);
    if (found.kind === 'refuse') {
      return NextResponse.json({ error: found.error, detail: found.detail }, { status: 500 });
    }
    let value: string;
    try {
      value = found.kind === 'head' ? recordValue(found.head, key) : unknownRecordValue(key);
    } catch (err) {
      // `recordsFor` throws on a copy-law violation. Better a 500 than a banned
      // word inside something signed.
      return NextResponse.json(
        { error: 'copy_law', detail: err instanceof Error ? err.message : 'record refused' },
        { status: 500 },
      );
    }
    result = encodeAbiParameters([{ type: 'string' }], [value]);
  } else if (selector === ADDR_SELECTOR) {
    // A registry entry is not an account. Answering the zero address is how ENS
    // says "no address here"; reverting would look like a resolution failure.
    decodeFunctionData({ abi: ADDR_ABI, data: inner });
    result = encodeAbiParameters([{ type: 'address' }], ['0x0000000000000000000000000000000000000000']);
  }

  const expires = BigInt(Math.floor(Date.now() / 1000) + cfg.config.ttlSeconds);
  const digest = signatureDigest({ resolver: cfg.config.resolver, expires, callData, result });

  // Raw hash, never `signMessage` — that would add a second EIP-191 prefix and
  // the resolver's `ecrecover` would return an address nobody holds.
  const signature = await privateKeyToAccount(cfg.config.signingKey).sign({ hash: digest });

  const response = encodeAbiParameters(
    [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes' }],
    [result, expires, signature],
  );

  return NextResponse.json(
    { data: response },
    { headers: { 'cache-control': `public, max-age=${Math.max(1, Math.floor(cfg.config.ttlSeconds / 2))}` } },
  );
}

/** The records for a name with no entry. `unknown` is the honest answer to
 *  "nobody has submitted this". */
function unknownRecordValue(key: string): string {
  switch (key) {
    case 'surex:state':
      return 'unknown';
    case 'surex:severity':
      return '0';
    case 'surex:tier':
      return 'C';
    default:
      return '';
  }
}
