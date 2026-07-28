// Vercel function entry. Node runtime, deliberately not edge: node:crypto (the
// timing-safe admin compare and the dispute id), the Arkiv SDK's viem transport
// and JSON import attributes all need a real Node runtime. There must never be an
// `export const config = { runtime: 'edge' }` here.
//
// vercel.json rewrites every path to this function, so `/v1/verdict` reaches the
// same Hono app the tests exercise and `node src/server.mjs` serves.
//
// Hand-written rather than `@hono/node-server/vercel`: Vercel's Node runtime
// pre-parses the request body onto `req.body` and leaves the underlying stream
// consumed, so an adapter that builds a Web `Request` from that stream waits on
// something that will never emit — with `handle(app)` every GET worked and every
// request carrying a body hung until the 504. So build the Request from `req.body`
// when Vercel has already parsed it, and drain the stream only when it has not.

import { createApp } from '../src/app.mjs';

const app = createApp();

/** Vercel may hand us a parsed object, a string, a Buffer, or nothing at all. */
function bodyFrom(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const raw = req.body;
  if (raw === undefined || raw === null) return null; // signal: try the stream
  if (typeof raw === 'string') return raw;
  if (Buffer.isBuffer(raw)) return raw;
  // A parsed object: re-serialise. JSON is the only content type this API accepts.
  try {
    return JSON.stringify(raw);
  } catch {
    return null;
  }
}

function drain(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    // Not unref'd, deliberately: an unref'd timer does not hold the event loop
    // open, so with the stream already spent and nothing else pending it never
    // fires and the promise never settles — the same hang this adapter removes.
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
