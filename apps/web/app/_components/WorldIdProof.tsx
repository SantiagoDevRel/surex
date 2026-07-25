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
 */

import { IDKitRequestWidget, deviceLegacy, type IDKitResult, type RpContext } from '@worldcoin/idkit';
import { useCallback, useState } from 'react';

import { COPY } from '@/lib/copy.ts';

import { Banner } from './Banner.tsx';

export type WorldIdContext =
  | { action: 'maintainer-submit'; repo: string }
  | { action: 'contest-verdict'; verdictKey: string; evidence: string };

interface RpResponse {
  app_id: `app_${string}`;
  environment: 'production' | 'staging' | 'sandbox';
  action: string;
  signal: string;
  rp_context: RpContext;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'unconfigured'; detail: string; missing?: string[] }
  | { kind: 'failed'; detail: string }
  | { kind: 'ready'; rp: RpResponse }
  | { kind: 'held'; environment: RpResponse['environment'] };

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
            // v4 requires this for legacy and fallback presets. `deviceLegacy` is
            // the 4.x replacement for `verification_level: "device"` and returns
            // the person's highest legacy credential, so an Orb holder still
            // verifies with their Orb credential. Device level is the honest bar
            // for a maintainer — requiring an Orb to defend your own code would
            // exclude almost every maintainer there is.
            allow_legacy_proofs
            preset={deviceLegacy({ signal: phase.rp.signal })}
            onSuccess={(result) => {
              onProof(result);
              setPhase({ kind: 'held', environment: phase.rp.environment });
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
