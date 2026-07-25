// Vercel function entry. NODE RUNTIME, deliberately not edge.
//
// Not edge because: node:crypto (the timing-safe admin compare and the dispute id),
// the Arkiv SDK's viem transport, and JSON import attributes all want a real Node
// runtime. There is no `export const config = { runtime: 'edge' }` here and there
// should never be one.
//
// vercel.json rewrites every path to this function, so `/v1/verdict` reaches the
// same Hono app the tests exercise and `node src/server.mjs` serves.
//
// ─────────────────────────────────────────────────────────────────────────────
// Why this is a hand-written adapter and not `@hono/node-server/vercel`:
//
// With `handle(app)`, every GET worked and EVERY REQUEST WITH A BODY HUNG until
// the function timed out — `/v1/verdicts/batch`, `/v1/disputes` and
// `/v1/submissions` all returned 504 after 20 s, while `POST /nope` (which reads
// no body) answered in 1.3 s. That asymmetry is the tell: Vercel's Node runtime
// PRE-PARSES the request body onto `req.body` and leaves the underlying stream
// consumed, so an adapter that builds a Web `Request` from that stream waits on
// something that will never emit.
//
// It hid well, because the entire read path is GETs. The route it actually breaks
// is the gate's SessionStart prefetch. FRICTION-LOG V6.
//
// So: build the Request from `req.body` when Vercel has already parsed it, and
// only fall back to draining the stream when it has not.
// ─────────────────────────────────────────────────────────────────────────────

import { createApp } from '../src/app.mjs';

const app = createApp();

/** Vercel may hand us a parsed object, a string, a Buffer, or nothing at all. */
function bodyFrom(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const raw = req.body;
  if (raw === undefined || raw === null) return null; // signal: try the stream
  if (typeof raw === 'string') return raw;
  if (Buffer.isBuffer(raw)) return raw;
  // A parsed object. Re-serialise rather than guess: JSON is the only content
  // type this API accepts, and the app validates the shape itself.
  try {
    return JSON.stringify(raw);
  } catch {
    return null;
  }
}

function drain(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    // NOT unref'd, deliberately. An unref'd timer does not hold the event loop
    // open, so when the stream is already spent and nothing else is pending the
    // timer never fires and the promise never settles — which is the same hang
    // this adapter exists to remove, wearing a different hat. A test caught it.
    const timer = setTimeout(() => resolve(Buffer.concat(chunks)), 1500);
    const done = (fn) => (arg) => {
      clearTimeout(timer);
      fn(arg);
    };
    req.on('data', (c) => chunks.push(c));
    req.on('end', done(() => resolve(Buffer.concat(chunks))));
    req.on('error', done(reject));
  });
}

export default async function handler(req, res) {
  const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost';
  const proto = req.headers['x-forwarded-proto'] ?? 'https';
  const url = `${proto}://${host}${req.url}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(key, v);
  }

  let body = bodyFrom(req);
  if (body === null) {
    const drained = await drain(req);
    body = drained.length ? drained : undefined;
  }
  // The original Content-Length no longer matches a re-serialised body, and a
  // wrong one makes the Request constructor reject.
  headers.delete('content-length');

  let response;
  try {
    response = await app.fetch(new Request(url, { method: req.method, headers, body }));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        error: {
          code: 'internal',
          message: 'the API failed to serve this request',
          detail: String(err?.message ?? err).slice(0, 300),
        },
      }),
    );
    return;
  }

  res.statusCode = response.status;
  for (const [key, value] of response.headers) {
    if (key.toLowerCase() === 'set-cookie') continue; // set below, as a list
    res.setHeader(key, value);
  }
  const cookies = response.headers.getSetCookie?.();
  if (cookies?.length) res.setHeader('set-cookie', cookies);

  if (!response.body) {
    res.end();
    return;
  }
  res.end(Buffer.from(await response.arrayBuffer()));
}
