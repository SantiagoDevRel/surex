#!/usr/bin/env node
// A bearer-checking front door for the SureX reviewer.
//
// The deployed API has to reach an open-source model on this box, and the box is
// a home machine behind a Cloudflare tunnel. Exposing ollama's port directly
// would hand anyone on the internet a free GPU, so nothing reaches ollama without
// a bearer token, and only the handful of paths the reviewer actually calls are
// forwarded at all.
//
//   listen   127.0.0.1:11500        (the tunnel is the only thing that talks to it)
//   forward  127.0.0.1:11434        (ollama)
//   auth     Authorization: Bearer <SUREX_REVIEWER_TOKEN>, compared timing-safely
//
// Node stdlib only.

import { createServer, request as httpRequest } from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';

const PORT = Number(process.env.SUREX_PROXY_PORT ?? 11500);
const UPSTREAM_HOST = '127.0.0.1';
const UPSTREAM_PORT = Number(process.env.SUREX_UPSTREAM_PORT ?? 11434);
const TOKEN = process.env.SUREX_REVIEWER_TOKEN ?? '';

if (!TOKEN || TOKEN.length < 24) {
  console.error('refusing to start: SUREX_REVIEWER_TOKEN is missing or too short');
  process.exit(1);
}

/**
 * Only what the reviewer calls. An allowlist rather than a denylist, because the
 * cost of forgetting to deny something here is a stranger running jobs on the GPU.
 * `/api/tags` is included because it is the cheapest liveness probe that
 * distinguishes "down" from "loading" (FRICTION-LOG D3).
 */
const ALLOWED = new Set(['/v1/chat/completions', '/v1/completions', '/v1/models', '/api/tags']);

/** Hash both sides so timingSafeEqual never throws on a length mismatch. */
const digest = (s) => createHash('sha256').update(String(s)).digest();
const EXPECTED = digest(TOKEN);

function authorised(req) {
  const header = req.headers.authorization ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) return false;
  return timingSafeEqual(digest(m[1]), EXPECTED);
}

/**
 * Ollama needs no auth of its own, so ours is stripped rather than forwarded.
 * The key must be DELETED: node's http client throws
 * ERR_HTTP_INVALID_HEADER_VALUE on an explicit `undefined` value, which took the
 * whole process down on the first authorised request.
 */
function forwardHeaders(headers) {
  const out = { ...headers, host: `${UPSTREAM_HOST}:${UPSTREAM_PORT}` };
  delete out.authorization;
  delete out.Authorization;
  return out;
}

function deny(res, status, message) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { code: status, message } }));
}

const server = createServer((req, res) => {
  try {
    handle(req, res);
  } catch (err) {
    // A throw in here used to exit the process. The reviewer going offline
    // mid-review because of one malformed request is not an acceptable failure.
    console.log(`${new Date().toISOString()} 500 ${req.method} ${req.url} ${err?.message}`);
    if (!res.headersSent) deny(res, 500, 'proxy error');
    else res.end();
  }
});

function handle(req, res) {
  const path = (req.url ?? '/').split('?')[0];

  // Unauthenticated liveness, deliberately uninformative: it says the front door
  // is up and nothing about what is behind it.
  if (path === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (!authorised(req)) {
    console.log(`${new Date().toISOString()} 401 ${req.method} ${path}`);
    return deny(res, 401, 'a bearer token is required');
  }
  if (!ALLOWED.has(path)) {
    console.log(`${new Date().toISOString()} 404 ${req.method} ${path} (not allowlisted)`);
    return deny(res, 404, 'this path is not forwarded');
  }

  const started = Date.now();
  const upstream = httpRequest(
    {
      host: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      method: req.method,
      path: req.url,
      headers: forwardHeaders(req.headers),
    },
    (up) => {
      // Never log a body: they carry the source code being reviewed.
      console.log(`${new Date().toISOString()} ${up.statusCode} ${req.method} ${path} ${Date.now() - started}ms`);
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );

  upstream.on('error', (err) => {
    console.log(`${new Date().toISOString()} 502 ${req.method} ${path} ${err.code ?? err.message}`);
    // Pass the cause through: ECONNREFUSED (ollama down) and a timeout are
    // different diagnoses and the caller needs to tell them apart.
    deny(res, 502, `reviewer upstream unreachable: ${err.code ?? err.message}`);
  });

  // A cold model load can take minutes; a review can take a few. Generous, but
  // bounded, so a wedged request cannot hold a socket forever.
  upstream.setTimeout(600_000, () => upstream.destroy(new Error('ETIMEDOUT')));
  req.pipe(upstream);
}

server.headersTimeout = 620_000;
server.requestTimeout = 620_000;
server.listen(PORT, '127.0.0.1', () => {
  console.log(`surex reviewer proxy on 127.0.0.1:${PORT} → ${UPSTREAM_HOST}:${UPSTREAM_PORT}`);
  console.log(`allowlisted: ${[...ALLOWED].join(' ')}`);
});
