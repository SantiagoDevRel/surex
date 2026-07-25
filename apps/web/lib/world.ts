/**
 * World ID, server side only.
 *
 * SERVER ONLY, and not by accident: the relying-party signing key authenticates
 * this app to the World ID protocol, and anything that leaks it lets someone else
 * forge proof requests in our name. Nothing in this file may ever be imported by a
 * client component, and `RP_SIGNING_KEY` must never become `NEXT_PUBLIC_*`.
 *
 * What lives here: the two action names, and the two signal formulas.
 *
 * ⚠️ The signal formulas are duplicated in `apps/api/src/verifiers.mjs`, on purpose —
 * the client has to pick a signal before a proof exists, and the API has to
 * recompute it from the request afterwards, so both sides need the formula and they
 * live in different packages. The same fixed vectors are pinned in BOTH test suites
 * (`apps/web/test/copy.test.mjs` and `apps/api/test/world.test.mjs`), so drift
 * breaks a test instead of quietly producing proofs the server rejects.
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

/* ─────────────────────────────────────────────────────── the relying party ───*/

export interface WorldConfig {
  appId: string;
  rpId: string;
  signingKey: string;
  environment: 'production' | 'staging' | 'sandbox';
}

export type WorldConfigResult = { ok: true; config: WorldConfig } | { ok: false; missing: string[]; detail: string };

/**
 * Read the relying party out of the environment, or say precisely what is missing.
 *
 * There is no fallback and no demo mode. A missing `app_id` produces a
 * configuration error the screen renders verbatim — never a signature, never a
 * screen that behaves as though personhood had been proven.
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
  return { ok: true, config: { appId, rpId, signingKey, environment } };
}
