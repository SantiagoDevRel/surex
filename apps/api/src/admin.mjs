// POST /a/<slug>/load-model — a demo-recovery control, not a security boundary.
// An unguessable path, a shared password and a rate limit over one idempotent
// action: making a model resident on the reviewer.
//
//   · mounts only when SUREX_ADMIN_SLUG is set; no default is committed, so a
//     deploy that omits it has no admin surface
//   · the password travels in a header — a query string would reach access logs,
//     referrers and shell history
//   · the comparison is timing-safe
//   · the rate limit is checked before the password, so it limits guessing too
//   · the single action it triggers is idempotent

import { createHash, timingSafeEqual } from 'node:crypto';
import { apiError, ERROR_CODES } from '@surex/core';

export const ADMIN_PASSWORD_HEADER = 'x-surex-admin-password';
export const DEFAULT_RATE_LIMIT = 5;
export const DEFAULT_RATE_WINDOW_MS = 60_000;
/** Loading a cold 100 GB-class model over a tunnel is not a 5-second operation. */
export const DEFAULT_LOAD_TIMEOUT_MS = 120_000;
/** Below this a slug is not "unguessable"; we still mount, but we say so. */
export const MIN_SLUG_LENGTH = 16;

/**
 * Constant-time string comparison. Both sides are hashed to a fixed 32 bytes first
 * because raw timingSafeEqual throws on a length mismatch, and catching that throw
 * would leak the password's length through control flow.
 */
export function timingSafeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Fixed-window limiter, in process memory. On Vercel that is per instance, so the
 * effective limit is (limit × warm instances) — not a defence against a distributed
 * attacker.
 */
export function createRateLimiter({ limit = DEFAULT_RATE_LIMIT, windowMs = DEFAULT_RATE_WINDOW_MS } = {}) {
  const buckets = new Map();
  return {
    limit,
    windowMs,
    /** @returns {{allowed:boolean, remaining:number, retryAfterSeconds:number}} */
    hit(key, now = Date.now()) {
      // Opportunistic prune; the key space here is tiny.
      if (buckets.size > 1000) {
        for (const [k, v] of buckets) if (now - v.start > windowMs) buckets.delete(k);
      }
      let bucket = buckets.get(key);
      if (!bucket || now - bucket.start >= windowMs) {
        bucket = { start: now, count: 0 };
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      const allowed = bucket.count <= limit;
      return {
        allowed,
        remaining: Math.max(0, limit - bucket.count),
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.start + windowMs - now) / 1000)),
      };
    },
    reset() {
      buckets.clear();
    },
  };
}

/**
 * Best-effort client identity, falling back to a shared bucket — it errs toward more
 * limiting, never less. `x-forwarded-for` is client-supplied unless a proxy
 * overwrites it (Vercel does, a bare public port does not), so an attacker who can
 * set it can rotate buckets.
 */
export function clientKey(c) {
  const h = c.req.header.bind(c.req);
  const fwd = h('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return h('x-real-ip') || h('cf-connecting-ip') || 'unknown';
}

/**
 * `<base>/v1/chat/completions`, whether or not the caller's base URL already ends
 * in `/v1`. The reviewer package and this route read the same env var with two
 * conventions, and one of them yields `/v1/v1/chat/completions` and a 404.
 */
export function chatCompletionsUrl(baseUrl) {
  const trimmed = String(baseUrl ?? '').replace(/\/+$/, '');
  const root = trimmed.replace(/\/v1$/, '');
  return `${root}/v1/chat/completions`;
}

/**
 * Force a model resident on the reviewer: an ollama-compatible completion with
 * max_tokens 1, where the load is the side effect. Returns what happened including
 * the failure — "the button did nothing and said OK" is the worst outcome for a
 * recovery control.
 */
export async function loadModel({ baseUrl, model, apiKey = null, timeoutMs = DEFAULT_LOAD_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const url = chatCompletionsUrl(baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      // The reviewer sits behind a bearer-gated proxy: the DGX is a home machine
      // and an open ollama port is a free GPU for the internet.
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'load' }],
        max_tokens: 1,
        stream: false,
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return {
      ok: res.ok,
      loaded: res.ok,
      url,
      model,
      httpStatus: res.status,
      ms: Date.now() - t0,
      // Never echo the whole completion back; enough to tell a load from a 404.
      reviewerModel: body?.model ?? null,
      reviewerError: body?.error?.message ?? (res.ok ? null : text.slice(0, 400)),
    };
  } catch (err) {
    return {
      ok: false,
      loaded: false,
      url,
      model,
      httpStatus: null,
      ms: Date.now() - t0,
      // node's fetch reports a bare "fetch failed" and hides the useful part in
      // `cause` — ECONNREFUSED (reviewer down) vs ENOTFOUND (tunnel hostname gone)
      // is the whole diagnosis.
      error:
        err.name === 'AbortError'
          ? `timed out after ${timeoutMs} ms`
          : [err.message, err.cause?.code, err.cause?.message].filter(Boolean).join(' · '),
    };
  } finally {
    // Not optional: without it every call leaves a pending 120-second timer holding
    // the event loop open — `node --test` stayed alive long after the last
    // assertion, and a serverless invocation stays billable after it answered.
    clearTimeout(timer);
  }
}

/**
 * Mount the route, or refuse to and say why.
 *
 * @returns {{mounted:boolean, path:string|null, reason?:string, warning?:string}}
 */
export function mountAdmin(app, options = {}) {
  const env = options.env ?? process.env;
  const logger = options.logger ?? console;
  const slug = (options.slug ?? env.SUREX_ADMIN_SLUG ?? '').trim();
  const password = options.password ?? env.SUREX_ADMIN_PASSWORD ?? '123';
  const reviewerBaseUrl = options.reviewerBaseUrl ?? env.SUREX_REVIEWER_BASE_URL ?? '';
  const defaultModel = options.model ?? env.SUREX_REVIEWER_MODEL ?? '';
  const reviewerApiKey = options.reviewerApiKey ?? env.SUREX_REVIEWER_API_KEY ?? null;
  const timeoutMs = Number(options.timeoutMs ?? env.SUREX_ADMIN_LOAD_TIMEOUT_MS ?? DEFAULT_LOAD_TIMEOUT_MS);
  const fetchImpl = options.fetchImpl ?? fetch;
  const limiter =
    options.limiter ??
    createRateLimiter({
      limit: Number(options.rateLimit ?? env.SUREX_ADMIN_RATE_LIMIT ?? DEFAULT_RATE_LIMIT),
      windowMs: Number(options.rateWindowMs ?? env.SUREX_ADMIN_RATE_WINDOW_MS ?? DEFAULT_RATE_WINDOW_MS),
    });

  if (!slug) {
    const reason =
      'SUREX_ADMIN_SLUG is not set, so the admin route is NOT MOUNTED. There is no default slug and there ' +
      'never will be one — a committed default is a published URL. Set SUREX_ADMIN_SLUG to a long random ' +
      'string to enable POST /a/<slug>/load-model.';
    logger.warn?.(`[surex-api] ${reason}`);
    return { mounted: false, path: null, reason };
  }

  const path = `/a/${slug}/load-model`;
  let warning;
  if (slug.length < MIN_SLUG_LENGTH) {
    warning =
      `SUREX_ADMIN_SLUG is ${slug.length} characters. The whole point is that the path is not guessable; ` +
      `use at least ${MIN_SLUG_LENGTH}.`;
    logger.warn?.(`[surex-api] ${warning}`);
  }

  app.post(path, async (c) => {
    // Rate limit first, so this also limits password guessing.
    const rl = limiter.hit(clientKey(c));
    if (!rl.allowed) {
      c.header('Retry-After', String(rl.retryAfterSeconds));
      return c.json(
        apiError(ERROR_CODES.RATE_LIMITED, `too many attempts; retry in ${rl.retryAfterSeconds}s`, {
          retryAfterSeconds: rl.retryAfterSeconds,
        }),
        429,
      );
    }

    const supplied = c.req.header(ADMIN_PASSWORD_HEADER) ?? '';
    if (!timingSafeCompare(supplied, password)) {
      return c.json(
        apiError(
          ERROR_CODES.UNAUTHENTICATED,
          `bad or missing ${ADMIN_PASSWORD_HEADER} header`,
          { remaining: rl.remaining },
        ),
        401,
      );
    }

    if (!reviewerBaseUrl) {
      return c.json(
        apiError(
          ERROR_CODES.UPSTREAM_UNAVAILABLE,
          'SUREX_REVIEWER_BASE_URL is not set, so there is nothing to load a model on.',
        ),
        503,
      );
    }

    let body = {};
    try {
      const text = await c.req.text();
      if (text) body = JSON.parse(text);
    } catch {
      return c.json(apiError(ERROR_CODES.INVALID_BODY, 'body must be JSON if present'), 400);
    }

    const model = body.model ?? defaultModel;
    if (!model) {
      return c.json(
        apiError(
          ERROR_CODES.INVALID_BODY,
          'no model named: send {"model":"<id>"} or set SUREX_REVIEWER_MODEL. This route will not guess a ' +
            'model id.',
        ),
        400,
      );
    }

    const result = await loadModel({ baseUrl: reviewerBaseUrl, model, apiKey: reviewerApiKey, timeoutMs, fetchImpl });
    logger.info?.(
      `[surex-api] load-model model=${model} ok=${result.ok} status=${result.httpStatus ?? '-'} ${result.ms}ms`,
    );
    return c.json({ action: 'load-model', reviewerBaseUrl, ...result }, result.ok ? 200 : 502);
  });

  logger.info?.(
    `[surex-api] admin route mounted at POST ${path} — demo control, not a security boundary ` +
      `(rate limit ${limiter.limit}/${limiter.windowMs}ms, password in the ${ADMIN_PASSWORD_HEADER} header)`,
  );

  return { mounted: true, path, limiter, ...(warning ? { warning } : {}) };
}
