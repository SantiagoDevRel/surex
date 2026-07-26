// Worker configuration and key loading.
//
// SECRETS RULE (AGENTS.md §4): no private key ever enters this repo. Keys come
// from the environment first; when the environment is empty, they are read from
// files OUTSIDE the repo — `claude-code-environment/.secrets/` for the Sui
// keypair and `golem-project/tooling/hackathon-wallets/` for the Arkiv wallet.
// Nothing here logs a key, and nothing here writes one anywhere.
//
// The worker is the ONLY process with a wallet. apps/api reads and cannot write
// (see apps/api/src/arkiv.mjs) — that split is the reason a compromised API
// cannot rewrite the registry, so do not add a wallet to the read side.

import { readFileSync } from 'node:fs';

/** Scope attribute on every entity. MUST match apps/api DEFAULT_PROJECT. */
export const PROJECT = process.env.SUREX_ARKIV_PROJECT || 'surex-lisbon';

/** Arkiv. Chain id and RPC measured, AGENTS.md §7. */
export const ARKIV_RPC = process.env.ARKIV_RPC_URL || 'https://braga.hoodi.arkiv.network/rpc';
export const BRAGA_CHAIN_ID = 60138453102;

/**
 * The writer address every consumer read filters on, recorded so the worker can
 * assert the key it loaded is this wallet. Writing from an address nobody reads is
 * a silent no-op that looks exactly like a working seed.
 */
export const EXPECTED_ARKIV_WRITER = (
  process.env.SUREX_WRITER_ADDRESS || '0xBD33E1855F68Ce2DF1979377f3bc9fCaCd0015e6'
).toLowerCase();

/** Sui / Walrus. */
export const SUI_FULLNODE = process.env.SUREX_SUI_FULLNODE || 'https://fullnode.testnet.sui.io:443';
export const EXPECTED_SUI_ADDRESS = (
  process.env.SUREX_SUI_ADDRESS ||
  '0x79d8e8063dd83035f72b5b7c464474ad737c9a17f994611781f91ec2c479ff35'
).toLowerCase();

/**
 * Expirations, in SECONDS, and every one an EVEN integer.
 *
 * `expiresIn` is seconds and must be a positive multiple of the 2 s block time —
 * SDK 0.7.0 throws InvalidExpirationError on an odd value where 0.6.8 silently
 * rounded (FRICTION-LOG A3). Hackathon posture per tech spec §4.4: 30 days on
 * everything, no renewal job, and the three-state read demoed honestly.
 */
export const EXPIRES = Object.freeze({
  registryEntry: 30 * 24 * 60 * 60, // 2_592_000
  verdictHead: 30 * 24 * 60 * 60,
  source: 30 * 24 * 60 * 60,
  review: 30 * 24 * 60 * 60,
  dispute: 30 * 24 * 60 * 60,
});

/** Rounds up to the next even second, because odd values throw. */
export function evenSeconds(seconds) {
  const n = Math.max(2, Math.ceil(Number(seconds)));
  return n % 2 === 0 ? n : n + 1;
}

const DEFAULT_SECRETS_FILE =
  process.env.SUREX_SECRETS_FILE ||
  'C:/Users/STZTR/Desktop/claude-code-environment/.secrets/surex-wallets.txt';

const DEFAULT_WALLETS_FILE =
  process.env.SUREX_WALLETS_FILE ||
  'C:/Users/STZTR/Desktop/claude-code-environment/CONTEXTO/golem-project/tooling/hackathon-wallets/wallets.json';

/**
 * The Sui keypair secret, as the SDK's bech32 `suiprivkey…` string.
 * env SUREX_SUI_SECRET wins, so a deployment never needs the file.
 */
export function loadSuiSecret({ secretsFile = DEFAULT_SECRETS_FILE } = {}) {
  if (process.env.SUREX_SUI_SECRET) return process.env.SUREX_SUI_SECRET.trim();
  const section = readFileSync(secretsFile, 'utf8').split('[sui-testnet]')[1];
  if (!section) throw new Error(`no [sui-testnet] section in ${secretsFile}`);
  const secret = section.match(/private_key=(\S+)/)?.[1];
  if (!secret) throw new Error(`no private_key= under [sui-testnet] in ${secretsFile}`);
  return secret;
}

/**
 * The Arkiv writer private key, 0x-prefixed.
 *
 * Default source is wallets.json **index 2 (1-based)**, the wallet with a live
 * GLM balance. The `[arkiv-writer]` entry in .secrets/surex-wallets.txt has a
 * zero balance and is deliberately NOT read here (AGENTS.md §7) — reaching for
 * it produces a run that fails one transaction in, at the worst moment.
 */
export function loadArkivWriterKey({ walletsFile = DEFAULT_WALLETS_FILE, index = 2 } = {}) {
  const fromEnv = (process.env.ARKIV_WRITER_PK || '').trim();
  if (fromEnv) return fromEnv.startsWith('0x') ? fromEnv : `0x${fromEnv}`;

  const raw = JSON.parse(readFileSync(walletsFile, 'utf8'));
  const list = Array.isArray(raw) ? raw : raw.wallets;
  if (!Array.isArray(list)) throw new Error(`${walletsFile} is not a wallet list`);
  const entry = list.find((w) => Number(w.index) === index) ?? list[index - 1];
  if (!entry?.privateKey) throw new Error(`no privateKey at index ${index} in ${walletsFile}`);
  const key = String(entry.privateKey).trim();
  return key.startsWith('0x') ? key : `0x${key}`;
}

/** Where the resumable seed checkpoint lives. Inside the package, gitignored. */
export const STATE_DIR = new URL('../state/', import.meta.url);
