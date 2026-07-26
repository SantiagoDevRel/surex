// The Vercel function entry, driven the way Vercel drives it — one case per body
// shape it can hand us.
//
// Vercel's Node runtime pre-parses the body onto `req.body` and leaves the stream
// consumed, so an adapter reading that stream waits forever: every request WITH A
// BODY hung until the function timed out, while GETs answered fine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

process.env.SUREX_MOCK = '1';
const { default: handler } = await import('../api/index.mjs');

/** A minimal stand-in for Vercel's (req, res). */
function fakeReq({ method = 'GET', url = '/', body, headers = {}, stream } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { host: 'arkiv-surex-api.vercel.app', 'content-type': 'application/json', ...headers };
  if (body !== undefined) req.body = body;
  if (stream) {
    // Emit on the next tick, the way a real stream would.
    setImmediate(() => {
      req.emit('data', Buffer.from(stream));
      req.emit('end');
    });
  }
  return req;
}

function fakeRes() {
  const chunks = [];
  return {
    statusCode: 0,
    headers: {},
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    end(chunk) {
      if (chunk) chunks.push(chunk);
      this.finished = true;
    },
    get text() {
      return Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(String(c))))).toString('utf8');
    },
  };
}

const FP = `sxf1_${'9'.repeat(64)}`;

test('a GET still works through the adapter', async () => {
  const res = fakeRes();
  await handler(fakeReq({ url: '/healthz' }), res);
  assert.equal(res.statusCode, 200);
  assert.match(res.text, /"ok"/);
});

test('THE BUG: a body Vercel already parsed into an object is not lost', async () => {
  // This is the shape that hung. `req.body` is a parsed object and the stream is
  // spent, so anything waiting on the stream never completes.
  const res = fakeRes();
  await handler(
    fakeReq({ method: 'POST', url: '/v1/verdicts/batch', body: { fps: [FP] } }),
    res,
  );
  assert.equal(res.statusCode, 200, res.text.slice(0, 200));
  const body = JSON.parse(res.text);
  assert.equal(body.requested, 1);
  assert.equal(body.heads.length, 1);
  assert.equal(body.heads[0].fingerprint, FP);
});

test('a body delivered as a string works', async () => {
  const res = fakeRes();
  await handler(
    fakeReq({ method: 'POST', url: '/v1/verdicts/batch', body: JSON.stringify({ fps: [FP] }) }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.text).requested, 1);
});

test('a body still on the stream works', async () => {
  const res = fakeRes();
  await handler(
    fakeReq({ method: 'POST', url: '/v1/verdicts/batch', stream: JSON.stringify({ fps: [FP] }) }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.text).requested, 1);
});

test('a spent stream with no parsed body RESOLVES rather than hanging', async () => {
  // No req.body and nothing ever emitted: the drain must give up quickly and let
  // the app answer, because holding the function open is the failure we removed.
  const res = fakeRes();
  const started = Date.now();
  await handler(fakeReq({ method: 'POST', url: '/v1/verdicts/batch' }), res);
  const elapsed = Date.now() - started;
  assert.ok(res.finished, 'the handler must always finish the response');
  assert.ok(elapsed < 5000, `took ${elapsed}ms — it must not wait out the function timeout`);
  // An empty body is a client error, not a hang.
  assert.ok(res.statusCode >= 400 && res.statusCode < 500, `got ${res.statusCode}`);
});

test('the response status, headers and body all survive', async () => {
  const res = fakeRes();
  await handler(fakeReq({ url: `/v1/verdict?fp=${FP}` }), res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'] ?? '', /application\/json/);
  // Mock mode must still be marked, through the adapter as everywhere else.
  assert.equal(JSON.parse(res.text).illustrative, true);
  assert.equal(res.headers['x-surex-illustrative'], 'true');
});

test('a 404 comes back as a 404, not as a hang', async () => {
  const res = fakeRes();
  await handler(fakeReq({ url: '/definitely-not-a-route' }), res);
  assert.equal(res.statusCode, 404);
});
