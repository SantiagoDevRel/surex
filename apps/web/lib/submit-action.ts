'use server';

import { ROUTES } from '@surex/core';

import { apiBase } from './api.ts';
import { COPY } from './copy.ts';
import { WORLD_ACTIONS } from './world.ts';

/**
 * `POST /v1/submissions` — the real call, against the frozen contract.
 *
 * The World ID proof now travels with it, and the registry checks it BEFORE it looks
 * at the release. Three distinct answers, kept distinct because they mean different
 * things and collapsing them is how a submit form starts lying:
 *
 *   401  no usable proof — the gate refused, and nothing was read
 *   501  the proof checked out, and the ingest path behind the gate is not built
 *   202  queued (nothing produces this yet, and the form does not pretend otherwise)
 *
 * A submit flow that claimed to have queued a review it did not queue is exactly the
 * kind of thing this project exists to make impossible, so every non-202 answer is
 * rendered as the API sent it.
 */

export type SubmitOutcome =
  | { kind: 'idle' }
  | { kind: 'missing' }
  | { kind: 'accepted'; detail?: string }
  | { kind: 'notBuilt'; detail?: string; identityChecked: boolean }
  | { kind: 'refused'; code?: string; message?: string; detail?: string; status: number }
  | { kind: 'unreachable'; detail: string };

export async function submitRelease(
  _previous: SubmitOutcome,
  form: FormData,
): Promise<SubmitOutcome> {
  const repo = String(form.get('repo') ?? '').trim();
  const release = String(form.get('release') ?? '').trim();
  if (!repo || !release) return { kind: 'missing' };

  // The IDKit result, forwarded BYTE-FOR-BYTE. Reshaping the payload is the
  // documented cause of spurious invalid_proof, and nothing is invented when it is
  // absent: with no proof the request goes out without one and is refused, which is
  // the honest outcome.
  const raw = String(form.get('proof') ?? '').trim();
  let proof: unknown = null;
  if (raw) {
    try {
      proof = JSON.parse(raw);
    } catch {
      proof = null;
    }
  }

  try {
    const res = await fetch(`${apiBase()}${ROUTES.submissions()}`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ repo, release, action: WORLD_ACTIONS.submit, ...(proof ? { proof } : {}) }),
      signal: AbortSignal.timeout(10_000),
    });

    const body = (await res.json().catch(() => null)) as
      | {
          error?: { code?: string; message?: string; detail?: string; built?: boolean; identity?: { checked?: boolean } };
          illustrative?: boolean;
        }
      | null;

    if (res.status === 202 || res.ok) {
      return { kind: 'accepted', detail: body?.illustrative ? COPY.illustrative.mockBody : undefined };
    }
    if (res.status === 501) {
      return {
        kind: 'notBuilt',
        detail: body?.error?.message,
        identityChecked: body?.error?.identity?.checked === true,
      };
    }
    return {
      kind: 'refused',
      status: res.status,
      code: body?.error?.code,
      message: body?.error?.message,
      detail: body?.error?.detail,
    };
  } catch (err) {
    return { kind: 'unreachable', detail: err instanceof Error ? err.message : 'network error' };
  }
}
