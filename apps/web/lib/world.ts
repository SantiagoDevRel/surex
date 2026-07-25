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

/* ──────────────────────────────────────────── which credential we ask for ───*/

/**
 * WHAT THE PERSON IS ASKED TO PROVE — and it is not one bar, it is three.
 *
 * Chosen HERE, on the server, and carried to the browser in the rp-signature
 * response. The browser never picks it, and the screen states which one it got
 * rather than describing "personhood" in the abstract — because the three do not
 * prove the same thing and a screen that worded them identically would be lying
 * about two of them.
 *
 *   face   — Selfie Check, via `selfieCheckLegacy`. World App opens the phone
 *            camera, checks a live face, and matches it against the enrolled one.
 *            World's own docs rate its sybil resistance as **"some"** —
 *            "Facial similarity checks provide some sybil resistance, but not as
 *            strong as Orb or NFC verification" — and the preset-selection table
 *            files it under "lower-friction liveness or bot deterrence", NOT under
 *            "one-human-one-action checks". It is beta, and it returns a World ID
 *            3.0 Face proof, which is why `allow_legacy_proofs` must stay set.
 *            → https://docs.world.org/world-id/credentials/11
 *            → https://docs.world.org/world-id/idkit/credentials#selfie-check
 *
 *   orb    — Proof of Human, via `proofOfHuman`. An Orb-verified World ID: the
 *            strong anti-sybil credential, and the only one of the three under
 *            which "the same person cannot come back as somebody else" holds.
 *            → https://docs.world.org/world-id/idkit/credentials
 *
 *   device — Device level, via `deviceLegacy`. What SureX requested before Face
 *            Check was enabled on the app: the person holds a World App account
 *            and no biometric was checked at all. Kept reachable instead of
 *            deleted, so the earlier decision it encoded — requiring an Orb to
 *            defend your own code excludes almost every maintainer there is — is
 *            one env var away rather than lost.
 *
 * The default is `face`: it opens a camera, which is the point of the demo, and it
 * makes the *weakest* claim of the three. A deployment that never sets the variable
 * therefore cannot end up claiming more than it checked.
 *
 * An unset variable takes that default. A variable set to something unrecognised is
 * a configuration ERROR, not a silent fallback — `WORLD_CREDENTIAL=orbb` must never
 * quietly hand back a face check to an operator who asked for an Orb.
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

  // Unset → the default (`face`, the weakest claim). Set to anything else → an
  // error, because an operator who typed `orbb` asked for the Orb and must not be
  // handed a face check under a screen that says Face Check.
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
