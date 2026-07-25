// The /v1 read path, as a Hono app.
//
// THE APP CAN ONLY READ. There is no wallet in this process and no write route to
// Arkiv; verdicts are written by the worker's wallet in a different process. That
// separation is the reason a compromise of this service cannot rewrite the
// registry, so it is a property to preserve, not an implementation detail.
//
// Shapes, routes, error codes, cache TTLs and the gate's latency budget all come
// from @surex/core's FROZEN contract. Nothing here redefines them.

import { Hono } from 'hono';
import {
  API_VERSION,
  CONTRACT_FROZEN_AT,
  CACHE,
  GATE_BUDGET,
  ERROR_CODES,
  STATES,
  apiError,
  isFingerprint,
  unknownHead,
  parseVerdictHead,
  loadEvidence,
} from '@surex/core';

import { createMockStore } from './mock.mjs';
import { createArkivStore } from './arkiv.mjs';
import { AGENTKIT_HEADER, REFUSAL_STATUS, WORLD_ACTIONS, resolveVerifiers } from './verifiers.mjs';
import { mountAdmin } from './admin.mjs';
import { withLinks } from './links.mjs';
import { forwardSubmission, submissionStatus, validateSubmission } from './ingest.mjs';
import { createHash } from 'node:crypto';

/** A whole config's prefetch, capped. 5–20 is typical; 100 is already absurd. */
export const MAX_BATCH = 100;
/** Public feed page cap. */
export const MAX_FLAGGED = 500;

const S = (ms) => Math.floor(ms / 1000);

/**
 * Server-side hot-path cache.
 *
 * Honours exactly the TTLs in the frozen contract, because a positive TTL the
 * server does not honour is a stale block waiting to happen. The grace window is
 * asymmetric on purpose: a cached BLOCKING head outlives its TTL when Arkiv is
 * unreachable, and a cached non-blocking one does not. A network blip must never
 * un-flag a server we already know is bad, and must never keep answering `clean`
 * for one we can no longer check.
 */
export function createHeadCache({
  positiveTtlMs = CACHE.positiveTtlMs,
  negativeTtlMs = CACHE.negativeTtlMs,
  graceMs = CACHE.flaggedGraceMs,
  max = 5000,
  now = () => Date.now(),
} = {}) {
  const map = new Map();
  const blocking = (head) => head && (head.state === 'flagged' || head.state === 'disputed');

  return {
    get(fp) {
      const hit = map.get(fp);
      if (!hit) return null;
      const age = now() - hit.at;
      const ttl = hit.head ? positiveTtlMs : negativeTtlMs;
      if (age <= ttl) return { head: hit.head, fresh: true, ageMs: age };
      // Expired. Only a blocking head is still offerable, and only as a fallback.
      if (blocking(hit.head) && age <= graceMs) return { head: hit.head, fresh: false, ageMs: age };
      map.delete(fp);
      return null;
    },
    set(fp, head) {
      if (map.size >= max) map.delete(map.keys().next().value);
      map.set(fp, { head, at: now() });
    },
    get size() {
      return map.size;
    },
    clear() {
      map.clear();
    },
  };
}

/** Observed traffic, not chain state. Feeds the hit rate on /v1/stats. */
function createTelemetry() {
  return {
    startedAt: new Date().toISOString(),
    lookups: 0,
    hits: 0,
    batches: 0,
    upstreamErrors: 0,
    staleServed: 0,
    byState: Object.create(null),
    record(head) {
      this.lookups += 1;
      const state = head?.state ?? 'unknown';
      this.byState[state] = (this.byState[state] ?? 0) + 1;
      if (state !== 'unknown') this.hits += 1;
    },
  };
}

const upstream = (c, detail) =>
  c.json(
    apiError(ERROR_CODES.UPSTREAM_UNAVAILABLE, `could not read the registry: ${detail}`),
    503,
  );

export function createApp(options = {}) {
  const env = options.env ?? process.env;
  const logger = options.logger ?? console;
  const mock = options.mock ?? env.SUREX_MOCK === '1';

  const store = options.store ?? (mock ? createMockStore({ env }) : createArkivStore({ env }));
  const verifiers = options.verifiers ?? resolveVerifiers({ env, logger });
  const cache = options.cache ?? createHeadCache();
  const telemetry = options.telemetry ?? createTelemetry();

  /**
   * The `unknown` answer for a miss.
   *
   * unknownHead() is synthesised by the API, not read from a fixture, so in mock
   * mode it has to be marked HERE — the envelope middleware only reaches the root
   * of a body, and a head pulled out of `heads[]` and rendered on its own must
   * still carry the flag.
   */
  const unknown = store.illustrative
    ? (fp) => ({ ...unknownHead(fp), illustrative: true })
    : (fp) => unknownHead(fp);

  const app = new Hono();

  // ── cross-cutting ─────────────────────────────────────────────────────────
  // A public read API. `*` with no credentials is correct here and is what lets
  // the web app and a browser dispute form talk to it without a proxy.
  app.use('/v1/*', async (c, next) => {
    c.header('Access-Control-Allow-Origin', env.SUREX_CORS_ORIGIN || '*');
    c.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    c.header('Access-Control-Allow-Headers', 'content-type,x-payment,x-surex-client');
    c.header('Access-Control-Max-Age', '86400');
    if (c.req.method === 'OPTIONS') return c.body(null, 204);
    await next();
  });

  app.use('*', async (c, next) => {
    c.header('X-SureX-Mode', store.mode);
    c.header('X-SureX-Contract', `${API_VERSION}@${CONTRACT_FROZEN_AT}`);
    if (store.illustrative) c.header('X-SureX-Illustrative', 'true');
    await next();
  });

  /**
   * The belt to mock.mjs's braces: in mock mode EVERY JSON body leaves with
   * `illustrative: true`, including errors, whatever the route did. A route that
   * forgets the flag cannot cause demo data to be rendered as real.
   */
  if (store.illustrative) {
    app.use('*', async (c, next) => {
      await next();
      const res = c.res;
      if (!res || !res.headers.get('content-type')?.includes('application/json')) return;
      let body;
      try {
        body = await res.clone().json();
      } catch {
        return;
      }
      if (!body || typeof body !== 'object' || Array.isArray(body) || body.illustrative === true) return;
      c.res = new Response(JSON.stringify({ ...body, illustrative: true }), {
        status: res.status,
        headers: res.headers,
      });
    });
  }

  app.notFound((c) => c.json(apiError(ERROR_CODES.NOT_FOUND, `no route for ${c.req.method} ${c.req.path}`), 404));

  app.onError((err, c) => {
    telemetry.upstreamErrors += 1;
    logger.error?.(`[surex-api] ${c.req.method} ${c.req.path} failed:`, err);
    // ERROR_CODES.INTERNAL was added to the contract after this lane reported the
    // gap: reporting our own fault as `upstream_unavailable` blames the wrong
    // party, and a client deciding whether to retry needs to know which it is.
    return c.json(
      apiError(ERROR_CODES.INTERNAL, 'the API failed to serve this request', {
        detail: String(err?.message ?? err).slice(0, 300),
      }),
      500,
    );
  });

  // ── meta ──────────────────────────────────────────────────────────────────
  app.get('/', (c) =>
    c.json({
      service: 'surex-api',
      role: 'read path only — this process has no wallet and cannot write to Arkiv',
      mode: store.mode,
      contract: { version: API_VERSION, frozenAt: CONTRACT_FROZEN_AT },
      gateBudget: GATE_BUDGET,
      routes: [
        'GET  /v1/verdict?fp=<fingerprint>',
        'POST /v1/verdicts/batch { fps: [...] }',
        'GET  /v1/entry/:fp',
        'GET  /v1/source/:key',
        'GET  /v1/review/:key',
        'POST /v1/disputes',
        'POST /v1/submissions',
        'GET  /v1/submissions/:id',
        'GET  /v1/flagged',
        'GET  /v1/registry?state=&limit=',
        'GET  /v1/stats',
      ],
      ...(store.illustrative
        ? { warning: 'MOCK MODE — every response is fixture data marked illustrative:true. Nothing here was reviewed.' }
        : {}),
    }),
  );

  app.get('/healthz', async (c) => {
    try {
      return c.json({ ok: true, mode: store.mode, detail: await store.health() });
    } catch (err) {
      return c.json({ ok: false, mode: store.mode, error: String(err?.message ?? err) }, 503);
    }
  });

  // ── the hot path ──────────────────────────────────────────────────────────
  app.get(`/${API_VERSION}/verdict`, async (c) => {
    const fp = c.req.query('fp');
    if (!fp) {
      return c.json(apiError(ERROR_CODES.BAD_FINGERPRINT, 'no fp query parameter'), 400);
    }
    if (!isFingerprint(fp)) {
      return c.json(
        apiError(ERROR_CODES.BAD_FINGERPRINT, 'fp must match sxf1_ followed by 64 lowercase hex characters', {
          got: String(fp).slice(0, 80),
        }),
        400,
      );
    }

    const cached = cache.get(fp);
    if (cached?.fresh) {
      const head = cached.head ?? unknown(fp);
      telemetry.record(head);
      c.header('X-SureX-Cache', 'hit');
      c.header('Cache-Control', `public, max-age=${S(cached.head ? CACHE.positiveTtlMs : CACHE.negativeTtlMs)}`);
      return c.json(head);
    }

    let head;
    try {
      head = await store.getVerdictHead(fp);
      cache.set(fp, head ?? null);
    } catch (err) {
      // A cached BLOCKING head survives an unreachable registry (CACHE.flaggedGraceMs).
      if (cached && (cached.head?.state === 'flagged' || cached.head?.state === 'disputed')) {
        telemetry.staleServed += 1;
        telemetry.record(cached.head);
        c.header('X-SureX-Cache', 'stale');
        c.header('X-SureX-Stale-Age-Ms', String(cached.ageMs));
        c.header('Cache-Control', 'no-store');
        return c.json(cached.head);
      }
      // Never answer `unknown` because we failed to look — that would read as
      // "we checked and found nothing", and the gate fails open on its own.
      telemetry.upstreamErrors += 1;
      return upstream(c, String(err?.message ?? err).slice(0, 200));
    }

    const answer = head ?? unknown(fp);
    telemetry.record(answer);
    c.header('X-SureX-Cache', 'miss');
    c.header(
      'Cache-Control',
      `public, max-age=${S(head ? CACHE.positiveTtlMs : CACHE.negativeTtlMs)}, ` +
        `stale-while-revalidate=${S(CACHE.negativeTtlMs)}`,
    );
    return c.json(answer);
  });

  // ── the SessionStart prefetch ─────────────────────────────────────────────
  app.post(`/${API_VERSION}/verdicts/batch`, async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json(apiError(ERROR_CODES.INVALID_BODY, 'body must be JSON: { "fps": ["sxf1_…"] }'), 400);
    }
    const fps = body?.fps;
    if (!Array.isArray(fps)) {
      return c.json(apiError(ERROR_CODES.INVALID_BODY, 'fps must be an array of fingerprints'), 400);
    }
    if (fps.length > MAX_BATCH) {
      return c.json(
        apiError(ERROR_CODES.INVALID_BODY, `at most ${MAX_BATCH} fingerprints per batch`, { got: fps.length }),
        400,
      );
    }

    // Malformed entries are reported separately rather than failing the whole
    // prefetch: one bad row in a config should not cost the other nineteen their
    // verdicts. They are never silently turned into `unknown`.
    const invalid = [];
    const valid = [];
    for (const fp of fps) {
      if (isFingerprint(fp)) valid.push(fp);
      else invalid.push({ fp: typeof fp === 'string' ? fp.slice(0, 80) : String(fp), code: ERROR_CODES.BAD_FINGERPRINT });
    }

    let found;
    try {
      found = valid.length ? await store.getVerdictHeads(valid) : new Map();
    } catch (err) {
      telemetry.upstreamErrors += 1;
      return upstream(c, String(err?.message ?? err).slice(0, 200));
    }

    // One entry per requested (valid) fingerprint, in request order, misses included.
    const heads = valid.map((fp) => {
      const head = found.get(fp) ?? null;
      cache.set(fp, head);
      const answer = head ?? unknown(fp);
      telemetry.record(answer);
      return answer;
    });
    telemetry.batches += 1;

    c.header('Cache-Control', 'no-store');
    return c.json({
      requested: fps.length,
      heads,
      ...(invalid.length ? { invalid } : {}),
      ttlMs: { positive: CACHE.positiveTtlMs, negative: CACHE.negativeTtlMs },
    });
  });

  // ── history and evidence ──────────────────────────────────────────────────
  app.get(`/${API_VERSION}/entry/:fp`, async (c) => {
    const fp = c.req.param('fp');
    if (!isFingerprint(fp)) {
      return c.json(apiError(ERROR_CODES.BAD_FINGERPRINT, 'fp must match sxf1_ + 64 lowercase hex'), 400);
    }
    let entry;
    try {
      entry = await store.getEntry(fp);
    } catch (err) {
      return upstream(c, String(err?.message ?? err).slice(0, 200));
    }
    if (!entry) {
      return c.json(apiError(ERROR_CODES.NOT_FOUND, 'no registry entry for that fingerprint', { fingerprint: fp }), 404);
    }
    c.header('Cache-Control', `public, max-age=${S(CACHE.positiveTtlMs)}`);
    return c.json(entry);
  });

  /** source and review differ only in which entity type they will accept. */
  const recordRoute = (kind, read) =>
    app.get(`/${API_VERSION}/${kind}/:key`, async (c) => {
      const key = c.req.param('key');
      let record;
      try {
        record = await read(key);
      } catch (err) {
        return upstream(c, String(err?.message ?? err).slice(0, 200));
      }
      if (!record) {
        return c.json(
          apiError(ERROR_CODES.NOT_FOUND, `no ${kind} record with that key written by the SureX writer`, { key }),
          404,
        );
      }

      let evidence;
      if (c.req.query('evidence') === '1') {
        if (store.illustrative) {
          evidence = {
            fetched: false,
            reason: 'mock mode — no Walrus request was made. The record body below is fixture data.',
            illustrative: true,
          };
        } else if (record.evidence?.blobId) {
          // core does the fetch AND reports which checks actually ran, including
          // the blob-ID one it cannot run without an encoder. It never collapses
          // "asserted" into "passed".
          const loaded = await loadEvidence(record.evidence, {
            aggregators: env.SUREX_WALRUS_AGGREGATOR ? [env.SUREX_WALRUS_AGGREGATOR] : undefined,
          });
          evidence = loaded.ok
            ? { fetched: true, servedBy: loaded.servedBy, url: loaded.url, verification: loaded.verification, body: loaded.body }
            : { fetched: false, error: loaded.error, attempts: loaded.attempts };
        } else {
          evidence = { fetched: false, reason: 'this record carries no blob pointer' };
        }
      }

      c.header('Cache-Control', `public, max-age=${S(CACHE.positiveTtlMs)}`);
      return c.json({ [kind]: withLinks(record, env), ...(evidence ? { evidence } : {}) });
    });

  recordRoute('source', (key) => store.getSource(key));
  recordRoute('review', (key) => store.getReview(key));

  // ── the whole registry, for a browse page ─────────────────────────────────
  // Added because `/v1/flagged` is the wrong shape for browsing: seeded entries
  // are written `unknown` and never `clean`, so a flagged-only feed renders an
  // EMPTY registry as soon as seeding is what populates it — which reads as
  // "nothing here" rather than "nothing flagged".
  app.get(`/${API_VERSION}/registry`, async (c) => {
    const raw = Number(c.req.query('limit') ?? 200);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(1, Math.trunc(raw)), MAX_FLAGGED) : 200;
    const state = c.req.query('state') ?? null;
    if (state && !STATES.includes(state)) {
      return c.json(
        apiError(ERROR_CODES.INVALID_BODY, `unknown state "${state}". Known states: ${STATES.join(', ')}`),
        400,
      );
    }
    let listing;
    try {
      listing = await store.listRegistry({ limit, state });
    } catch (err) {
      return upstream(c, String(err?.message ?? err).slice(0, 200));
    }
    c.header('Cache-Control', 'public, max-age=60');
    return c.json({
      ...listing,
      note:
        'Every state, ordered by what stops a call first. `unknown` means nobody has submitted that exact ' +
        'install configuration for review — it is not a statement about the code. Seeded entries start ' +
        'unknown and are never written clean.',
    });
  });

  // ── the public feed ───────────────────────────────────────────────────────
  app.get(`/${API_VERSION}/flagged`, async (c) => {
    const raw = Number(c.req.query('limit') ?? 100);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(1, Math.trunc(raw)), MAX_FLAGGED) : 100;
    let feed;
    try {
      feed = await store.listFlagged({ limit });
    } catch (err) {
      return upstream(c, String(err?.message ?? err).slice(0, 200));
    }
    c.header('Cache-Control', 'public, max-age=60');
    return c.json({
      ...feed,
      note:
        'Both flagged and disputed are listed: a dispute changes what a user is told, it does not unblock ' +
        'anything. Every head states what was reviewed, when, by which model, and that no human audited it.',
    });
  });

  // ── the first number on the dashboard ─────────────────────────────────────
  app.get(`/${API_VERSION}/stats`, async (c) => {
    let registry = null;
    let registryError = null;
    try {
      registry = await store.stats();
    } catch (err) {
      registryError = String(err?.message ?? err).slice(0, 200);
    }

    // Registry hit rate first (failure-modes §3.1: the first number that should be
    // on the dashboard, and currently nowhere). It is REAL but narrow: what this
    // process observed since it started. On serverless that is one warm instance,
    // not the fleet — said here rather than quietly implied.
    const hitRate =
      telemetry.lookups > 0
        ? {
            value: Number((telemetry.hits / telemetry.lookups).toFixed(4)),
            hits: telemetry.hits,
            lookups: telemetry.lookups,
            scope: 'this API process only',
            since: telemetry.startedAt,
            note:
              'A hit is a lookup that resolved to a registry entry; a miss is the unknown head. Counted in ' +
              'memory, so it resets on restart and is not aggregated across instances. No persisted ' +
              'telemetry exists yet.',
          }
        : undefined;

    const body = {
      // omitted, not faked, when this process has served no lookups yet
      ...(hitRate ? { hitRate } : {}),
      lookupsByState: telemetry.lookups > 0 ? telemetry.byState : undefined,
      registry,
      ...(registryError ? { registryError } : {}),
      contract: { version: API_VERSION, frozenAt: CONTRACT_FROZEN_AT },
      mode: store.mode,
      omitted: [
        ...(hitRate ? [] : ['hitRate — no lookups served by this process yet']),
        'timeToBlock — not measured anywhere yet',
        'reviewsPerDay — the worker does not report it yet',
      ],
    };
    for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];

    c.header('Cache-Control', 'public, max-age=30');
    return c.json(body, registry ? 200 : 503);
  });

  // ── disputes: the AgentKit gate ───────────────────────────────────────────
  app.post(`/${API_VERSION}/disputes`, async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json(apiError(ERROR_CODES.INVALID_BODY, 'body must be JSON'), 400);
    }

    const fingerprint = body?.fingerprint ?? null;
    const verdictKey = body?.verdictKey ?? null;
    if (!fingerprint && !verdictKey) {
      return c.json(
        apiError(ERROR_CODES.INVALID_BODY, 'name what is being contested: fingerprint or verdictKey'),
        400,
      );
    }
    if (fingerprint && !isFingerprint(fingerprint)) {
      return c.json(apiError(ERROR_CODES.BAD_FINGERPRINT, 'fingerprint must match sxf1_ + 64 lowercase hex'), 400);
    }
    if (!body?.evidence && !body?.statement) {
      return c.json(
        apiError(ERROR_CODES.INVALID_BODY, 'a dispute needs evidence or a statement — an empty contest is not one'),
        400,
      );
    }

    // Who is contesting. An agent is identified by an explicit contestantType, a
    // signed AgentKit header, an agentAddress, or an x402 payment header.
    //
    // The AgentKit request header is `agentkit` — confirmed by reading
    // @worldcoin/agentkit@0.2.0, not inferred. It was missing from this list, so a
    // correctly signed agent with no `agentAddress` field in its JSON body was
    // classified as a HUMAN and refused for having no World ID proof. All request
    // headers are handed to the verifier, so the verifier never has to guess either.
    const headers = Object.fromEntries(c.req.raw.headers.entries());
    const agentAddress = body?.agentAddress ?? null;
    const looksLikeAgent = Boolean(
      agentAddress || headers[AGENTKIT_HEADER] || headers['x-payment'] || headers['payment'],
    );
    const contestantType = body?.contestantType ?? (looksLikeAgent ? 'agent' : 'human');
    if (contestantType !== 'agent' && contestantType !== 'human') {
      return c.json(apiError(ERROR_CODES.INVALID_BODY, "contestantType must be 'human' or 'agent'"), 400);
    }

    // There must be something to contest. A dispute against nothing is not a
    // dispute, and accepting one would let anyone create registry rows for free.
    if (fingerprint) {
      let head;
      try {
        head = await store.getVerdictHead(fingerprint);
      } catch (err) {
        return upstream(c, String(err?.message ?? err).slice(0, 200));
      }
      if (!head) {
        return c.json(
          apiError(ERROR_CODES.NOT_FOUND, 'no live verdict for that fingerprint, so there is nothing to contest', {
            fingerprint,
          }),
          404,
        );
      }
      body._headState = head.state;
    }

    // Shared shape for every refusal, so the caller always learns which verifier
    // refused and whether any check actually ran.
    const refusalDetails = (check) => ({
      verifier: verifiers.name,
      ...(verifiers.isStub ? { stub: true } : {}),
      ...(check?.detail ? { detail: check.detail } : {}),
      ...(check?.reason ? { reason: check.reason } : {}),
      ...(check?.challenge ? { challenge: check.challenge } : {}),
    });

    /**
     * A refusal is not automatically "no human stands behind this agent".
     *
     * `REFUSAL_STATUS` (verifiers.mjs) classifies the reasons that mean something
     * else, and anything unclassified keeps the path's original code — which is why
     * the stub's `verifier_not_wired` still produces the 403 it always has.
     *
     * The case this exists for: our RPC gets rate-limited mid-check. Reporting that
     * as `agent_not_human_backed` tells an honest, registered agent it is not
     * human-backed because OUR infrastructure was throttled. It is the worst thing
     * this route could say, and it is the default failure mode of the SDK.
     */
    const refuse = (check, fallbackCode, fallbackStatus, fallbackMessage) => {
      switch (REFUSAL_STATUS[check?.reason]) {
        case 'upstream':
          return c.json(
            apiError(
              ERROR_CODES.UPSTREAM_UNAVAILABLE,
              'the identity check could not be completed, so standing is UNKNOWN — this is not a refusal of the ' +
                'contestant. Retry.',
              refusalDetails(check),
            ),
            503,
          );
        case 'internal':
          return c.json(
            apiError(
              ERROR_CODES.INTERNAL,
              'this deployment is not configured to check identity for this path, so it cannot accept the dispute. ' +
                'That is our misconfiguration, not a judgement about the contestant.',
              refusalDetails(check),
            ),
            500,
          );
        case 'unauthenticated':
          return c.json(
            apiError(
              ERROR_CODES.UNAUTHENTICATED,
              'the request carried no usable proof of who is asking. That is a different claim from "no human ' +
                'stands behind this agent" — nothing has been decided about standing.',
              refusalDetails(check),
            ),
            401,
          );
        default:
          return c.json(apiError(fallbackCode, fallbackMessage, refusalDetails(check)), fallbackStatus);
      }
    };

    let check;
    if (contestantType === 'agent') {
      check = await verifiers.verifyAgentStanding({
        agentAddress,
        headers,
        body,
        path: `/${API_VERSION}/disputes`,
      });
      // THE AGENTKIT GATE. lookupHuman returned null → no human stands behind this
      // agent → no standing to dispute. This is the 403 the whole track fit rests
      // on, and it is the same code path whether the refusal comes from the stub
      // or from a real AgentBook lookup.
      if (!check?.ok || !check?.humanId) {
        return refuse(
          check,
          ERROR_CODES.AGENT_NOT_HUMAN_BACKED,
          403,
          'no human stands behind this agent, so it has no standing to contest a verdict. Register the ' +
            'agent wallet in AgentBook (one-time, by a human, in World App) and retry.',
        );
      }
    } else {
      check = await verifiers.verifyHumanProof({
        proof: body?.proof ?? body?.worldIdProof ?? null,
        action: WORLD_ACTIONS.dispute,
        signal: body?.signal ?? null,
        body,
        headers,
      });
      if (!check?.ok) {
        return refuse(
          check,
          ERROR_CODES.UNAUTHENTICATED,
          401,
          'a human dispute needs a World ID proof for action contest-verdict',
        );
      }
    }

    // The nullifier is spent only now that the dispute is accepted. Spending it on
    // a refused request would lock a real person out of a dispute they never filed.
    check.commit?.();

    // Accepted. A deterministic content id — NOT a chain key and not a tx digest,
    // because this process cannot write and will not hand back an identifier that
    // implies it did.
    const receivedAt = new Date().toISOString();
    const id =
      'sxd1_' +
      createHash('sha256')
        .update(
          JSON.stringify({
            fingerprint,
            verdictKey,
            contestantType,
            evidence: body?.evidence ?? null,
            statement: body?.statement ?? null,
          }),
        )
        .digest('hex')
        .slice(0, 32);

    c.header('Cache-Control', 'no-store');
    return c.json(
      {
        status: 'accepted',
        dispute: {
          id,
          fingerprint,
          verdictKey,
          contestantType,
          state: 'open',
          receivedAt,
          standing:
            contestantType === 'agent'
              ? {
                  humanId: check.humanId,
                  ...(check.agentAddress ? { agentAddress: check.agentAddress } : {}),
                  ...(check.network ? { agentBookNetwork: check.network } : {}),
                  ...(check.standing ? { proved: check.standing.proved, notProved: check.standing.notProved } : {}),
                }
              : {
                  nullifier: check.nullifier ?? null,
                  ...(check.action ? { action: check.action } : {}),
                  ...(check.uniqueness ? { uniqueness: check.uniqueness } : {}),
                },
        },
        // Say the enforcement consequence out loud so no client implements the
        // wrong one: a dispute changes the wording, never the block (tech spec §9).
        enforcement: 'unchanged — a disputed verdict still blocks; only a human overturn produces a clean head',
        headTransition: { from: body._headState ?? null, to: 'disputed', appliedBy: 'worker' },
        persisted: false,
        note:
          'Accepted, not stored. This API has no wallet: the worker writes the Dispute record as a Walrus ' +
          'blob and rewrites the head. Until it does, nothing about this submission exists on chain — no ' +
          'entity key and no transaction digest is returned because none exists.',
        verifier: { name: verifiers.name, stub: Boolean(verifiers.isStub) },
      },
      202,
    );
  });

  // ── the identity half is built; the ingest half is not ────────────────────
  //
  // The World ID gate runs FIRST and for real. A submission with no proof, a proof
  // for the wrong action, or a staging proof against a production deployment never
  // reaches the pipeline — which is the point of the gate, and is true today even
  // though the pipeline behind it does not exist yet.
  //
  // What is honestly NOT built: the repo-ownership proof, the licence gate, the
  // Walrus upload and the Arkiv write. Those need a wallet this process does not
  // have. So a VALID proof gets 501, not 202 — and the nullifier is deliberately
  // NOT spent, because nothing was queued and a person must not lose their one
  // submission to a pipeline that never ran.
  const NOT_BUILT =
    'POST /v1/submissions is in the frozen contract but is NOT built in this lane. The submission path ' +
    '(World ID + repo-ownership proof + licence gate + Walrus upload) belongs to the web/identity lane ' +
    'and needs a writer, which this process does not have.';

  app.post(`/${API_VERSION}/submissions`, async (c) => {
    // With no identity implementation wired in, "not built" is the whole truth and
    // validating a body before saying so would be theatre. Unchanged from before
    // the World lane existed, deliberately.
    if (verifiers.isStub) {
      return c.json(apiError(ERROR_CODES.UPSTREAM_UNAVAILABLE, NOT_BUILT, { built: false }), 501);
    }

    let body = null;
    try {
      body = await c.req.json();
    } catch {
      return c.json(apiError(ERROR_CODES.INVALID_BODY, 'body must be JSON: { repo, commit, proof }'), 400);
    }
    // A repo and a COMMIT. `release` used to be required here and is now the
    // optional half: a tag is a human-readable label for a commit, and it is the
    // commit that names bytes. Requiring the label rejected perfectly good
    // submissions of a default-branch head, and did it BEFORE the proof was
    // checked — so a submitter with a valid proof was told their body was
    // malformed for omitting something that identifies nothing.
    // Only the shape needed to run the gate. The commit is checked AFTER the
    // proof, by validateSubmission — identity first, then the submission's
    // content. Checking the commit here would refuse an anonymous request for
    // the wrong reason and reveal that we had read the body before the gate.
    if (!body?.repo) {
      return c.json(apiError(ERROR_CODES.INVALID_BODY, 'a submission names a repository'), 400);
    }

    const check = await verifiers.verifyHumanProof({
      proof: body?.proof ?? body?.worldIdProof ?? null,
      action: WORLD_ACTIONS.submit,
      signal: body?.signal ?? null,
      body,
      headers: Object.fromEntries(c.req.raw.headers.entries()),
    });
    if (!check?.ok) {
      const cls = REFUSAL_STATUS[check?.reason];
      const details = {
        verifier: verifiers.name,
        ...(verifiers.isStub ? { stub: true } : {}),
        ...(check?.detail ? { detail: check.detail } : {}),
        ...(check?.reason ? { reason: check.reason } : {}),
      };
      if (cls === 'internal') {
        return c.json(
          apiError(ERROR_CODES.INTERNAL, 'this deployment cannot check World ID personhood, so it cannot accept a submission', details),
          500,
        );
      }
      if (cls === 'upstream') {
        return c.json(
          apiError(ERROR_CODES.UPSTREAM_UNAVAILABLE, 'the World ID check could not be completed — unchecked, not rejected. Retry.', details),
          503,
        );
      }
      return c.json(
        apiError(
          ERROR_CODES.UNAUTHENTICATED,
          `a submission needs a World ID proof for action ${WORLD_ACTIONS.submit}, one per person`,
          details,
        ),
        401,
      );
    }

    // ── the proof checked out; hand it to the writer ────────────────────────
    //
    // This process still has no wallet, and that is the design: the ingest
    // service holds it, on the machine the reviewer already runs on. So the
    // submission is FORWARDED. Nothing below ever answers 202 unless the writer
    // said it accepted — a submit form that reports "queued" when nothing was
    // queued is the exact class of lie this registry exists to make impossible.
    const shape = validateSubmission(body);
    if (!shape.ok) {
      return c.json(apiError(ERROR_CODES.INVALID_BODY, shape.detail, { field: shape.code }), 400);
    }

    const identity = { action: check.action, checked: true, nullifierSpent: false, verifier: verifiers.name };
    const forwarded = await forwardSubmission(
      { ...shape, submissionId: check.nullifierHash ?? undefined },
      { env, fetchImpl: options.fetchImpl },
    );

    if (forwarded.kind === 'queued') {
      return c.json({
        accepted: true,
        submissionId: forwarded.id,
        repo: shape.repo,
        commit: shape.commit,
        release: shape.release,
        deduped: forwarded.deduped || undefined,
        queuePosition: forwarded.queuePosition ?? undefined,
        identity,
        // Said plainly: the review has NOT run yet, and the verdict may be that
        // nothing could be concluded. Queued is not a promise of a clean answer.
        note:
          'The release is queued for review. A verdict blob publishes to the index when the run completes, ' +
          'whatever it concludes.',
      }, 202);
    }

    if (forwarded.kind === 'unconfigured') {
      return c.json(
        apiError(
          ERROR_CODES.NOT_IMPLEMENTED,
          'World ID personhood checked out for this submission, and this deployment has no writer configured to ' +
            'take it: the review, the Walrus upload and the Arkiv write all need a wallet, which this process ' +
            'deliberately does not hold. Nothing was queued and no review will run.',
          { built: false, identity, missing: forwarded.missing },
        ),
        501,
      );
    }

    // Reachable and refused, or not reachable at all. Either way this is OUR
    // problem, and the submitter is told that rather than being left to think
    // their submission was rejected.
    return c.json(
      apiError(
        ERROR_CODES.UPSTREAM_UNAVAILABLE,
        'World ID personhood checked out, but the registry could not hand this submission to its writer. ' +
          'Nothing was queued. This is a fault in the registry, not in your submission — retry.',
        { built: true, identity, detail: forwarded.detail, ...(forwarded.status ? { upstreamStatus: forwarded.status } : {}) },
      ),
      503,
    );
  });

  /**
   * How a submission is going.
   *
   * Public and unauthenticated on purpose: the id is unguessable, it reveals only
   * what the submitter already knows, and requiring a credential would mean a
   * submit page that cannot show progress on the thing it just submitted.
   *
   * It names the model. A review takes minutes because a model reads the source
   * twice — four times when the two readings disagree — and a screen that hides
   * that behind an anonymous spinner is asking to be trusted rather than read.
   */
  app.get(`/${API_VERSION}/submissions/:id`, async (c) => {
    const status = await submissionStatus(c.req.param('id'), { env, fetchImpl: options.fetchImpl });

    if (status.kind === 'invalid') {
      return c.json(apiError(ERROR_CODES.INVALID_BODY, 'that is not a submission id'), 400);
    }
    if (status.kind === 'unconfigured') {
      return c.json(
        apiError(ERROR_CODES.NOT_IMPLEMENTED, 'this deployment has no writer configured, so it has no submissions to report on', {
          built: false, missing: status.missing,
        }),
        501,
      );
    }
    if (status.kind === 'unknown') {
      return c.json(apiError(ERROR_CODES.NOT_FOUND, 'no submission with that id'), 404);
    }
    if (status.kind !== 'ok') {
      return c.json(
        apiError(ERROR_CODES.UPSTREAM_UNAVAILABLE, 'the registry could not reach its writer to ask about this submission', {
          detail: status.detail ?? undefined,
        }),
        503,
      );
    }

    c.header('Cache-Control', 'no-store');
    return c.json({
      id: c.req.param('id'),
      status: status.status,
      queuePosition: status.queuePosition ?? undefined,
      startedAt: status.startedAt ?? undefined,
      durationMs: status.durationMs ?? undefined,
      reviewer: status.reviewer,
      // What the writer is doing right now — stage, a sentence, done/total, and
      // whatever that stage already knows (a blob id, a transaction hash). Absent
      // until the pipeline has said something, and never invented: a job that has
      // not started has no progress, and the queue position is what is true then.
      progress: status.progress ?? undefined,
      result: status.result ?? undefined,
      error: status.error ?? undefined,
      stage: status.stage,
      detail: status.detail,
      // A job the process died under may have written half of what it intended.
      // Whoever is watching needs that said, not smoothed over.
      interrupted: status.interrupted,
    });
  });

  // ── the demo-recovery control ─────────────────────────────────────────────
  const admin = mountAdmin(app, { env, logger, fetchImpl: options.fetchImpl, ...(options.admin ?? {}) });

  app.surex = { mode: store.mode, store, verifiers, cache, telemetry, admin, mock: store.illustrative === true };
  return app;
}

export default createApp;
