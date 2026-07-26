'use client';

/**
 * The World ID step, on `/submit` and `/d/[fp]`. Four rules it exists to keep:
 * 1. Nothing is signed in the browser — the RP signature comes from
 *    `POST /api/world/rp-signature`, server-side, with no demo-mode fallback.
 * 2. A proof in hand is not an accepted claim — only the registry's own
 *    server-side check, shown as an outcome, means it was taken.
 * 3. A staging or sandbox proof says so, loudly (banner).
 * 4. The screen names the credential and what it actually proves —
 *    `WorldClaim`, from the credential the SERVER chose.
 * It also reports its phase via `onPhase`, since World runs entirely in this
 * browser and there is no run to poll for it.
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

// `WorldCredential` comes from `lib/submission.ts`, NOT the server-only World
// module — that module reads the RP signing key, and a client import of it is
// one bundler decision from shipping that key to the browser. A test asserts
// this file never imports it and never names the key's variable, even in a
// comment — so don't.

// `selfieCheckLegacy` is the current name of the Face Check preset in IDKit
// 4.x; it returns a World ID 3.0 Face proof, which is why `allow_legacy_proofs`
// below is required. → https://docs.world.org/world-id/idkit/credentials#selfie-check
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
  // The credential survives into `held` so what was proven stays on screen.
  | { kind: 'held'; environment: RpResponse['environment']; credential: WorldCredential };

/** `loading`/`ready` collapse to "checking"; both error kinds collapse to
 *  `failed` — which one is still shown in the banner. */
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

  // Called from event handlers only — never during render.
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

      {phase.kind === 'ready' || phase.kind === 'held' ? (
        <WorldClaim credential={credentialOf(phase)} />
      ) : null}

      {phase.kind === 'held' ? (
        <>
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
            // Required for legacy/fallback presets — the default credential
            // (Selfie Check) is one, so removing this breaks it outright.
            allow_legacy_proofs
            // The preset the server chose; `WorldClaim` above says which.
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
