// The demo-recovery control. It is a demo control, not a security boundary — but
// the three things it does claim (no slug means no route, timing-safe compare,
// rate limit) have to actually be true.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createApp } from '../src/app.mjs';
import {
  mountAdmin,
  timingSafeCompare,
  createRateLimiter,
  loadModel,
  ADMIN_PASSWORD_HEADER,
  DEFAULT_RATE_LIMIT,
} from '../src/admin.mjs';
import { ERROR_CODES } from '@surex/core';

const quiet = { warn() {}, info() {}, error() {} };
const SLUG = 'test-slug-long-enough-to-not-warn';

function appWithAdmin({ env = {}, fetchImpl } = {}) {
  const app = createApp({
    env: {
      SUREX_MOCK: '1',
      SUREX_ADMIN_SLUG: SLUG,
      SUREX_REVIEWER_BASE_URL: 'http://reviewer.invalid',
      SUREX_REVIEWER_MODEL: 'demo-model',
      ...env,
    },
    logger: quiet,
    fetchImpl,
  });
  return { app, path: app.surex.admin.path };
}

test('refuses to mount without a slug, and says so', async () => {
  const app = createApp({ env: { SUREX_MOCK: '1' }, logger: quiet });
  assert.equal(app.surex.admin.mounted, false);
  assert.equal(app.surex.admin.path, null);
  assert.match(app.surex.admin.reason, /SUREX_ADMIN_SLUG is not set/);
  assert.match(app.surex.admin.reason, /no default slug/i);

  // And nothing is reachable — not the canonical path, not a guess.
  for (const guess of [
    '/a/load-model',
    '/a//load-model',
    '/a/admin/load-model',
    '/admin/load-model',
    `/a/${SLUG}/load-model`,
  ]) {
    const res = await app.request(guess, { method: 'POST' });
    assert.equal(res.status, 404, `${guess} must not exist`);
  }
});

test('there is no committed default slug anywhere in the source', () => {
  // A default slug is a published URL. Assert it by reading the file, because a
  // future edit that adds `?? "admin"` would pass every behavioural test.
  const src = readFileSync(fileURLToPath(new URL('../src/admin.mjs', import.meta.url)), 'utf8');
  const line = src.split('\n').find((l) => l.includes('SUREX_ADMIN_SLUG') && l.includes('??'));
  assert.ok(line, 'the slug must come from env');
  assert.match(line, /SUREX_ADMIN_SLUG\s*\?\?\s*''/, `no fallback slug allowed, found: ${line.trim()}`);
});

test('mounts at the unguessable path and 401s on a wrong or missing password', async () => {
  const { app, path } = appWithAdmin();
  assert.equal(path, `/a/${SLUG}/load-model`);

  for (const headers of [undefined, { [ADMIN_PASSWORD_HEADER]: '' }, { [ADMIN_PASSWORD_HEADER]: 'wrong' }, { [ADMIN_PASSWORD_HEADER]: '1234' }, { [ADMIN_PASSWORD_HEADER]: '12' }]) {
    const res = await app.request(path, { method: 'POST', headers });
    assert.equal(res.status, 401, `headers ${JSON.stringify(headers)} must be 401`);
    const body = await res.json();
    assert.equal(body.error.code, ERROR_CODES.UNAUTHENTICATED);
  }
});

test('the password is never accepted from the query string', async () => {
  // Query strings land in access logs, referrers and shell history. Header only.
  const { app, path } = appWithAdmin();
  const res = await app.request(`${path}?password=123`, { method: 'POST' });
  assert.equal(res.status, 401);
});

test('GET is not the method — this thing does something', async () => {
  const { app, path } = appWithAdmin();
  const res = await app.request(path, { method: 'GET' });
  assert.equal(res.status, 404);
});

test('rate limits, then 429s with rate_limited and a Retry-After', async () => {
  let calls = 0;
  const { app, path } = appWithAdmin({
    env: { SUREX_ADMIN_RATE_LIMIT: '3', SUREX_ADMIN_RATE_WINDOW_MS: '60000' },
    fetchImpl: async () => {
      calls += 1;
      return new Response('{"model":"demo-model"}', { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const hit = (password = '123') =>
    app.request(path, { method: 'POST', headers: { [ADMIN_PASSWORD_HEADER]: password, 'x-forwarded-for': '203.0.113.9' } });

  assert.equal((await hit()).status, 200);
  assert.equal((await hit()).status, 200);
  assert.equal((await hit()).status, 200);

  const limited = await hit();
  assert.equal(limited.status, 429);
  const body = await limited.json();
  assert.equal(body.error.code, ERROR_CODES.RATE_LIMITED);
  assert.ok(Number(limited.headers.get('Retry-After')) > 0);
  assert.equal(calls, 3, 'a limited request must not reach the reviewer');
});

test('the limiter is checked BEFORE the password, so it limits guessing too', async () => {
  const { app, path } = appWithAdmin({ env: { SUREX_ADMIN_RATE_LIMIT: '2' } });
  const guess = () =>
    app.request(path, { method: 'POST', headers: { [ADMIN_PASSWORD_HEADER]: 'wrong', 'x-forwarded-for': '198.51.100.4' } });
  assert.equal((await guess()).status, 401);
  assert.equal((await guess()).status, 401);
  assert.equal((await guess()).status, 429, 'wrong passwords consume the budget');
});

test('the limiter buckets per client and expires its window', () => {
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000 });
  let now = 0;
  assert.equal(limiter.hit('a', now).allowed, true);
  assert.equal(limiter.hit('a', now).allowed, true);
  assert.equal(limiter.hit('a', now).allowed, false);
  assert.equal(limiter.hit('b', now).allowed, true, 'a different client is not punished');
  now += 1001;
  assert.equal(limiter.hit('a', now).allowed, true, 'the window rolls over');
});

test('the password comparison is timing-safe', () => {
  // Behaviour: correct, and it does not throw or short-circuit on a length
  // mismatch — a raw timingSafeEqual would throw there, and catching that throw
  // leaks the length through control flow.
  assert.equal(timingSafeCompare('123', '123'), true);
  assert.equal(timingSafeCompare('123', '124'), false);
  assert.equal(timingSafeCompare('123', ''), false);
  assert.equal(timingSafeCompare('', ''), true);
  assert.equal(timingSafeCompare('1', '1234567890123456789012345678901234567890'), false);
  assert.equal(timingSafeCompare('ñé漢', 'ñé漢'), true);
  assert.equal(timingSafeCompare(undefined, '123'), false);
  assert.equal(timingSafeCompare('123', null), false);
  assert.equal(timingSafeCompare(123, 123), false, 'non-strings are refused, never coerced');

  // Implementation: the constant-time primitive is actually used, and the route
  // does not fall back to === for the password.
  const src = readFileSync(fileURLToPath(new URL('../src/admin.mjs', import.meta.url)), 'utf8');
  assert.match(src, /timingSafeEqual\(/, 'must use node:crypto timingSafeEqual');
  assert.match(src, /createHash\('sha256'\)/, 'both sides are hashed to a fixed length first');
  assert.ok(
    !/supplied\s*===|===\s*password|password\s*===/.test(src),
    'the password must never be compared with ===',
  );
});

test('a missing reviewer URL or model is reported, not guessed', async () => {
  const noUrl = appWithAdmin({ env: { SUREX_REVIEWER_BASE_URL: '' } });
  let res = await noUrl.app.request(noUrl.path, { method: 'POST', headers: { [ADMIN_PASSWORD_HEADER]: '123' } });
  assert.equal(res.status, 503);
  assert.match((await res.json()).error.message, /SUREX_REVIEWER_BASE_URL/);

  const noModel = appWithAdmin({ env: { SUREX_REVIEWER_MODEL: '' } });
  res = await noModel.app.request(noModel.path, { method: 'POST', headers: { [ADMIN_PASSWORD_HEADER]: '123' } });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error.message, /will not guess a model id/);
});

test('it reports what actually happened, including failures', async () => {
  // The worst outcome for a recovery control is "the button said OK and did nothing".
  const failing = appWithAdmin({
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: { message: 'model "demo-model" not found' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
  });
  let res = await failing.app.request(failing.path, { method: 'POST', headers: { [ADMIN_PASSWORD_HEADER]: '123' } });
  assert.equal(res.status, 502, 'a reviewer failure is not a 200');
  let body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.httpStatus, 404);
  assert.match(body.reviewerError, /not found/);

  const throwing = appWithAdmin({
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED 100.64.0.2:11434');
    },
  });
  res = await throwing.app.request(throwing.path, { method: 'POST', headers: { [ADMIN_PASSWORD_HEADER]: '123' } });
  assert.equal(res.status, 502);
  body = await res.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /ECONNREFUSED/, 'the tunnel being down is exactly what this route exists for');
});

test('loadModel sends the minimal ollama-compatible request that forces a load', async () => {
  let seen = null;
  const result = await loadModel({
    baseUrl: 'http://reviewer.invalid/',
    model: 'demo-model',
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return new Response('{"model":"demo-model"}', { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(seen.url, 'http://reviewer.invalid/v1/chat/completions', 'trailing slash is normalised');
  assert.equal(seen.init.method, 'POST');
  const sent = JSON.parse(seen.init.body);
  assert.equal(sent.model, 'demo-model');
  assert.equal(sent.max_tokens, 1, 'one token of work; the resident model is the side effect we want');
  assert.equal(sent.stream, false);
  assert.equal(result.ok, true);
  assert.equal(result.loaded, true);
});

test('loadModel times out instead of hanging a demo', async () => {
  const result = await loadModel({
    baseUrl: 'http://reviewer.invalid',
    model: 'demo-model',
    timeoutMs: 30,
    fetchImpl: (url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /timed out after 30 ms/);
});

test('loadModel leaves no pending timer behind', async () => {
  // Regression: the abort timer was not cleared on the success path, so every call
  // left a 120-second timer holding the event loop open. It kept `node --test`
  // alive for a hundred seconds after the last assertion, and on a serverless
  // invocation it keeps the function alive long after it has answered.
  const timers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
  const before = timers();
  await loadModel({
    baseUrl: 'http://reviewer.invalid',
    model: 'demo-model',
    timeoutMs: 120_000,
    fetchImpl: async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  assert.equal(timers(), before, 'the abort timer must be cleared in a finally block');
});

test('mountAdmin returns the limiter and warns about a short slug', () => {
  const { Hono } = { Hono: class {} };
  void Hono;
  const warnings = [];
  const app = { post() {} };
  const res = mountAdmin(app, {
    env: { SUREX_ADMIN_SLUG: 'short' },
    logger: { warn: (m) => warnings.push(m), info() {} },
  });
  assert.equal(res.mounted, true);
  assert.match(res.warning, /not guessable/);
  assert.ok(warnings.some((w) => /not guessable/.test(w)));
  assert.equal(res.limiter.limit, DEFAULT_RATE_LIMIT);
});
