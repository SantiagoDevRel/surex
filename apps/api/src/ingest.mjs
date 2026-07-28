// Handing a checked submission to the writer.
//
// This API holds no wallet, deliberately, so that compromising it cannot rewrite
// the registry (packages/worker/src/config.mjs). Everything after the World ID
// gate happens in the ingest service on the DGX, so this module forwards and
// nothing more — it does not review, sign, or decide.
//
// The one rule that shapes every line below: **never claim a submission was
// queued unless the writer said so.** An unreachable writer is an explicit 503
// and never a 202.

/** Configured only when both are present. Half a configuration is none. */
export function ingestConfig(env = process.env) {
  const baseUrl = (env.SUREX_INGEST_URL ?? '').trim().replace(/\/+$/, '');
  const token = (env.SUREX_INGEST_TOKEN ?? '').trim();
  if (!baseUrl || !token) {
    return {
      configured: false,
      missing: [
        ...(baseUrl ? [] : ['SUREX_INGEST_URL']),
        ...(token ? [] : ['SUREX_INGEST_TOKEN']),
      ],
    };
  }
  return { configured: true, baseUrl, token };
}

/**
 * A submission carries a repository and a full commit sha — never a tag: a tag can
 * be repointed or deleted, so it cannot say which bytes the submission means.
 */
export function validateSubmission(body) {
  const repo = String(body?.repo ?? '').trim();
  const commit = String(body?.commit ?? '').trim().toLowerCase();
  const release = body?.release ? String(body.release).trim() : null;

  // Accept a URL, an SSH remote or a bare path; the pipeline takes `owner/name`.
  const match = repo
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/^git@github\.com:/i, 'github.com/')
    .replace(/^github\.com\//i, '')
    .replace(/\.git$/i, '')
    .split(/[/?#]/)
    .filter(Boolean);
  const owner = match[0];
  const name = match[1];

  if (!owner || !name || !/^[A-Za-z0-9-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(name)) {
    return { ok: false, code: 'invalid_repo', detail: 'repo must identify a GitHub repository as owner/name' };
  }
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    return {
      ok: false,
      code: 'invalid_commit',
      detail:
        'commit must be the full 40-character sha of the release being submitted. A tag is a label that can ' +
        'be moved or deleted, so it cannot name the bytes a verdict would be about.',
    };
  }
  return { ok: true, repo: `${owner}/${name}`, commit, release };
}

/** Where a submission has got to, and which model is doing the reading. */
export async function submissionStatus(id, { env = process.env, fetchImpl = fetch, timeoutMs = 6000 } = {}) {
  const config = ingestConfig(env);
  if (!config.configured) return { kind: 'unconfigured', missing: config.missing };
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(String(id ?? ''))) return { kind: 'invalid' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${config.baseUrl}/v1/ingest/${encodeURIComponent(id)}`, {
      headers: { accept: 'application/json', authorization: `Bearer ${config.token}` },
      signal: controller.signal,
    });
    if (res.status === 404) return { kind: 'unknown' };
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) return { kind: 'unreachable', status: res.status };
    return {
      kind: 'ok',
      status: body.status,
      queuePosition: body.queuePosition ?? null,
      startedAt: body.startedAt ?? null,
      durationMs: body.durationMs ?? null,
      result: body.result ?? null,
      error: body.error ?? null,
      /**
       * Where the pipeline currently is while it runs, forwarded untouched:
       * `{stage, label, done, total, detail, at}`. A different field from `stage`
       * below, and they must not be merged — `stage` names the stage that failed,
       * which only exists once the pipeline has stopped.
       */
      progress: body.progress ?? null,
      // The stage that failed, when the pipeline said so.
      stage: body.stage ?? body.result?.stage ?? undefined,
      detail: body.detail ?? body.result?.detail ?? undefined,
      interrupted: body.interrupted ?? undefined,
      reviewer: reviewerIdentity(env),
    };
  } catch (err) {
    return { kind: 'unreachable', detail: err?.name === 'AbortError' ? 'the writer did not answer in time' : 'the writer could not be reached' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Which model reads the code, from the same env var the reviewer itself reads so
 * the screen cannot drift from what ran. Unset is reported as unset — never
 * default it, or the screen names a model nobody configured.
 */
export function reviewerIdentity(env = process.env) {
  const model = (env.SUREX_REVIEWER_MODEL ?? '').trim();
  return {
    model: model || null,
    readings: '2 paraphrased readings, 4 when they disagree',
    humanAudited: false,
  };
}

/** Forward it. Returns `queued`, `unconfigured` or `unreachable` — never inventing the first. */
export async function forwardSubmission(submission, { env = process.env, fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const config = ingestConfig(env);
  if (!config.configured) return { kind: 'unconfigured', missing: config.missing };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${config.baseUrl}/v1/ingest`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify({
        repo: submission.repo,
        commit: submission.commit,
        ...(submission.release ? { release: submission.release } : {}),
        ...(submission.submissionId ? { submissionId: submission.submissionId } : {}),
      }),
    });

    const body = await res.json().catch(() => null);
    if (res.status === 202 && body?.id) {
      return { kind: 'queued', id: String(body.id), deduped: Boolean(body.deduped), queuePosition: body.queuePosition ?? null };
    }
    // A 401 here is our misconfiguration (wrong token) — the submitter must not
    // be shown a message implying they were refused.
    return {
      kind: 'unreachable',
      status: res.status,
      detail: res.status === 401
        ? 'the registry could not authenticate to its own writer — this is our configuration, not your submission'
        : (body?.error?.message ?? `the writer answered ${res.status}`),
    };
  } catch (err) {
    return {
      kind: 'unreachable',
      detail: err?.name === 'AbortError' ? 'the writer did not answer in time' : 'the writer could not be reached',
    };
  } finally {
    clearTimeout(timer);
  }
}
