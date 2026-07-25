'use client';

/**
 * The World ID step, on both screens that need it: `/submit` (a maintainer offers a
 * release) and `/d/[fp]` (a person contests a verdict).
 *
 * Four rules this component exists to keep:
 *
 * 1. NOTHING IS SIGNED IN THE BROWSER. The relying-party signature and the signal
 *    come from `POST /api/world/rp-signature`, on the server. If that route says the
 *    relying party is unconfigured, this renders the configuration error verbatim.
 *    There is no demo mode and no fallback that behaves as though a proof existed.
 *
 * 2. A PROOF IN HAND IS NOT AN ACCEPTED CLAIM. IDKit returning a result means World
 *    produced a proof; it does not mean the registry took it. The registry checks it
 *    server-side, and only its answer is shown as an outcome. This used to be a
 *    four-line banner and is now one line with the reasoning behind a disclosure —
 *    compressed, never dropped, because a screen that goes quiet here lets a reader
 *    assume the registry accepted something it has never seen.
 *
 * 3. A STAGING OR SANDBOX PROOF SAYS SO, LOUDLY. Those come from a simulator, not
 *    from a person. A screen that looked identical either way would be the most
 *    misleading thing on the site, so this one stayed a banner.
 *
 * 4. THE SCREEN NAMES THE CREDENTIAL, AND STATES WHAT THAT CREDENTIAL PROVES.
 *    The three credentials this app can request do not prove the same thing — the
 *    Orb is the one-human-one-action bar, Selfie Check is liveness that World rates
 *    as "some" sybil resistance, device level is an account with no biometric at all
 *    — so a single sentence about "personhood" would be a false claim under two of
 *    the three. `WorldClaim` makes it, from the credential the SERVER chose, and it
 *    renders both here at the button and on the World step of the flow.
 *
 * It also reports where it is (`onPhase`), because World is step one of the flow on
 * `/submit` and that step happens in this browser — there is no run to poll for it.
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
import type { WorldCredential, WorldPhase } from '@/lib/submission.ts';

import { Banner } from './Banner.tsx';
import { WorldClaim } from './StageRail.tsx';

export type WorldIdContext =
  | { action: 'maintainer-submit'; repo: string }
  | { action: 'contest-verdict'; verdictKey: string; evidence: string };

/**
 * `WorldCredential` comes from `lib/submission.ts` and NOT from the server-only
 * World module: that module reads the relying-party signing key, so a client
 * component importing it would be one bundler decision away from shipping that key
 * to the browser. A test asserts this file never imports it — and that same test
 * greps this file for the key's variable name, so do not name it here even in a
 * comment.
 */

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
} as const satisfies Record<WorldCredential, (opts?: { signal?: string }) => unknown>;

interface RpResponse {
  app_id: `app_${string}`;
  environment: 'production' | 'staging' | 'sandbox';
  action: string;
  signal: string;
  /** Chosen server-side. The browser never picks its own bar. */
  credential: WorldCredential;
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
  | { kind: 'held'; environment: RpResponse['environment']; credential: WorldCredential };

/**
 * The local phase, as the flow reads it. `loading` and `ready` are one thing from
 * out here — the reader is waiting — and both configuration errors land on
 * `failed`, because from the step's point of view no proof was obtained. Which of
 * the two it was is on screen, in the banner, unchanged.
 */
export function worldPhaseOf(phase: Phase['kind']): WorldPhase {
  switch (phase) {
    case 'idle':
      return 'idle';
    case 'loading':
    case 'ready':
      return 'checking';
    case 'held':
      return 'held';
    default:
      return 'failed';
  }
}

function credentialOf(phase: Phase): WorldCredential | null {
  if (phase.kind === 'ready') return phase.rp.credential;
  if (phase.kind === 'held') return phase.credential;
  return null;
}

export function WorldIdProof({
  context,
  onProof,
  onPhase,
  label,
  disabled,
}: {
  context: WorldIdContext;
  /** Handed the IDKit result unmodified — the caller forwards it as-is to the API. */
  onProof: (proof: IDKitResult | null) => void;
  /** Where this step is, for a caller that draws it as part of a larger flow. */
  onPhase?: (phase: WorldPhase, credential: WorldCredential | null) => void;
  label: string;
  disabled?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [open, setOpen] = useState(false);

  /**
   * One place that moves this component, so the flow cannot fall out of step with
   * it. Called from event handlers only — never during a render, which is what
   * would make a parent `setState` here a loop.
   */
  const advance = useCallback(
    (next: Phase) => {
      setPhase(next);
      onPhase?.(worldPhaseOf(next.kind), credentialOf(next));
    },
    [onPhase],
  );

  const begin = useCallback(async () => {
    advance({ kind: 'loading' });
    onProof(null);
    try {
      const res = await fetch('/api/world/rp-signature', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(context),
      });
      const body = await res.json().catch(() => null);
      if (res.status === 503) {
        advance({
          kind: 'unconfigured',
          detail: body?.detail ?? COPY.world.unconfiguredBody,
          missing: body?.missing,
        });
        return;
      }
      if (!res.ok || !body?.rp_context) {
        advance({ kind: 'failed', detail: body?.detail ?? `HTTP ${res.status}` });
        return;
      }
      advance({ kind: 'ready', rp: body as RpResponse });
      setOpen(true);
    } catch (err) {
      advance({ kind: 'failed', detail: err instanceof Error ? err.message : 'network error' });
    }
  }, [advance, context, onProof]);

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

      {/* Named before the widget opens, so the bar is known going in — and it stays
          named after a proof arrives, because "proof in hand" without the credential
          is the exact place a reader fills in the strongest bar they can imagine. */}
      {phase.kind === 'ready' || phase.kind === 'held' ? (
        <WorldClaim credential={credentialOf(phase)} />
      ) : null}

      {phase.kind === 'held' ? (
        <>
          {/* One line, and the reasoning one disclosure away. The registry has not
              seen this proof, and the screen must not stop saying so. */}
          <p className="flex items-baseline gap-1.5 text-mini text-ink-2">
            <span aria-hidden="true" className="text-clean">
              ✓
            </span>
            {COPY.world.heldShort}
          </p>
          <details>
            <summary className="cursor-pointer text-mini text-faint underline decoration-line underline-offset-2 hover:text-ink-3">
              {COPY.world.heldWhy}
            </summary>
            <p className="mt-1.5 max-w-[70ch] text-mini leading-relaxed text-ink-3">
              {COPY.world.heldBody}
            </p>
          </details>
          {phase.environment !== 'production' ? (
            <Banner tone="stale" label={COPY.world.simulatedLabel}>
              {COPY.world.simulatedBody} (environment: {phase.environment})
            </Banner>
          ) : null}
        </>
      ) : null}

      {phase.kind === 'ready' ? (
        <>
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
            // `WorldClaim` above says so — the preset and the claim change together
            // or the screen lies.
            preset={PRESET_FOR[phase.rp.credential]({ signal: phase.rp.signal })}
            onSuccess={(result) => {
              onProof(result);
              advance({
                kind: 'held',
                environment: phase.rp.environment,
                credential: phase.rp.credential,
              });
            }}
            onError={(code) => {
              onProof(null);
              advance({ kind: 'failed', detail: String(code) });
            }}
          />
        </>
      ) : null}
    </div>
  );
}
