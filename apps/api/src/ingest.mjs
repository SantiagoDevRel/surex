// Handing a checked submission to the writer.
//
// This API holds no wallet — deliberately, so that compromising it cannot rewrite
// the registry (packages/worker/src/config.mjs). Everything after the World ID
// gate therefore happens somewhere that does: the ingest service on the DGX,
// behind the same Cloudflare tunnel pattern the reviewer already uses.
//
// So this module is a forwarder and nothing more. It does not review, it does not
// sign, and it does not decide anything about the submission — it carries a
// checked one across, and reports honestly when it cannot.
//
// The one rule that shapes every line below: **never claim a submission was
// queued unless the writer said so.** A submit form that says "queued" when
// nothing was queued is precisely the class of lie this project exists to make
// impossible, so an unreachable writer is an explicit 503 and never a 202.

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
 * A submission carries a repository and a commit. The commit is not optional and
 * not a tag: a tag can be repointed or deleted, so a submission that names one
 * cannot say which bytes it means — and the whole tier model rests on being able
 * to say that.
 */
export function validateSubmission(body) {
  const repo = String(body?.repo ?? '').trim();
  const commit = String(body?.commit ?? '').trim().toLowerCase();
  const release = body?.release ? String(body.release).trim() : null;

  // Accept what the form sends and what a person might paste; normalise to
  // `owner/name` because that is what the pipeline takes.
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

/**
 * Where a submission has got to.
 *
 * A review is minutes, not seconds — a model reads the source twice, and four
 * times when the two readings disagree. Without this the submit screen has
 * nothing true to say during those minutes, and a screen with nothing true to
 * say invents something.
 *
 * It reports WHICH MODEL is doing the reading, deliberately. The verdict will
 * carry that name forever; someone watching it happen should see the same name,
 * not a spinner that could be hiding anything.
 */
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
      interrupted: body.interrupted ?? undefined,
      // Named, not implied. The model doing the reading is part of what the
      // verdict will claim, so it is visible while it is happening.
      reviewer: reviewerIdentity(env),
    };
  } catch (err) {
    return { kind: 'unreachable', detail: err?.name === 'AbortError' ? 'the writer did not answer in time' : 'the writer could not be reached' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Which model reads the code, in the words the verdict will use.
 *
 * Read from the same environment variable the reviewer itself reads, so the
 * screen cannot drift from what actually ran. Unset is reported as unset — a
 * hardcoded default here would be a screen confidently naming a model nobody
 * configured.
 */
export function reviewerIdentity(env = process.env) {
  const model = (env.SUREX_REVIEWER_MODEL ?? '').trim();
  return {
    model: model || null,
    // Two paraphrased readings, and two more when they disagree — see the
    // reviewer's merge rule. Worth saying: it explains why this takes minutes.
    readings: '2 paraphrased readings, 4 when they disagree',
    humanAudited: false,
  };
}

/**
 * Forward it. Returns what happened, in the caller's vocabulary — `queued`,
 * `unconfigured`, or `unreachable` — and never invents the first one.
 */
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
    // A 401 here is OUR misconfiguration — the wrong token — and the submitter
    // must not be shown a message implying they were refused.
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
