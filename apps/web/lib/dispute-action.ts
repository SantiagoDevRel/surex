'use server';

import { ROUTES } from '@surex/core';

import { apiBase } from './api.ts';
import { COPY } from './copy.ts';
import { WORLD_ACTIONS } from './world.ts';

/**
 * `POST /v1/disputes` as a person — the human half of the standing gate. Forwards
 * the World ID proof unmodified; the registry checks it server-side, so there is
 * no local success state. The agent half goes through `scripts/agent-dispute.mjs`
 * instead, signed with the wallet a human registered in AgentBook.
 */

export type DisputeOutcome =
  | { kind: 'idle' }
  | { kind: 'missing' }
  | { kind: 'filed'; id?: string; enforcement?: string; note?: string; illustrative?: boolean }
  | { kind: 'refused'; status: number; code?: string; message?: string; detail?: string }
  | { kind: 'unreachable'; detail: string };

export async function fileDispute(_previous: DisputeOutcome, form: FormData): Promise<DisputeOutcome> {
  const fingerprint = String(form.get('fingerprint') ?? '').trim();
  const evidence = String(form.get('evidence') ?? '').trim();
  const raw = String(form.get('proof') ?? '').trim();
  if (!fingerprint || !evidence || !raw) return { kind: 'missing' };

  let proof: unknown;
  try {
    proof = JSON.parse(raw);
  } catch {
    return { kind: 'missing' };
  }

  try {
    const res = await fetch(`${apiBase()}${ROUTES.disputes()}`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        fingerprint,
        evidence,
        contestantType: 'human',
        action: WORLD_ACTIONS.dispute,
        proof,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => null)) as
      | {
          dispute?: { id?: string };
          enforcement?: string;
          note?: string;
          illustrative?: boolean;
          error?: { code?: string; message?: string; detail?: string };
        }
      | null;

    if (res.status === 202) {
      return {
        kind: 'filed',
        id: body?.dispute?.id,
        enforcement: body?.enforcement,
        note: body?.illustrative ? COPY.illustrative.mockBody : body?.note,
        illustrative: body?.illustrative === true,
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
