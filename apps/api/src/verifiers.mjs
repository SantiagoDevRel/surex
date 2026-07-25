// The identity seam. This is where World checks who is asking, BEFORE the route
// grants anything.
//
//   interface Verifiers {
//     name: string                      // shows up in every response, so a stub is visible
//     isStub: boolean
//     verifyHumanProof({ proof, action, signal, body, headers })
//        → { ok, nullifier?, reason?, detail? }
//     verifyAgentStanding({ agentAddress, headers, body })
//        → { ok, humanId|null, reason?, detail? }
//   }
//
// Three implementations live here and `resolveVerifiers()` picks one:
//
//   stub          — the default. Refuses everything, loudly.
//   illustrative  — mock mode only, opt-in twice, marks everything it returns.
//   world         — the real one. `SUREX_WORLD=1`.
//
// The route, the state machine and the 403 path are owned by the API and are not
// changed here. What IS new is a refusal→status mapping (`REFUSAL_STATUS`), because
// the real verifier can fail for reasons that are NOT "no human stands behind this
// agent" and saying so would be a lie:
//
//   our RPC was rate-limited      → 503 upstream_unavailable
//   the request carried no proof  → 401 unauthenticated
//   lookupHuman really returned 0 → 403 agent_not_human_backed   ← the gate
//
// ═══════════════════════════════════════════════════════════════════════════════
// 🐛 WHY THIS FILE DOES NOT TRUST `lookupHuman`'s NULL  (verified live 2026-07-25)
//
// `@worldcoin/agentkit-core@0.2.0`'s AgentBook verifier ends with:
//
//     try { …readContract… } catch { return null }
//
// So a dead RPC, a rate limit, a wrong contract address and a mis-checksummed
// address ALL return exactly what an unregistered agent returns. Measured, both
// cases, against live World Chain 480:
//
//     lookupHuman(0xea7d…4171)                     → 0x2493947…f427ff4   (registered)
//     lookupHuman(0xea7d…4171) with rpcUrl=:9      → null                (RPC down!)
//     lookupHuman('0xea7d8b94f6E80…')  bad casing  → null                (checksum!)
//
// Telling an honest human-backed agent it is not human-backed because our RPC was
// throttled is the worst failure this route has, so a null answer is never taken at
// face value: it is re-read through our own viem client, where a transport error is
// an exception and can be reported as what it is. FRICTION-LOG W7.
// ═══════════════════════════════════════════════════════════════════════════════

import { AGENTKIT, createAgentBookVerifier, declareAgentkitExtension, formatSIWEMessage, parseAgentkitHeader, validateAgentkitMessage, verifyAgentkitSignature } from '@worldcoin/agentkit';
import { createPublicClient, getAddress, http, keccak256, numberToHex, pad, recoverMessageAddress, toHex } from 'viem';
import { worldchain } from 'viem/chains';
import { createHash, randomBytes } from 'node:crypto';

/* ───────────────────────────────────────────────────────── verified constants ─*/

/**
 * The request header an AgentKit client actually sends: `agentkit`, holding a
 * base64 JSON payload. NOT `x-payment` — that is x402's *payment* header, and the
 * base64 `payment-required` header is the challenge travelling the other way.
 * Read out of `@worldcoin/agentkit@0.2.0`, where the client does
 * `headers.set(AGENTKIT, header)` and the server hook does `getHeader(AGENTKIT)`.
 */
export const AGENTKIT_HEADER = AGENTKIT;

/** AgentBook, World Chain 480. Read live: groupId 1, router 0x17B354dD…39A278 (mainnet). */
export const AGENT_BOOK_ADDRESS = '0xA23aB2712eA7BBa896930544C7d6636a96b944dA';

/**
 * Networks AgentBook is actually deployed on, checked by `eth_getCode` on 2026-07-25.
 * The widespread "World Chain mainnet only" claim is false — but see the README and
 * FRICTION-LOG W4/W8 before reaching for Base Sepolia: it exists, it is initialised
 * against the World ID **testnet** router with groupId 1, and it has never had a
 * single registration.
 */
export const AGENT_BOOK_NETWORKS = Object.freeze({
  'worldchain-480': {
    chainId: 480,
    caip2: 'eip155:480',
    address: AGENT_BOOK_ADDRESS,
    // The official public World Chain endpoint. Passed EXPLICITLY (never left to
    // viem's chain default) so the value is visible, overridable and greppable —
    // W5. Override with SUREX_WORLD_RPC_URL for anything load-bearing.
    defaultRpcUrl: 'https://worldchain-mainnet.g.alchemy.com/public',
    canonical: true,
  },
  'base-sepolia-84532': {
    chainId: 84532,
    caip2: 'eip155:84532',
    address: AGENT_BOOK_ADDRESS,
    defaultRpcUrl: 'https://sepolia.base.org',
    canonical: false,
  },
});

export const DEFAULT_AGENT_BOOK_NETWORK = 'worldchain-480';

/** Minimal ABI. Same shape the SDK uses; we call it ourselves so errors surface. */
const AGENT_BOOK_ABI = [
  {
    inputs: [{ internalType: 'address', name: '', type: 'address' }],
    name: 'lookupHuman',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
];

/** The two World ID actions, per tech spec §7.1. Never reuse one for the other. */
export const WORLD_ACTIONS = Object.freeze({
  submit: 'maintainer-submit',
  dispute: 'contest-verdict',
});

/** `POST /api/v4/verify/{rp_id}` — rp_id preferred, app_id still accepted. */
export const WORLD_VERIFY_BASE = 'https://developer.world.org/api/v4/verify';

/**
 * The default `signal_hash` per protocol version, so "no signal was bound" is
 * distinguishable from "a signal was bound".
 *   3.0 → hashToField('')   4.0 → 0x0
 */
const EMPTY_SIGNAL_HASH_V3 = '0x00c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a4';
const EMPTY_SIGNAL_HASH_V4 = '0x0';

/**
 * Which HTTP status each refusal reason deserves. The route applies this; the
 * knowledge of what a reason MEANS lives with the verifier that produces it.
 *
 * Anything not listed falls through to the route's default for that path (403 for
 * an agent, 401 for a human), which is what keeps the stub's `verifier_not_wired`
 * on the 403 path it has always been on.
 */
export const REFUSAL_STATUS = Object.freeze({
  // our fault, and we say so rather than blaming the agent or the network
  world_id_not_configured: 'internal',
  world_id_misconfigured: 'internal',
  // upstream's fault. NEVER agent_not_human_backed.
  upstream_unavailable: 'upstream',
  // the caller did not present a usable proof — that is not the same claim as
  // "no human stands behind you", so it must not borrow that message
  agentkit_header_missing: 'unauthenticated',
  agentkit_header_malformed: 'unauthenticated',
  agentkit_message_invalid: 'unauthenticated',
  agentkit_signature_invalid: 'unauthenticated',
  agentkit_address_mismatch: 'unauthenticated',
  agentkit_body_mismatch: 'unauthenticated',
  agentkit_nonce_replayed: 'unauthenticated',
  agentkit_chain_unsupported: 'unauthenticated',
});

/* ─────────────────────────────────────────────────────────────────── hashing ─*/

/**
 * World's `hashToField`: keccak256 of the bytes, shifted right 8 bits, left-padded
 * to 32 bytes. Implemented here rather than imported because `hashSignal` ships in
 * `@worldcoin/idkit-core`, a browser SDK this read-only API has no reason to carry.
 *
 * NOT guessed — cross-checked against `hashSignal()` from the real SDK on four
 * vectors, including the documented empty-signal default. The test pins all four.
 */
export function hashToField(signal) {
  const bytes = typeof signal === 'string' && /^0x[0-9a-fA-F]*$/.test(signal) ? signal : toHex(String(signal ?? ''));
  return pad(numberToHex(BigInt(keccak256(bytes)) >> 8n), { size: 32 });
}

const sha256Hex = (value) => createHash('sha256').update(String(value)).digest('hex');

/**
 * The `signal` for each flow, per tech spec §7.1. The signal is what binds a proof
 * to ONE dispute or ONE repository: without it, a proof for "I contest something"
 * is replayable against every other verdict in the registry.
 *
 * ⚠️ The web app derives the same two strings in `apps/web/lib/world.ts`. They are
 * pinned by a fixed vector in BOTH test suites, so a change on one side fails on
 * the other instead of silently producing proofs this server rejects.
 */
export function disputeSignal({ verdictKey, evidenceHash }) {
  return sha256Hex(`${verdictKey ?? ''}|${evidenceHash ?? ''}`);
}
export function submitSignal({ repoUrl }) {
  return sha256Hex(normaliseRepo(repoUrl));
}
/** Lowercased, scheme- and trailing-slash- and `.git`-insensitive. */
export function normaliseRepo(repoUrl) {
  return String(repoUrl ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
}
/** The evidence a dispute stands on, hashed so the signal is fixed-length. */
export function evidenceHashOf(body) {
  return sha256Hex(String(body?.evidence ?? body?.statement ?? ''));
}

/* ─────────────────────────────────────────────────────────── nullifier store ─*/

/**
 * Uniqueness, per tech spec §7.1 — and NOTHING ELSE ABOUT THE PERSON (NFR-4).
 *
 * What is stored per row: the nullifier as a DECIMAL STRING, the action, and the
 * timestamps at which it was seen. No proof, no merkle root, no IP, no user agent.
 * Decimal because the documented bug class here is hex parsing: `0x0A` and `0x0a`
 * and `0xa` are one person and three different strings.
 *
 * ⚠️ In-memory, so it is per-process and resets on restart. That is honest for a
 * read-path API with no database — a durable `NUMERIC(78,0) UNIQUE(nullifier,
 * action)` table belongs with the worker, which is the process that can write.
 * Said out loud in the accepted response rather than implied.
 */
export function createNullifierStore({ now = () => Date.now() } = {}) {
  const rows = new Map(); // `${action}:${decimal}` → number[] (timestamps)
  return {
    kind: 'in-memory',
    /**
     * @returns {{ok:true, seen:number}|{ok:false, reason:string, detail:string}}
     */
    check(nullifierDecimal, action, { max = 1, windowMs = null } = {}) {
      const key = `${action}:${nullifierDecimal}`;
      const seen = rows.get(key) ?? [];
      const live = windowMs === null ? seen : seen.filter((t) => now() - t < windowMs);
      if (live.length >= max) {
        return {
          ok: false,
          reason: 'nullifier_already_used',
          detail:
            windowMs === null
              ? `this World ID has already completed the "${action}" action once, and it is one per person`
              : `this World ID has used all ${max} "${action}" slots in the current ${Math.round(windowMs / 3600000)}h window`,
        };
      }
      return { ok: true, seen: live.length };
    },
    record(nullifierDecimal, action) {
      const key = `${action}:${nullifierDecimal}`;
      const seen = rows.get(key) ?? [];
      seen.push(now());
      rows.set(key, seen);
    },
    get size() {
      return rows.size;
    },
  };
}

/** `0x…` → decimal string. The only representation that goes into storage. */
export function nullifierToDecimal(hex) {
  const raw = String(hex ?? '').trim();
  if (!/^0x[0-9a-fA-F]+$/.test(raw)) throw new Error(`nullifier is not 0x-hex: ${raw.slice(0, 24)}`);
  return BigInt(raw).toString(10);
}

/* ────────────────────────────────────────────────────────────────── the stub ─*/

export const STUB_DETAIL =
  'STUB VERIFIER — no identity check ran. This build of the API has no World integration wired in, so it ' +
  'refuses every dispute by design rather than accepting one it cannot check. Pass a real Verifiers ' +
  'implementation into createApp({ verifiers }) to enable disputes.';

/**
 * The default. Refuses everything, loudly, and says which of the two paths it
 * refused. Accepting a dispute we could not check would be the exact failure the
 * 403 exists to prevent, so the stub fails closed and never silently passes.
 */
export function createStubVerifiers({ logger = console } = {}) {
  let warned = false;
  const warnOnce = () => {
    if (warned) return;
    warned = true;
    logger.warn?.(`[surex-api] ${STUB_DETAIL}`);
  };

  return {
    name: 'stub',
    isStub: true,
    async verifyHumanProof() {
      warnOnce();
      return { ok: false, reason: 'verifier_not_wired', detail: STUB_DETAIL, stub: true };
    },
    async verifyAgentStanding() {
      warnOnce();
      // humanId null is precisely what lookupHuman returns for an agent no human
      // stands behind, so the route's 403 path is exercised for real by the stub.
      return { ok: false, humanId: null, reason: 'verifier_not_wired', detail: STUB_DETAIL, stub: true };
    },
  };
}

/**
 * Mock-mode only, opt-in with SUREX_MOCK_ACCEPT_DISPUTES=1.
 *
 * It exists so the web lane can build and demo the accept path standalone before
 * World is wired. It grants standing to nobody real: every result it returns is
 * marked illustrative, and it refuses outright unless mock mode is on.
 */
export function createIllustrativeVerifiers({ logger = console } = {}) {
  logger.warn?.(
    '[surex-api] ILLUSTRATIVE VERIFIERS ACTIVE (SUREX_MOCK=1 + SUREX_MOCK_ACCEPT_DISPUTES=1). ' +
      'No World ID proof and no AgentBook lookup happen. Every response is marked illustrative:true. ' +
      'Never enable this outside mock mode.',
  );
  return {
    name: 'illustrative',
    isStub: true,
    illustrative: true,
    async verifyHumanProof({ proof } = {}) {
      if (!proof) return { ok: false, reason: 'invalid_body', detail: 'no proof in the request body', illustrative: true };
      return { ok: true, nullifier: 'DEMO_nullifier_not_a_real_person', illustrative: true, stub: true };
    },
    async verifyAgentStanding({ agentAddress } = {}) {
      if (!agentAddress) {
        return { ok: false, humanId: null, reason: 'invalid_body', detail: 'no agentAddress in the request body', illustrative: true };
      }
      // Deliberate: an address ending in 0 is refused, so the 403 path stays
      // demonstrable in mock mode too. Not a rule — a fixture.
      if (/0$/.test(agentAddress)) {
        return {
          ok: false,
          humanId: null,
          reason: 'no_standing',
          detail: 'illustrative refusal — no human stands behind this agent',
          illustrative: true,
        };
      }
      return { ok: true, humanId: 'DEMO_humanId_not_a_real_person', illustrative: true, stub: true };
    },
  };
}

/* ─────────────────────────────────────────────────────────── the real thing ─*/

/**
 * World ID (humans) + AgentBook (agents).
 *
 * Two halves with INDEPENDENT configuration, because they have independent
 * dependencies and pretending otherwise would take one down with the other:
 *
 *   agent half  — needs an RPC and nothing else. Works today. Reading AgentBook
 *                 requires no Orb; only REGISTERING an agent does.
 *   human half  — needs a Developer Portal relying party (`WORLD_RP_ID`). With
 *                 none configured it fails with a configuration error, never a pass.
 */
export function createWorldVerifiers({ env = process.env, logger = console, fetchImpl, nullifiers } = {}) {
  const doFetch = fetchImpl ?? globalThis.fetch;

  /* ── network selection ─────────────────────────────────────────────────── */
  const networkKey = env.SUREX_AGENTBOOK_NETWORK || DEFAULT_AGENT_BOOK_NETWORK;
  const network = AGENT_BOOK_NETWORKS[networkKey];
  if (!network) {
    throw new Error(
      `SUREX_AGENTBOOK_NETWORK="${networkKey}" is not a network AgentBook is deployed on. ` +
        `Known: ${Object.keys(AGENT_BOOK_NETWORKS).join(', ')}`,
    );
  }
  const contractAddress = getAddress(env.SUREX_AGENTBOOK_ADDRESS || network.address);
  const rpcUrl = env.SUREX_WORLD_RPC_URL || network.defaultRpcUrl;
  if (!env.SUREX_WORLD_RPC_URL) {
    logger.warn?.(
      `[surex-api] no SUREX_WORLD_RPC_URL — using the public endpoint ${rpcUrl}. It is passed explicitly, ` +
        'not left to a library default, but it is shared and rate-limited. Set your own before a demo: a ' +
        'throttled read is reported as upstream_unavailable, which is honest but still a failed dispute.',
    );
  }
  if (!network.canonical) {
    logger.warn?.(
      `[surex-api] AgentBook network is ${networkKey}, NOT the canonical World Chain 480 deployment. ` +
        'Registrations made on World Chain will not resolve here, and vice versa.',
    );
  }

  // The SDK verifier, called exactly as documented…
  const agentBook = createAgentBookVerifier({ rpcUrl, contractAddress });
  // …and our own client, which is what a null answer gets re-checked against.
  const client = createPublicClient({
    chain: network.chainId === worldchain.id ? worldchain : { id: network.chainId, name: networkKey, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } },
    transport: http(rpcUrl),
  });

  /* ── replay protection for agentkit headers ────────────────────────────── */
  const usedNonces = new Map(); // nonce → firstSeenMs
  const NONCE_TTL_MS = 10 * 60 * 1000; // > the SDK's 5-minute freshness window
  const nonceSeen = (nonce) => {
    const now = Date.now();
    for (const [k, t] of usedNonces) if (now - t > NONCE_TTL_MS) usedNonces.delete(k);
    return usedNonces.has(nonce);
  };

  const store = nullifiers ?? createNullifierStore();

  /* ── the challenge an agent signs ──────────────────────────────────────── */
  const resourceUri = (headers = {}) =>
    env.SUREX_RESOURCE_URI ||
    (headers.host ? `${env.SUREX_RESOURCE_SCHEME || 'http'}://${headers.host}` : 'http://localhost:4310');

  /**
   * The AgentKit challenge, in the exact `extensions.agentkit` shape the SDK's
   * client expects — so `createHeader(challenge)` consumes it unmodified.
   *
   * Served in the body of the refusal rather than through `@x402/hono`, because
   * this is IDENTITY, not payment: nothing here is priced, nothing is charged, and
   * an x402 payment flow is explicitly deferred (AGENTS.md §5). The one thing we
   * borrow from x402 is the extension envelope.
   */
  function challenge({ headers = {}, path = '/v1/disputes' } = {}) {
    const uri = `${resourceUri(headers).replace(/\/+$/, '')}${path}`;
    const declared = declareAgentkitExtension({
      resourceUri: uri,
      network: (env.SUREX_AGENTKIT_NETWORKS || network.caip2).split(',').map((s) => s.trim()),
      statement:
        'Contest a SureX verdict. Signing proves a human registered this agent in AgentBook; it grants standing to be heard, not agreement.',
      version: '1',
    })[AGENTKIT];
    return {
      [AGENTKIT]: {
        ...declared,
        info: {
          ...declared.info,
          domain: new URL(uri).hostname,
          nonce: randomBytes(16).toString('hex'),
          issuedAt: new Date().toISOString(),
          expirationTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        },
      },
    };
  }

  /* ── AGENT: does a human stand behind this wallet? ─────────────────────── */

  /**
   * Resolve a wallet to an anonymous human id, and NEVER confuse "no" with
   * "could not ask".
   */
  async function lookupHumanStrict(address) {
    const humanId = await agentBook.lookupHuman(address);
    if (humanId) return { ok: true, humanId };

    // Null. Could be a genuinely unregistered agent, or the SDK's swallowed
    // exception. Ask again ourselves, where a transport failure is a failure.
    let raw;
    try {
      raw = await client.readContract({
        address: contractAddress,
        abi: AGENT_BOOK_ABI,
        functionName: 'lookupHuman',
        args: [address],
      });
    } catch (err) {
      return {
        ok: false,
        reason: 'upstream_unavailable',
        detail:
          `AgentBook on ${networkKey} could not be read, so whether a human stands behind this agent is ` +
          `UNKNOWN — it is not a "no". Retry. (${String(err?.shortMessage ?? err?.message ?? err).slice(0, 160)})`,
      };
    }
    if (raw === 0n) {
      return {
        ok: false,
        reason: 'no_standing',
        detail: `AgentBook on ${networkKey} has no registration for ${address} (lookupHuman returned 0).`,
      };
    }
    // The SDK said null and the chain says otherwise: the SDK swallowed something.
    logger.warn?.(
      `[surex-api] lookupHuman() returned null for ${address} but the contract returned ${raw}. ` +
        'That is the swallowed-exception path in @worldcoin/agentkit-core@0.2.0 — FRICTION-LOG W7.',
    );
    return { ok: true, humanId: toHex(raw), sdkDisagreed: true };
  }

  async function verifyAgentStanding({ agentAddress = null, headers = {}, body = {}, path = '/v1/disputes' } = {}) {
    const refuse = (reason, detail, extra = {}) => ({ ok: false, humanId: null, reason, detail, verifier: 'agentbook', ...extra });

    const header = headers[AGENTKIT] ?? headers[AGENTKIT.toLowerCase()] ?? null;
    if (!header) {
      // A body field is a CLAIM, not a proof. Anyone can type someone else's
      // registered address; only a signature proves control of the wallet.
      return refuse(
        'agentkit_header_missing',
        `no "${AGENTKIT}" request header. An agent proves control of its wallet by signing the request; an ` +
          'agentAddress in the JSON body is an unproven claim and is never accepted on its own. Sign the ' +
          'challenge below and retry.',
        { challenge: challenge({ headers, path }) },
      );
    }

    let payload;
    try {
      payload = parseAgentkitHeader(header);
    } catch (err) {
      return refuse('agentkit_header_malformed', String(err?.message ?? err).slice(0, 240));
    }

    const uri = `${resourceUri(headers).replace(/\/+$/, '')}${path}`;
    const validation = await validateAgentkitMessage(payload, uri, {
      checkNonce: async (nonce) => !nonceSeen(nonce),
    });
    if (!validation.valid) {
      const replay = /nonce/i.test(validation.error ?? '');
      return refuse(
        replay ? 'agentkit_nonce_replayed' : 'agentkit_message_invalid',
        `${validation.error} (this server expects domain/uri "${uri}"; set SUREX_RESOURCE_URI if it sits behind a proxy)`,
      );
    }

    // Signature → address. For an EOA (eip191) this is pure local recovery: no RPC,
    // so no network condition can turn a good signature into a rejected agent. The
    // SDK's own path routes eip191 through `publicClient.verifyMessage`, which needs
    // a working RPC and returns `{valid:false}` when it does not have one.
    let address;
    if (payload.type === 'eip191') {
      let message;
      try {
        message = formatSIWEMessage(
          {
            domain: payload.domain,
            uri: payload.uri,
            statement: payload.statement,
            version: payload.version,
            chainId: payload.chainId,
            nonce: payload.nonce,
            issuedAt: payload.issuedAt,
            expirationTime: payload.expirationTime,
            notBefore: payload.notBefore,
            requestId: payload.requestId,
            resources: payload.resources,
            type: payload.type,
          },
          payload.address,
        );
      } catch (err) {
        // Two different failures land here: a chainId namespace the SDK does not
        // know, and a payload whose own `address` is not a valid checksummed
        // address (siwe refuses to build the message). They are not the same fact.
        const message = String(err?.message ?? err);
        return refuse(
          /chainid/i.test(message) ? 'agentkit_chain_unsupported' : 'agentkit_signature_invalid',
          message.slice(0, 200),
        );
      }
      let recovered;
      try {
        recovered = await recoverMessageAddress({ message, signature: payload.signature });
      } catch (err) {
        return refuse('agentkit_signature_invalid', `signature did not recover: ${String(err?.message ?? err).slice(0, 160)}`);
      }
      if (recovered.toLowerCase() !== String(payload.address).toLowerCase()) {
        return refuse(
          'agentkit_signature_invalid',
          `the signature recovers to ${recovered}, but the payload claims ${payload.address}`,
        );
      }
      address = recovered;
    } else {
      const verified = await verifyAgentkitSignature(payload, rpcUrl);
      if (!verified.valid || !verified.address) {
        return refuse(
          'agentkit_signature_invalid',
          `${verified.error ?? 'signature verification failed'} — note that for ${payload.type} this check needs a ` +
            'working RPC, so a transport failure and a bad signature are not distinguishable here',
        );
      }
      address = verified.address;
    }

    // A claimed address in the body must agree with the signed one, or the body is
    // lying about who is asking.
    if (agentAddress && String(agentAddress).toLowerCase() !== address.toLowerCase()) {
      return refuse(
        'agentkit_address_mismatch',
        `the body names ${agentAddress} but the signature is from ${address}. The signature wins.`,
      );
    }

    // Bind the signature to THIS dispute where the client supports it. The AgentKit
    // message covers domain, uri, nonce and time — not the evidence. Without
    // `requestId` a captured header can file a different dispute for five minutes.
    const bodyDigest = disputeSignal({
      verdictKey: body?.verdictKey ?? body?.fingerprint ?? null,
      evidenceHash: evidenceHashOf(body),
    });
    if (payload.requestId && payload.requestId !== bodyDigest) {
      return refuse(
        'agentkit_body_mismatch',
        'the signed requestId does not match this dispute. A signature bound to one rebuttal cannot file another.',
      );
    }

    let checksummed;
    try {
      checksummed = getAddress(address);
    } catch (err) {
      return refuse('agentkit_signature_invalid', `recovered address is not a valid address: ${String(err?.message ?? err).slice(0, 120)}`);
    }

    const standing = await lookupHumanStrict(checksummed);
    if (!standing.ok) return refuse(standing.reason, standing.detail, { agentAddress: checksummed, network: networkKey });

    // Granted. Burn the nonce so the same signed header cannot file twice.
    usedNonces.set(payload.nonce, Date.now());

    return {
      ok: true,
      humanId: standing.humanId,
      agentAddress: checksummed,
      network: networkKey,
      chainId: network.caip2,
      contract: contractAddress,
      // Legible without being a claim about the agent: what was checked, where.
      standing: {
        proved: 'a human registered this wallet in AgentBook',
        notProved: 'that the rebuttal is correct, and nothing about how this agent has behaved',
        bodyBound: Boolean(payload.requestId),
      },
      ...(standing.sdkDisagreed ? { sdkDisagreed: true } : {}),
    };
  }

  /* ── HUMAN: is this a unique person? ──────────────────────────────────── */

  function rpConfig() {
    const rpId = (env.WORLD_RP_ID || env.WORLD_APP_ID || '').trim();
    if (!rpId) {
      return {
        ok: false,
        reason: 'world_id_not_configured',
        detail:
          'This deployment has no World ID relying party. Set WORLD_RP_ID (preferred, `rp_…`) or WORLD_APP_ID ' +
          '(`app_…`, still accepted) from developer.world.org. Until then every human dispute is refused — an ' +
          'unset relying party is a configuration error, never a pass.',
      };
    }
    if (!/^(rp|app)_/.test(rpId)) {
      return {
        ok: false,
        reason: 'world_id_misconfigured',
        detail: `WORLD_RP_ID must start with "rp_" or "app_"; got "${rpId.slice(0, 12)}…". The live endpoint rejects anything else with code invalid_request.`,
      };
    }
    return { ok: true, rpId };
  }

  const expectedEnvironment = env.WORLD_ID_ENVIRONMENT || 'production';

  async function verifyHumanProof({ proof = null, action = WORLD_ACTIONS.dispute, signal = null, body = {} } = {}) {
    const refuse = (reason, detail, extra = {}) => ({ ok: false, reason, detail, verifier: 'idkit', ...extra });

    const rp = rpConfig();
    if (!rp.ok) return refuse(rp.reason, rp.detail);
    if (!proof || typeof proof !== 'object') {
      return refuse('proof_missing', `no World ID proof in the request. Prove personhood for action "${action}" and resend the IDKit result unmodified.`);
    }

    // The action scopes the nullifier. A proof for one action must never be spent
    // on another, or one submission unlocks every dispute.
    if (proof.action && proof.action !== action) {
      return refuse('action_mismatch', `this route needs a proof for action "${action}"; the proof carries "${proof.action}".`);
    }
    if (!proof.action && !proof.session_id) {
      return refuse('action_mismatch', `the proof names no action, so it cannot be scoped to "${action}".`);
    }
    if (proof.session_id) {
      return refuse(
        'session_proof_unsupported',
        'this is a World ID 4.0 session proof. SureX scopes standing per action, so it needs a uniqueness proof (an `action`), not a session.',
      );
    }

    // ⚠️ THE ENVIRONMENT GATE. A staging proof is a simulator identity. Accepting
    // one in production would mean anyone with the simulator is a unique human, so
    // the environment is pinned server-side and the client cannot choose it.
    const proofEnv = proof.environment ?? 'production';
    if (proofEnv !== expectedEnvironment) {
      return refuse(
        'environment_mismatch',
        `this deployment accepts "${expectedEnvironment}" proofs and this one is "${proofEnv}". Staging and sandbox ` +
          'identities come from a simulator, not from people, so they are refused here rather than counted as humans.',
      );
    }

    // The signal binds the proof to THIS dispute / THIS repo.
    const expectedSignal =
      signal ??
      (action === WORLD_ACTIONS.submit
        ? submitSignal({ repoUrl: body?.repo ?? body?.repoUrl })
        : disputeSignal({ verdictKey: body?.verdictKey ?? body?.fingerprint ?? null, evidenceHash: evidenceHashOf(body) }));

    const responses = Array.isArray(proof.responses) ? proof.responses : [];
    if (!responses.length) return refuse('proof_malformed', 'the IDKit result carries no responses[].');
    const emptyHash = String(proof.protocol_version ?? '3.0').startsWith('4') ? EMPTY_SIGNAL_HASH_V4 : EMPTY_SIGNAL_HASH_V3;
    const want = hashToField(expectedSignal);
    for (const r of responses) {
      const got = r.signal_hash ?? emptyHash;
      if (BigInt(got) === BigInt(emptyHash)) {
        return refuse(
          'signal_missing',
          `this proof binds no signal, so it would be replayable against every other entry in the registry. ` +
            `Pass signal="${expectedSignal}" to the IDKit preset.`,
        );
      }
      if (BigInt(got) !== BigInt(want)) {
        return refuse(
          'signal_mismatch',
          `the proof is bound to a different signal than this request describes (expected ${want}, got ${got}). ` +
            'It proves personhood for something else.',
        );
      }
    }

    // Forward the payload BYTE-FOR-BYTE. Reshaping it is the documented cause of
    // spurious invalid_proof, and this API is not the authority on proofs anyway.
    let res;
    let text;
    try {
      res = await doFetch(`${WORLD_VERIFY_BASE}/${rp.rpId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(proof),
        signal: AbortSignal.timeout(Number(env.SUREX_WORLD_VERIFY_TIMEOUT_MS ?? 8000)),
      });
      text = await res.text();
    } catch (err) {
      return refuse(
        'upstream_unavailable',
        `the World verifier could not be reached, so this person's proof is UNCHECKED, not rejected. Retry. (${String(err?.message ?? err).slice(0, 160)})`,
      );
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
    if (res.status >= 500) {
      return refuse('upstream_unavailable', `the World verifier answered HTTP ${res.status}. Unchecked, not rejected.`);
    }
    if (!res.ok || payload?.success !== true) {
      const first = Array.isArray(payload?.results) ? payload.results.find((r) => r?.success === false) : null;
      return refuse(
        'proof_rejected',
        `World rejected the proof: ${payload?.code ?? `HTTP ${res.status}`}${payload?.detail ? ` — ${payload.detail}` : ''}` +
          `${first?.code ? ` [${first.identifier ?? '?'}: ${first.code}${first.detail ? ` ${first.detail}` : ''}]` : ''}`,
        { worldCode: payload?.code ?? null, results: payload?.results ?? null },
      );
    }

    const nullifierHex =
      payload.nullifier ??
      (Array.isArray(payload.results) ? payload.results.find((r) => r?.success && r?.nullifier)?.nullifier : null) ??
      responses.find((r) => r?.nullifier)?.nullifier;
    let nullifier;
    try {
      nullifier = nullifierToDecimal(nullifierHex);
    } catch (err) {
      return refuse('proof_malformed', `World returned success but no readable nullifier: ${String(err?.message ?? err)}`);
    }

    // Uniqueness, per flow, BEFORE anything is granted.
    //   maintainer-submit → one per person, ever.
    //   contest-verdict   → N per rolling window. A person who is right twice is
    //                       not a Sybil, and one-shot would silence them.
    const rule =
      action === WORLD_ACTIONS.submit
        ? { max: 1, windowMs: null }
        : {
            max: Number(env.SUREX_DISPUTES_PER_WINDOW ?? 5),
            windowMs: Number(env.SUREX_DISPUTE_WINDOW_MS ?? 24 * 60 * 60 * 1000),
          };
    const uniqueness = store.check(nullifier, action, rule);
    if (!uniqueness.ok) return refuse(uniqueness.reason, uniqueness.detail, { action });

    return {
      ok: true,
      nullifier, // decimal string, and the ONLY thing retained about the person
      action,
      environment: proofEnv,
      signal: expectedSignal,
      uniqueness: { ...rule, alreadyUsed: uniqueness.seen, store: store.kind },
      /** Called by the route once the submission is actually accepted. */
      commit: () => store.record(nullifier, action),
    };
  }

  logger.info?.(
    `[surex-api] World verifiers active — AgentBook ${contractAddress} on ${networkKey} via ${rpcUrl}; ` +
      `World ID relying party ${rpConfig().ok ? 'configured' : 'NOT CONFIGURED (human disputes will fail with a configuration error)'}; ` +
      `proof environment "${expectedEnvironment}".`,
  );

  return {
    name: 'agentbook+idkit',
    isStub: false,
    network: networkKey,
    contract: contractAddress,
    rpcUrl,
    environment: expectedEnvironment,
    worldIdConfigured: rpConfig().ok,
    challenge,
    nullifiers: store,
    verifyAgentStanding,
    verifyHumanProof,
    // exposed for the live smoke test, which reads a third-party registration
    _lookupHumanStrict: lookupHumanStrict,
  };
}

/* ────────────────────────────────────────────────────────────────── selection ─*/

/** Which verifier set to use, given the environment. Stub unless told otherwise. */
export function resolveVerifiers({ env = process.env, logger = console, fetchImpl } = {}) {
  if (env.SUREX_WORLD === '1') {
    if (env.SUREX_MOCK_ACCEPT_DISPUTES === '1') {
      logger.warn?.(
        '[surex-api] SUREX_WORLD=1 and SUREX_MOCK_ACCEPT_DISPUTES=1 are both set. Real identity checks win — ' +
          'a build configured to check identity will not fake it.',
      );
    }
    try {
      return createWorldVerifiers({ env, logger, fetchImpl });
    } catch (err) {
      // Fail CLOSED to the stub, loudly. A misconfigured World verifier must never
      // become an absent one that quietly accepts.
      logger.error?.(`[surex-api] SUREX_WORLD=1 but the World verifiers could not be built: ${err?.message ?? err}. Falling back to the STUB, which refuses everything.`);
      return createStubVerifiers({ logger });
    }
  }
  const mock = env.SUREX_MOCK === '1';
  if (mock && env.SUREX_MOCK_ACCEPT_DISPUTES === '1') return createIllustrativeVerifiers({ logger });
  return createStubVerifiers({ logger });
}
