'use client';

/**
 * The World ID step, on both screens that need it: `/submit` (a maintainer offers a
 * release) and `/d/[fp]` (a person contests a verdict).
 *
 * Three rules this component exists to keep:
 *
 * 1. NOTHING IS SIGNED IN THE BROWSER. The relying-party signature and the signal
 *    come from `POST /api/world/rp-signature`, on the server. If that route says the
 *    relying party is unconfigured, this renders the configuration error verbatim.
 *    There is no demo mode and no fallback that behaves as though a proof existed.
 *
 * 2. A PROOF IN HAND IS NOT AN ACCEPTED CLAIM. IDKit returning a result means World
 *    produced a proof; it does not mean the registry took it. The registry checks it
 *    server-side, and only its answer is shown as an outcome. So the success state
 *    here says exactly "proof in hand — the registry has not checked it yet".
 *
 * 3. A STAGING OR SANDBOX PROOF SAYS SO, LOUDLY. Those come from a simulator, not
 *    from a person. A screen that looked identical either way would be the most
 *    misleading thing on the site.
 *
 * 4. THE SCREEN NAMES THE CREDENTIAL, AND STATES WHAT THAT CREDENTIAL PROVES.
 *    Added when this app switched from device level to Face Check. The three
 *    credentials this app can request do not prove the same thing — the Orb is the
 *    one-human-one-action bar, Face Check is liveness that World rates as "some"
 *    sybil resistance, device level is an account with no biometric at all — so a
 *    single sentence about "personhood" would be a false claim under two of the
 *    three. The claim is made HERE because this is the only place that knows which
 *    one the server chose.
 */

import {
  IDKitRequestWidget,
  deviceLegacy,
  proofOfHuman,
  selfieCheckLegacy,
  type IDKitResult,
  type RpContext,
} from '@worldcoin/idkit';
import { useCallback, useState } from 'react';

import { COPY } from '@/lib/copy.ts';

import { Banner } from './Banner.tsx';

export type WorldIdContext =
  | { action: 'maintainer-submit'; repo: string }
  | { action: 'contest-verdict'; verdictKey: string; evidence: string };

/**
 * Deliberately duplicated from the server-only World module rather than imported
 * from it: that module reads the relying-party key, so a client component that
 * imported it would be one bundler decision away from shipping that key to the
 * browser. A test asserts this file never imports it — and that same test greps
 * this file for the key's variable name, so do not name it here even in a
 * comment. Three string literals are the cheap side of that trade.
 */
type Credential = 'face' | 'orb' | 'device';

/**
 * The credential → preset map, and the reason each one is what it is.
 *
 * `selfieCheckLegacy` is the CURRENT name of the Face Check preset in IDKit 4.x —
 * `@worldcoin/idkit` re-exports it from `@worldcoin/idkit-core`, and it returns a
 * World ID 3.0 Face proof, which is why `allow_legacy_proofs` below is not
 * optional. Selfie Check is beta and gated per app (`enable_face_check`); if the
 * app is not enabled for it the flow simply never starts, so a silent no-op here
 * means the app, not the code.
 * → https://docs.world.org/world-id/idkit/credentials#selfie-check
 */
const PRESET_FOR = {
  face: selfieCheckLegacy,
  orb: proofOfHuman,
  device: deviceLegacy,
} as const satisfies Record<Credential, (opts?: { signal?: string }) => unknown>;

interface RpResponse {
  app_id: `app_${string}`;
  environment: 'production' | 'staging' | 'sandbox';
  action: string;
  signal: string;
  /** Chosen server-side. The browser never picks its own bar. */
  credential: Credential;
  rp_context: RpContext;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'unconfigured'; detail: string; missing?: string[] }
  | { kind: 'failed'; detail: string }
  | { kind: 'ready'; rp: RpResponse }
  // The credential survives into `held`: the statement of what was proven has to
  // stay on screen next to the proof, not disappear the moment one arrives.
  | { kind: 'held'; environment: RpResponse['environment']; credential: Credential };

export function WorldIdProof({
  context,
  onProof,
  label,
  disabled,
}: {
  context: WorldIdContext;
  /** Handed the IDKit result unmodified — the caller forwards it as-is to the API. */
  onProof: (proof: IDKitResult | null) => void;
  label: string;
  disabled?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [open, setOpen] = useState(false);

  const begin = useCallback(async () => {
    setPhase({ kind: 'loading' });
    onProof(null);
    try {
      const res = await fetch('/api/world/rp-signature', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(context),
      });
      const body = await res.json().catch(() => null);
      if (res.status === 503) {
        setPhase({ kind: 'unconfigured', detail: body?.detail ?? COPY.world.unconfiguredBody, missing: body?.missing });
        return;
      }
      if (!res.ok || !body?.rp_context) {
        setPhase({ kind: 'failed', detail: body?.detail ?? `HTTP ${res.status}` });
        return;
      }
      setPhase({ kind: 'ready', rp: body as RpResponse });
      setOpen(true);
    } catch (err) {
      setPhase({ kind: 'failed', detail: err instanceof Error ? err.message : 'network error' });
    }
  }, [context, onProof]);

  return (
    <div className="grid gap-2.5">
      <button
        type="button"
        onClick={begin}
        disabled={disabled || phase.kind === 'loading'}
        className="justify-self-start rounded-input border border-accent bg-accent-t px-3.5 py-2 text-row font-semibold text-accent disabled:border-line-2 disabled:bg-transparent disabled:text-faint"
      >
        {phase.kind === 'loading' ? COPY.world.preparing : phase.kind === 'held' ? COPY.world.again : label}
      </button>

      {phase.kind === 'unconfigured' ? (
        <Banner tone="stale" label={COPY.world.unconfiguredLabel}>
          {phase.detail}
          {phase.missing?.length ? ` (${phase.missing.join(', ')})` : ''}
        </Banner>
      ) : null}

      {phase.kind === 'failed' ? (
        <Banner tone="flagged" label={COPY.world.failedLabel}>
          {COPY.world.failedBody} ({phase.detail})
        </Banner>
      ) : null}

      {phase.kind === 'held' ? (
        <>
          <Banner tone="neutral" label={COPY.world.heldLabel}>
            {COPY.world.heldBody}
          </Banner>
          {/* What that proof is a proof OF. Stays visible after success, because
              "proof in hand" without the credential named is the exact place a
              reader fills in the strongest bar they can imagine. */}
          <Banner tone="neutral" label={COPY.world.credential[phase.credential].label}>
            {COPY.world.credential[phase.credential].body}
          </Banner>
          {phase.environment !== 'production' ? (
            <Banner tone="stale" label={COPY.world.simulatedLabel}>
              {COPY.world.simulatedBody} (environment: {phase.environment})
            </Banner>
          ) : null}
        </>
      ) : null}

      {phase.kind === 'ready' ? (
        <>
          {/* Named before the widget opens, so the bar is known going in. */}
          <Banner tone="neutral" label={COPY.world.credential[phase.rp.credential].label}>
            {COPY.world.credential[phase.rp.credential].body}
          </Banner>
          {phase.rp.environment !== 'production' ? (
            <Banner tone="stale" label={COPY.world.simulatedLabel}>
              {COPY.world.simulatedBody} (environment: {phase.rp.environment})
            </Banner>
          ) : null}
          <IDKitRequestWidget
            open={open}
            onOpenChange={setOpen}
            app_id={phase.rp.app_id}
            action={phase.rp.action}
            rp_context={phase.rp.rp_context}
            environment={phase.rp.environment}
            // v4 requires this for legacy and fallback presets, and the DEFAULT
            // credential here is one: Selfie Check returns a World ID 3.0 Face
            // proof, so removing this flag breaks Face Check outright.
            allow_legacy_proofs
            // The preset the server chose. `selfieCheckLegacy` (default) opens the
            // camera in World App — on desktop after a QR scan, never in this
            // browser. It is LIVENESS: World rates its sybil resistance as "some"
            // and files it under bot deterrence rather than one-human-one-action.
            // `proofOfHuman` is the Orb path and the only one of the three under
            // which one person cannot come back as somebody else. Whichever it is,
            // the banner above says so — the preset and the claim change together
            // or the screen lies.
            preset={PRESET_FOR[phase.rp.credential]({ signal: phase.rp.signal })}
            onSuccess={(result) => {
              onProof(result);
              setPhase({ kind: 'held', environment: phase.rp.environment, credential: phase.rp.credential });
            }}
            onError={(code) => {
              onProof(null);
              setPhase({ kind: 'failed', detail: String(code) });
            }}
          />
        </>
      ) : null}
    </div>
  );
}
