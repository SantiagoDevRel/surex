/**
 * `POST /api/world/rp-signature` — the one thing the browser cannot do for itself.
 *
 * IDKit 4.x requires every proof request to carry an `rp_context`: a signature made
 * with the relying party's signing key, proving the request came from this app.
 * Sign it here, on the server, and never anywhere else — a leaked signing key lets
 * anyone forge proof requests in SureX's name.
 *
 * It also returns the `signal` for the flow, because the signal is what binds a
 * proof to ONE verdict or ONE repository, and the browser must not get to choose it.
 * The registry recomputes the same value from the request body and refuses a proof
 * bound to anything else.
 *
 * What this route never does: return the signing key, log it, or manufacture a
 * signature when the relying party is unconfigured. With nothing configured it
 * answers 503 and says which variables are missing, and the screen shows that.
 */

import { NextResponse } from 'next/server';
import { signRequest } from '@worldcoin/idkit/signing';

import {
  WORLD_ACTIONS,
  disputeSignal,
  evidenceHashOf,
  submitSignal,
  worldConfig,
  type WorldAction,
} from '@/lib/world.ts';

export const dynamic = 'force-dynamic';

interface Body {
  action?: string;
  /** dispute: what is being contested, and the rebuttal it stands on. */
  verdictKey?: string;
  evidence?: string;
  /** submit: the repository being offered for review. */
  repo?: string;
}

export async function POST(request: Request): Promise<Response> {
  const cfg = worldConfig();
  if (!cfg.ok) {
    // A configuration error, said plainly. Not a signature, and not a pass.
    return NextResponse.json({ error: 'world_id_not_configured', detail: cfg.detail, missing: cfg.missing }, { status: 503 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid_body', detail: 'body must be JSON' }, { status: 400 });
  }

  const action = body.action as WorldAction;
  if (action !== WORLD_ACTIONS.submit && action !== WORLD_ACTIONS.dispute) {
    return NextResponse.json(
      { error: 'unknown_action', detail: `action must be "${WORLD_ACTIONS.submit}" or "${WORLD_ACTIONS.dispute}"` },
      { status: 400 },
    );
  }

  const signal =
    action === WORLD_ACTIONS.submit
      ? submitSignal(body.repo)
      : disputeSignal(body.verdictKey, evidenceHashOf(body.evidence));

  let signed: { sig: string; nonce: string; createdAt: number; expiresAt: number };
  try {
    signed = signRequest({ signingKeyHex: cfg.config.signingKey, action });
  } catch (err) {
    // A malformed key is a configuration fault, not the user's problem — and it must
    // not be reported as a failed verification.
    return NextResponse.json(
      {
        error: 'world_id_misconfigured',
        detail: `RP_SIGNING_KEY was rejected by signRequest(): ${err instanceof Error ? err.message : 'unknown error'}`,
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    app_id: cfg.config.appId,
    environment: cfg.config.environment,
    action,
    signal,
    // WHICH CREDENTIAL THE WIDGET MAY ASK FOR. Server-chosen, like the signal and
    // for the same reason: a browser that could pick its own bar would pick the
    // cheapest one, and the screen's statement of what was proven would stop
    // matching what was actually checked. `lib/world.ts` documents the three.
    credential: cfg.config.credential,
    rp_context: {
      rp_id: cfg.config.rpId,
      nonce: signed.nonce,
      created_at: signed.createdAt,
      expires_at: signed.expiresAt,
      signature: signed.sig,
    },
  });
}
