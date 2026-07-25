'use server';

import { ROUTES } from '@surex/core';

import { apiBase } from './api.ts';
import { COPY } from './copy.ts';

/**
 * `POST /v1/submissions` — the real call, against the frozen contract.
 *
 * The contract says the auth on this route is a World ID proof (human) or an
 * AgentKit x402 header (agent). Neither is wired into this form yet, so a real
 * registry will refuse the submission. That refusal is rendered as-is rather
 * than replaced with a success screen: a submit flow that claims to have queued
 * a review it did not queue is exactly the kind of thing this project exists to
 * make impossible.
 */

export type SubmitOutcome =
  | { kind: 'idle' }
  | { kind: 'missing' }
  | { kind: 'accepted'; detail?: string }
  | { kind: 'refused'; code?: string; message?: string; status: number }
  | { kind: 'unreachable'; detail: string };

export async function submitRelease(
  _previous: SubmitOutcome,
  form: FormData,
): Promise<SubmitOutcome> {
  const repo = String(form.get('repo') ?? '').trim();
  const release = String(form.get('release') ?? '').trim();
  if (!repo || !release) return { kind: 'missing' };

  try {
    const res = await fetch(`${apiBase()}${ROUTES.submissions()}`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      // No `worldIdProof` field: we do not have one, and inventing a value to
      // get past a check would be a fabrication.
      body: JSON.stringify({ repo, release }),
      signal: AbortSignal.timeout(4000),
    });

    const body = (await res.json().catch(() => null)) as
      | { error?: { code?: string; message?: string }; illustrative?: boolean }
      | null;

    if (res.status === 202 || res.ok) {
      return {
        kind: 'accepted',
        detail: body?.illustrative ? COPY.illustrative.mockBody : undefined,
      };
    }
    return {
      kind: 'refused',
      status: res.status,
      code: body?.error?.code,
      message: body?.error?.message,
    };
  } catch (err) {
    return { kind: 'unreachable', detail: err instanceof Error ? err.message : 'network error' };
  }
}
