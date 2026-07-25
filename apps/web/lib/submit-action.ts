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

  /**
   * The commit the release tag resolved to, when the browser could resolve it.
   *
   * It travels as its own field rather than being folded into `release` because
   * the two are different kinds of claim: a tag is a label the maintainer can
   * repoint or delete, a commit is the bytes. Which of the two a submission
   * carries is what bounds the tier a verdict about it can ever reach — so it is
   * validated as a SHA here and dropped if it is anything else, rather than
   * forwarded as an unchecked string that would end up recorded as provenance.
   */
  const commitRaw = String(form.get('commit') ?? '').trim();
  const commit = /^[0-9a-f]{40}$/i.test(commitRaw) ? commitRaw.toLowerCase() : null;

  /**
   * A COMMIT alone is a complete submission. A tag alone is too. Neither is not.
   *
   * This used to require a non-empty `release`, which rejected exactly the repos
   * that need submitting most: a project that has never cut a release resolves to
   * its default branch head, and that entry carries a real 40-hex commit and an
   * EMPTY tag by design (`listReleases`, source `default-branch`). So pasting a
   * perfectly good repository answered "a repository and a release tag are both
   * needed" — asking a maintainer to invent a version string the repository does
   * not have, to describe bytes we had already resolved.
   *
   * Requiring the tag also had it backwards. The commit is the stronger of the
   * two claims: it names bytes that cannot change, where a tag can be repointed
   * or deleted. Refusing a submission that carries the strong identifier because
   * it lacks the weak one is the wrong way round.
   */
  if (!repo || (!release && !commit)) return { kind: 'missing' };

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
