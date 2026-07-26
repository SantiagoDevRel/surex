'use server';

import { ROUTES } from '@surex/core';

import { apiBase } from './api.ts';
import { COPY } from './copy.ts';
import { WORLD_ACTIONS } from './world.ts';

/**
 * `POST /v1/submissions`. The World ID proof travels with it; the registry checks
 * identity before it looks at the release. 401 (no proof), 501 (proof ok, ingest
 * not built), and 202 (queued) are distinct and each rendered as the API sent it —
 * never collapsed into a claimed success.
 */

export type SubmitOutcome =
  | { kind: 'idle' }
  | { kind: 'missing' }
  /** `submissionId` is what the live loader watches; optional, since an accepted submission can queue without one. */
  | { kind: 'accepted'; detail?: string; submissionId?: string }
  | { kind: 'notBuilt'; detail?: string; identityChecked: boolean }
  | { kind: 'refused'; code?: string; message?: string; detail?: string; status: number }
  | { kind: 'unreachable'; detail: string };

export async function submitRelease(
  _previous: SubmitOutcome,
  form: FormData,
): Promise<SubmitOutcome> {
  const repo = String(form.get('repo') ?? '').trim();
  const release = String(form.get('release') ?? '').trim();

  // The commit the release tag resolved to. Kept as its own field rather than
  // folded into `release` — a tag can be repointed, a commit can't — and
  // validated as a SHA so junk can't be forwarded as provenance.
  const commitRaw = String(form.get('commit') ?? '').trim();
  const commit = /^[0-9a-f]{40}$/i.test(commitRaw) ? commitRaw.toLowerCase() : null;

  // A commit alone is a complete submission; a tag alone is too. A project with
  // no release resolves to its default-branch head, which has a commit and an
  // empty tag by design (`listReleases`, source `default-branch`).
  if (!repo || (!release && !commit)) return { kind: 'missing' };

  // The IDKit result, forwarded byte-for-byte — reshaping it is a documented
  // cause of spurious invalid_proof.
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
      body: JSON.stringify({
        repo,
        release,
        ...(commit ? { commit } : {}),
        action: WORLD_ACTIONS.submit,
        ...(proof ? { proof } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const body = (await res.json().catch(() => null)) as
      | {
          submissionId?: string;
          error?: { code?: string; message?: string; detail?: string; built?: boolean; identity?: { checked?: boolean } };
          illustrative?: boolean;
        }
      | null;

    if (res.status === 202 || res.ok) {
      // Validated to the shape `GET /v1/submissions/:id` accepts, so a junk value
      // cannot become a polling loop against a URL that can only ever 400.
      const submissionId =
        typeof body?.submissionId === 'string' && /^[A-Za-z0-9_-]{4,64}$/.test(body.submissionId)
          ? body.submissionId
          : undefined;
      return {
        kind: 'accepted',
        detail: body?.illustrative ? COPY.illustrative.mockBody : undefined,
        submissionId,
      };
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
