// One OpenAI-compatible chat completion. Timeout, one retry, and the
// demo-recovery fixture cache.
//
// `SUREX_REVIEWER_BASE_URL`, plain `fetch`, no SDK, no vendor field: the endpoint
// must stay swappable, so nothing here may couple to DGX-specific APIs.
//
// THE CACHE IS NOT AN OPTIMISATION. The box runs at home behind a tunnel and it
// will drop mid-demo, so every real result is written to `fixtures/` and
// committed. Two rules on that, and they are the whole reason this holds up:
//
//   1. A cached result is ALWAYS marked as cached, with the timestamp of the
//      original real run. It is never presented as fresh.
//   2. A result that never ran is never invented. Cache miss + endpoint down is
//      an `unreviewable` review, not a guess.

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Committed on purpose — these are the recorded real runs. */
export const FIXTURES_DIR = resolve(HERE, '..', 'fixtures');

/**
 * The model that produced the primary fixture in this repo, so the default cannot
 * silently disagree with what actually ran. Override with `SUREX_REVIEWER_MODEL`.
 *
 * The `:surex32k` suffix is not decoration: stock `qwen3-coder-next:q4_K_M` declares
 * a 262 144-token context and ollama sizes its KV cache from that — 112 GiB of
 * 122 GiB, killed by earlyoom. Capped, the same weights fit in 50 GiB. README.md
 * carries the two-line Modelfile.
 */
export const DEFAULT_MODEL_ID = 'qwen3-coder-next:surex32k';

/**
 * A cold load of a large local model is minutes, not seconds — 2m55s measured for a
 * 51 GB model. Generous on purpose: a timeout here becomes an `unreviewable` verdict
 * on a server that is probably fine.
 */
export const DEFAULT_TIMEOUT_MS = 240_000;

export const REVIEWER_ENV = Object.freeze({
  baseUrl: 'SUREX_REVIEWER_BASE_URL',
  model: 'SUREX_REVIEWER_MODEL',
  apiKey: 'SUREX_REVIEWER_API_KEY',
  timeoutMs: 'SUREX_REVIEWER_TIMEOUT_MS',
  label: 'SUREX_REVIEWER_LABEL',
  reasoningEffort: 'SUREX_REVIEWER_REASONING_EFFORT',
  maxTokens: 'SUREX_REVIEWER_MAX_TOKENS',
});

/**
 * A reasoning model spends the SAME output budget on its chain of thought as on
 * its answer: `gpt-oss:20b` with `max_tokens: 8` returned `content: ""`, the whole
 * chain in `message.reasoning`, and `finish_reason: "length"` — an empty answer a
 * careless parser reads as a verdict. So the budget is generous, and
 * `finish_reason: "length"` is a failure, not a result.
 */
export const DEFAULT_MAX_TOKENS = 8192;

/**
 * There is deliberately NO fallback base URL: a localhost default would mean a
 * misconfigured worker quietly reviewing against nothing, or against whatever else
 * is listening. Unset is a configuration error and says so.
 */
export function resolveConfig(env = process.env, overrides = {}) {
  const baseUrl = overrides.baseUrl ?? env[REVIEWER_ENV.baseUrl] ?? null;
  const timeoutMs = Number(overrides.timeoutMs ?? env[REVIEWER_ENV.timeoutMs]);
  const maxTokens = Number(overrides.maxTokens ?? env[REVIEWER_ENV.maxTokens]);
  return {
    baseUrl: baseUrl ? String(baseUrl).replace(/\/+$/, '') : null,
    modelId: overrides.modelId ?? env[REVIEWER_ENV.model] ?? DEFAULT_MODEL_ID,
    apiKey: overrides.apiKey ?? env[REVIEWER_ENV.apiKey] ?? null,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
    maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : DEFAULT_MAX_TOKENS,
    label: overrides.label ?? env[REVIEWER_ENV.label] ?? 'dgx',
    // Only sent when set: an unexpected parameter is a 400 on strict servers.
    reasoningEffort: overrides.reasoningEffort ?? env[REVIEWER_ENV.reasoningEffort] ?? null,
  };
}

/**
 * Endpoint provenance without publishing the address: `fixtures/` is committed to a
 * public repo and the endpoint is a private host, so a label plus a stable digest
 * proves two fixtures came from the same box without naming it.
 */
export function endpointFingerprint(baseUrl) {
  if (!baseUrl) return null;
  let host = baseUrl;
  try { host = new URL(baseUrl).host; } catch { /* keep the raw string */ }
  return createHash('sha256').update(host).digest('hex').slice(0, 12);
}

export function fixturePath(key, dir = FIXTURES_DIR) {
  if (!/^[0-9a-f]{16,64}$/.test(String(key))) throw new Error(`refusing to use a non-digest fixture key: ${key}`);
  return join(dir, `${key}.json`);
}

/** @returns {object|null} the recorded run, or null on a miss. */
export function readFixture(key, { dir = FIXTURES_DIR } = {}) {
  let path;
  try { path = fixturePath(key, dir); } catch { return null; }
  if (!existsSync(path)) return null;
  try {
    const record = JSON.parse(readFileSync(path, 'utf8'));
    if (!record || typeof record !== 'object' || !record.recordedAt) return null;
    return record;
  } catch {
    // A corrupt fixture is a miss, never a partially-trusted result.
    return null;
  }
}

/** Record a real run. `recordedAt` is stamped once and never rewritten — it is the timestamp a cached result is later presented with. */
export function writeFixture(key, record, { dir = FIXTURES_DIR } = {}) {
  const path = fixturePath(key, dir);
  mkdirSync(dir, { recursive: true });
  const full = { ...record, key, recordedAt: record.recordedAt ?? new Date().toISOString() };
  writeFileSync(path, `${JSON.stringify(full, null, 2)}\n`, 'utf8');
  return { path, record: full };
}

export function listFixtures({ dir = FIXTURES_DIR } = {}) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const r = JSON.parse(readFileSync(join(dir, f), 'utf8'));
        return { key: r.key ?? f.replace(/\.json$/, ''), kind: r.kind, modelId: r.modelId, recordedAt: r.recordedAt };
      } catch { return { key: f.replace(/\.json$/, ''), kind: 'unreadable' }; }
    });
}

/**
 * Pull the assistant text out of a chat-completion body. A reasoning model returns
 * its chain in a separate field on some servers and inline in `<think>` tags on
 * others; a server out of output budget returns a truncated `content` with
 * `finish_reason: "length"`, which must be reported rather than parsed.
 */
export function extractAssistantText(body) {
  const choice = body?.choices?.[0];
  if (!choice) return { text: null, finishReason: null, error: 'no choices in response' };
  const message = choice.message ?? {};
  let text = typeof message.content === 'string' ? message.content : '';
  if (Array.isArray(message.content)) {
    text = message.content.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('');
  }
  // Inline reasoning: drop it. The answer is what follows.
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '').trim();
  return {
    text,
    finishReason: choice.finish_reason ?? null,
    reasoningPresent: Boolean(message.reasoning || message.reasoning_content),
    error: text ? null : 'assistant message had no content',
  };
}

function isRetryable(status) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One completion, with a timeout and at most one retry. Never throws for an expected
 * failure — returns `{ok:false, error}` so the caller can decide between the cache
 * and an `unreviewable` verdict instead of unwinding through a catch.
 *
 * @returns {Promise<{ok:true,text:string,body:object,ms:number,attempts:number}
 *                 | {ok:false,error:{code:string,message:string},ms:number,attempts:number}>}
 */
export async function callModel({
  messages,
  config,
  jsonMode = true,
  temperature = 0,
  maxTokens,
  retries = 1,
  fetchImpl,
  now = () => Date.now(),
}) {
  const startedAt = now();
  const doFetch = fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') {
    return fail('no_fetch', 'no fetch implementation available', startedAt, now, 0);
  }
  if (!config?.baseUrl) {
    return fail('not_configured', `${REVIEWER_ENV.baseUrl} is not set — the reviewer endpoint is unknown`, startedAt, now, 0);
  }

  // Tolerant of a base URL with or without `/v1` — the same env var feeds callers
  // that disagree about the convention, and one produced /v1/v1/chat/completions.
  const root = String(config.baseUrl).replace(/\/+$/, '').replace(/\/v1$/, '');
  const url = `${root}/v1/chat/completions`;
  const budget = maxTokens ?? config.maxTokens ?? DEFAULT_MAX_TOKENS;
  const payload = {
    model: config.modelId,
    messages,
    temperature,
    max_tokens: budget,
    stream: false,
    ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {}),
  };
  const headers = { 'content-type': 'application/json' };
  // Ollama ignores it, a hosted OSS endpoint will not — sending it unconditionally
  // is what makes the two interchangeable.
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;

  let attempts = 0;
  let last = null;

  while (attempts <= retries) {
    attempts += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await doFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = (await safeText(response)).slice(0, 400);
        last = { code: `http_${response.status}`, message: `${response.status} ${response.statusText}: ${detail}` };
        if (!isRetryable(response.status) || attempts > retries) break;
        await sleep(750 * attempts);
        continue;
      }
      const body = await response.json();
      const { text, finishReason, error, reasoningPresent } = extractAssistantText(body);
      if (error) {
        last = { code: 'empty_response', message: error };
        if (attempts > retries) break;
        await sleep(500);
        continue;
      }
      if (finishReason === 'length') {
        // A truncated JSON object is malformed by definition: schema.mjs must
        // never be handed half an object.
        last = { code: 'truncated', message: `model stopped at the token limit (max_tokens=${budget})` };
        break;
      }
      return {
        ok: true,
        text,
        body,
        finishReason,
        reasoningPresent,
        usage: body?.usage ?? null,
        ms: now() - startedAt,
        attempts,
      };
    } catch (err) {
      const aborted = err?.name === 'AbortError';
      last = aborted
        ? { code: 'timeout', message: `no response within ${config.timeoutMs} ms` }
        : { code: 'network', message: String(err?.message ?? err) };
      if (attempts > retries) break;
      await sleep(750 * attempts);
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, error: last ?? { code: 'unknown', message: 'call failed' }, ms: now() - startedAt, attempts };
}

function fail(code, message, startedAt, now, attempts) {
  return { ok: false, error: { code, message }, ms: now() - startedAt, attempts };
}

async function safeText(response) {
  try { return await response.text(); } catch { return ''; }
}

/**
 * Is the endpoint there, and does it have the model we are about to name in a
 * verdict?
 *
 * `GET /models` rather than a token of generation: same OpenAI-compatible surface,
 * and it answers in milliseconds against a box whose first generation may take
 * minutes to load weights — a probe that waits for a cold load cannot tell "down"
 * from "loading", which is the one distinction it exists to make.
 */
export async function pingModel({ config, fetchImpl } = {}) {
  const cfg = config ?? resolveConfig();
  const doFetch = fetchImpl ?? globalThis.fetch;
  if (!cfg.baseUrl) return { ok: false, error: { code: 'not_configured', message: `${REVIEWER_ENV.baseUrl} is not set` } };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(cfg.timeoutMs, 15_000));
  const startedAt = Date.now();
  try {
    const response = await doFetch(`${cfg.baseUrl}/models`, {
      headers: cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {},
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, ms: Date.now() - startedAt, error: { code: `http_${response.status}`, message: response.statusText } };
    }
    const body = await response.json();
    const ids = (body?.data ?? []).map((m) => m.id);
    return {
      ok: true,
      ms: Date.now() - startedAt,
      modelId: cfg.modelId,
      modelAvailable: ids.includes(cfg.modelId),
      models: ids,
    };
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    return {
      ok: false,
      ms: Date.now() - startedAt,
      error: aborted ? { code: 'timeout', message: 'no response' } : { code: 'network', message: String(err?.message ?? err) },
    };
  } finally {
    clearTimeout(timer);
  }
}
