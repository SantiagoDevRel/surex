/**
 * World ID, server side only, and not by accident: `RP_SIGNING_KEY`
 * authenticates this app to the World ID protocol, and it must never become
 * `NEXT_PUBLIC_*` or be imported by a client component.
 *
 * ⚠️ The signal formulas are duplicated in `apps/api/src/verifiers.mjs` (client
 * picks a signal before a proof exists, API recomputes it after) — the same
 * fixed vectors are pinned in both test suites so drift breaks a test.
 */

import { createHash } from 'node:crypto';

/** tech spec §7.1. One action per flow; a proof for one is never spendable on the other. */
export const WORLD_ACTIONS = {
  submit: 'maintainer-submit',
  dispute: 'contest-verdict',
} as const;

export type WorldAction = (typeof WORLD_ACTIONS)[keyof typeof WORLD_ACTIONS];

const sha256Hex = (value: string) => createHash('sha256').update(String(value)).digest('hex');

/** Lowercased, scheme- and trailing-slash- and `.git`-insensitive. */
export function normaliseRepo(repoUrl: string | null | undefined): string {
  return String(repoUrl ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
}

/** The signal for `maintainer-submit`: one repository. */
export function submitSignal(repoUrl: string | null | undefined): string {
  return sha256Hex(normaliseRepo(repoUrl));
}

/** The evidence a dispute stands on, hashed so the signal is fixed-length. */
export function evidenceHashOf(evidence: string | null | undefined): string {
  return sha256Hex(String(evidence ?? ''));
}

/**
 * The signal for `contest-verdict`: one verdict, one rebuttal.
 *
 * Without it a proof reading "I contest something" is replayable against every
 * other entry in the registry, which is the whole reason the signal exists.
 */
export function disputeSignal(verdictKey: string | null | undefined, evidenceHash: string): string {
  return sha256Hex(`${verdictKey ?? ''}|${evidenceHash}`);
}

/* ──────────────────────────────────────────── which credential we ask for ───*/

/**
 * What the person is asked to prove — chosen server-side, carried to the browser
 * in the rp-signature response. Three credentials, not equivalent claims:
 *
 *   face   — Selfie Check (`selfieCheckLegacy`). World's own docs rate its sybil
 *            resistance as "some", not full personhood proof. Beta; returns a
 *            World ID 3.0 Face proof, so `allow_legacy_proofs` must stay set.
 *   orb    — Proof of Human (`proofOfHuman`). The strong anti-sybil credential.
 *   device — Device level (`deviceLegacy`). World App account only, no biometric.
 *            Kept reachable via env var since requiring an Orb excludes most
 *            maintainers.
 *
 * Default is `face` — the weakest claim of the three — so an unset variable never
 * claims more than it checked. An unrecognised value is a configuration error, not
 * a silent fallback: `WORLD_CREDENTIAL=orbb` must never quietly hand back a face
 * check to an operator who asked for an Orb.
 */
export const WORLD_CREDENTIALS = ['face', 'orb', 'device'] as const;

export type WorldCredential = (typeof WORLD_CREDENTIALS)[number];

export const DEFAULT_WORLD_CREDENTIAL: WorldCredential = 'face';

/* ─────────────────────────────────────────────────────── the relying party ───*/

export interface WorldConfig {
  appId: string;
  rpId: string;
  signingKey: string;
  environment: 'production' | 'staging' | 'sandbox';
  /** Which credential the widget will request. Server-chosen; see above. */
  credential: WorldCredential;
}

export type WorldConfigResult = { ok: true; config: WorldConfig } | { ok: false; missing: string[]; detail: string };

/**
 * Read the relying party out of the environment, or say precisely what is missing.
 * No fallback, no demo mode — missing config is an error the screen renders
 * verbatim, never a screen that behaves as though personhood had been proven.
 */
export function worldConfig(env: NodeJS.ProcessEnv = process.env): WorldConfigResult {
  const appId = env.NEXT_PUBLIC_WORLD_APP_ID?.trim() ?? '';
  const rpId = env.NEXT_PUBLIC_WORLD_RP_ID?.trim() ?? '';
  const signingKey = env.RP_SIGNING_KEY?.trim() ?? '';
  const environment = (env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT?.trim() || 'production') as WorldConfig['environment'];

  const missing: string[] = [];
  if (!appId) missing.push('NEXT_PUBLIC_WORLD_APP_ID');
  if (!rpId) missing.push('NEXT_PUBLIC_WORLD_RP_ID');
  if (!signingKey) missing.push('RP_SIGNING_KEY');
  if (missing.length) {
    return {
      ok: false,
      missing,
      detail:
        `World ID is not configured in this deployment: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} unset. ` +
        'All three come from one app at developer.world.org — app_id, rp_id, and a signing key shown exactly once. ' +
        'Until they are set, no proof can be requested and nothing here will pretend one was.',
    };
  }
  if (!appId.startsWith('app_')) {
    return { ok: false, missing: ['NEXT_PUBLIC_WORLD_APP_ID'], detail: 'NEXT_PUBLIC_WORLD_APP_ID must start with "app_".' };
  }
  if (!rpId.startsWith('rp_') && !rpId.startsWith('app_')) {
    return { ok: false, missing: ['NEXT_PUBLIC_WORLD_RP_ID'], detail: 'NEXT_PUBLIC_WORLD_RP_ID must start with "rp_" (or "app_" for a pre-4.0 app).' };
  }

  // Unset → default (`face`). Anything unrecognised → error, never a silent downgrade.
  const rawCredential = env.WORLD_CREDENTIAL?.trim().toLowerCase() ?? '';
  const credential = (rawCredential || DEFAULT_WORLD_CREDENTIAL) as WorldCredential;
  if (!(WORLD_CREDENTIALS as readonly string[]).includes(credential)) {
    return {
      ok: false,
      missing: ['WORLD_CREDENTIAL'],
      detail:
        `WORLD_CREDENTIAL is set to "${rawCredential}", which is not a credential this app can request. ` +
        `Use one of: ${WORLD_CREDENTIALS.join(', ')} — or leave it unset for "${DEFAULT_WORLD_CREDENTIAL}". ` +
        'It is refused rather than defaulted, because a deployment that asked for an Orb must never quietly get a face check.',
    };
  }

  return { ok: true, config: { appId, rpId, signingKey, environment, credential } };
}
