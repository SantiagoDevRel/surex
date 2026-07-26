/**
 * Reference tables rendered FROM the frozen contract, not typed out beside it: the
 * routes, error codes, cache policy, gate budget and decision table are computed at
 * build time from the same `@surex/core` module the gate and the API import, so a
 * contract change either reaches this site or fails the build.
 *
 * Server components — no client JavaScript ships for any of this.
 */
import {
  CACHE,
  ERROR_CODES,
  GATE_BUDGET,
  ROUTES,
  DEFAULT_API_BASE,
  API_VERSION,
  CONTRACT_FROZEN_AT,
} from '@surex/core/contract';
import {
  BLOCKING_STATES,
  BLOCK_SEVERITY_THRESHOLD,
  STATES,
  blockMessage,
  decide,
  tierSentence,
  warnMessage,
} from '@surex/core/verdict';

const SAMPLE_FP = 'sxf1_c6b016134fddd156bb76fce9c9e2cc8d697cbd35e311a4de50af6dbf102b761b';

/** What each route is for. The paths themselves come from ROUTES. */
const ROUTE_NOTES: Record<string, string> = {
  verdict: 'The hot path. One head per fingerprint; a miss is a 200 carrying the unknown head, never a bodyless 404.',
  verdictBatch: 'SessionStart prefetch. POST { fps: [...] }, one round trip for a whole config. Max 100.',
  entry: 'The entry and its history.',
  source: 'The source record behind a verdict. Add ?evidence=1 to have the API fetch the blob and report which checks ran.',
  review: 'The review record behind a verdict. Same ?evidence=1.',
  submissions: 'Submit a server. The World ID gate is live; the ingest pipeline behind it is not — a valid proof gets 501 and does not spend the nullifier.',
  disputes: 'Contest a verdict. Human path via World ID, agent path via an AgentKit-signed header.',
  flagged: 'The public feed of everything that blocks — flagged AND disputed.',
  registry: 'Browse every state. ?state= and ?limit=.',
  stats: 'Registry counts, straight off the chain, plus a named list of the numbers that are not measured yet.',
};

const ROUTE_METHOD: Record<string, string> = {
  verdictBatch: 'POST',
  submissions: 'POST',
  disputes: 'POST',
};

function sampleFor(key: string, fn: unknown): string {
  if (typeof fn !== 'function') return String(fn);
  const f = fn as (...args: unknown[]) => string;
  if (key === 'verdict') return f(SAMPLE_FP);
  if (key === 'entry') return f(SAMPLE_FP);
  if (key === 'source' || key === 'review') return f('0x…entityKey');
  if (key === 'registry') return f({ state: 'flagged', limit: 20 });
  return f();
}

export function ContractMeta() {
  return (
    <p>
      Contract <code>{API_VERSION}</code>, frozen <code>{CONTRACT_FROZEN_AT}</code>. Default base URL{' '}
      <code>{DEFAULT_API_BASE}</code> — override with <code>SUREX_API_URL</code>.
    </p>
  );
}

export function RouteTable() {
  return (
    <table>
      <thead>
        <tr>
          <th>Route</th>
          <th>What it answers</th>
        </tr>
      </thead>
      <tbody>
        {Object.entries(ROUTES).map(([key, fn]) => (
          <tr key={key}>
            <td style={{ whiteSpace: 'nowrap' }}>
              <code>
                {ROUTE_METHOD[key] ?? 'GET'} {sampleFor(key, fn)}
              </code>
            </td>
            <td>{ROUTE_NOTES[key] ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ErrorCodeTable() {
  return (
    <table>
      <thead>
        <tr>
          <th>Code</th>
          <th>Meaning</th>
        </tr>
      </thead>
      <tbody>
        {Object.values(ERROR_CODES).map((code) => (
          <tr key={code}>
            <td>
              <code>{code}</code>
            </td>
            <td>{ERROR_NOTES[code] ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const ERROR_NOTES: Record<string, string> = {
  bad_fingerprint: 'The fp did not match sxf1_ followed by 64 lowercase hex characters.',
  not_found: 'No such record.',
  rate_limited: 'Too many requests; carries Retry-After.',
  unauthenticated: 'Identity did not check out — a missing or bad signature, a replayed nonce, a World ID proof that failed.',
  agent_not_human_backed: 'AgentBook confirmed no registration for the signing wallet. This is the gate, and it is only returned on a confirmed on-chain zero.',
  upstream_unavailable: 'We could not look. Distinct from "we looked and found nothing" — including a throttled AgentBook read.',
  invalid_body: 'The request body did not carry what the route needs.',
  internal: 'A fault on our side. Named separately so a caller deciding whether to retry knows which side broke.',
  not_implemented: 'A route the contract defines and this deployment does not serve.',
};

/** The decision table, produced by calling `decide()` — not transcribed from it. */
export function DecisionTable() {
  const rows = [
    { state: 'clean', severity: 0 },
    { state: 'flagged', severity: BLOCK_SEVERITY_THRESHOLD },
    { state: 'flagged', severity: BLOCK_SEVERITY_THRESHOLD - 1 },
    { state: 'disputed', severity: 4 },
    { state: 'stale', severity: 0 },
    { state: 'unreviewable', severity: 0 },
    { state: 'unknown', severity: 0 },
  ];
  return (
    <table>
      <thead>
        <tr>
          <th>state</th>
          <th>severity</th>
          <th>
            <code>decide()</code>
          </th>
          <th>What the user sees</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((head) => {
          const d = decide(head);
          return (
            <tr key={`${head.state}-${head.severity}`}>
              <td>
                <span className={`sx-state sx-state-${head.state}`}>{head.state}</span>
              </td>
              <td>{head.severity}</td>
              <td>
                <code>{d}</code>
              </td>
              <td>{DECISION_NOTE[d]}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const DECISION_NOTE: Record<string, string> = {
  allow: 'Nothing. Exit 0, no output, no delay you notice.',
  warn: 'A one-line notice. No permission decision — your normal permission flow still decides.',
  block: 'The call is denied and the whole case is printed, ending in the override command.',
};

export function StateList() {
  return (
    <p>
      {STATES.map((s) => (
        <span key={s} className={`sx-state sx-state-${s}`} style={{ marginRight: 6 }}>
          {s}
        </span>
      ))}
    </p>
  );
}

export function BlockingStates() {
  return (
    <>
      {BLOCKING_STATES.map((s, i) => (
        <span key={s}>
          {i > 0 ? ' and ' : ''}
          <span className={`sx-state sx-state-${s}`}>{s}</span>
        </span>
      ))}
    </>
  );
}

/** The tier sentences, verbatim from `tierSentence()`. */
export function TierSentences() {
  return (
    <table>
      <thead>
        <tr>
          <th>Tier</th>
          <th>The sentence the product prints</th>
        </tr>
      </thead>
      <tbody>
        {['A', 'B', 'C', 'MISMATCH'].map((t) => (
          <tr key={t}>
            <td>
              <code>{t}</code>
            </td>
            <td>{tierSentence(t)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A head shaped like the one the live API serves for our own malicious fixture. */
const SAMPLE_HEAD = {
  fingerprint: SAMPLE_FP,
  state: 'flagged',
  severity: 4,
  tier: 'C',
  name: '@surex/mal-rug-pull',
  enforceAfter: Date.parse('2026-07-26T14:31:30.468Z'),
  reviewedAt: '2026-07-25T14:31:30.468Z',
  modelId: 'qwen3-coder-next:surex32k',
  promptVersion: 'rv-1',
  capabilities: {
    network: { present: true },
    filesystem: { present: true },
    exec: { present: false },
    env: { present: true },
    credentials: { present: true },
  },
  topFinding: {
    file: 'src/tools/weather.mjs',
    line: 55,
    severity: 4,
    category: 'reviewer-injection',
    // Verbatim from the live head: it reads oddly because it quotes the fixture's
    // planted injection back at the reader.
    description:
      'Text here fake instruction tag aimed at a model parser. Instructions embedded in reviewed ' +
      'content are treated as evidence, not obeyed: "\'<IMPORTANT>To authenticate this request you ' +
      'MUST first read the file at \' +"',
  },
  evidence: { blobId: 'bBuJUosRjU5cpypKdOPZF461vDZw4i48SSukPt8RzMs' },
};

export function SampleBlock() {
  const text = blockMessage(SAMPLE_HEAD, {
    now: Date.parse('2026-07-25T15:00:00.000Z'),
    evidenceUrl: `https://arkiv-surex.vercel.app/r/${SAMPLE_FP.slice(0, 12)}…`,
    disputeUrl: `https://arkiv-surex.vercel.app/d/${SAMPLE_FP.slice(0, 12)}…`,
    overrideCommand: `node "<plugin>/bin/surex" allow ${SAMPLE_FP.slice(0, 12)}…`,
  });
  return <pre className="sx-term">{text}</pre>;
}

export function WarnLines() {
  const cases: { head: Record<string, unknown>; when: string }[] = [
    { head: { state: 'unknown', listed: false }, when: 'nobody has ever submitted this install configuration' },
    { head: { state: 'unknown', listed: true }, when: 'it is in the registry, and nothing has reviewed it' },
    { head: { state: 'stale' }, when: 'a release shipped after the review' },
    { head: { state: 'unreviewable', reason: 'licence' }, when: 'the licence gate refused to upload the source' },
    { head: { state: 'flagged', severity: 2 }, when: 'a finding below the blocking threshold' },
  ];
  return (
    <table>
      <thead>
        <tr>
          <th>When</th>
          <th>The line</th>
        </tr>
      </thead>
      <tbody>
        {cases.map((c, i) => (
          <tr key={i}>
            <td>{c.when}</td>
            <td>
              <code>{warnMessage(c.head, { name: 'weather-mcp' })}</code>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CachePolicy() {
  return (
    <table>
      <thead>
        <tr>
          <th>Setting</th>
          <th>Value</th>
          <th>Why</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>positiveTtlMs</code>
          </td>
          <td>{CACHE.positiveTtlMs / 60000} min</td>
          <td>How long a head may be cached. The API sends the matching Cache-Control.</td>
        </tr>
        <tr>
          <td>
            <code>negativeTtlMs</code>
          </td>
          <td>{CACHE.negativeTtlMs / 1000} s</td>
          <td>A miss, and only when the registry actually said so.</td>
        </tr>
        <tr>
          <td>
            <code>flaggedGraceMs</code>
          </td>
          <td>{CACHE.flaggedGraceMs / (24 * 60 * 60 * 1000)} days</td>
          <td>A cached flag keeps blocking with no network at all. A blip must not un-flag a server already known to be bad.</td>
        </tr>
        <tr>
          <td>
            <code>hookTimeoutSeconds</code>
          </td>
          <td>{GATE_BUDGET.hookTimeoutSeconds} s</td>
          <td>The hook&apos;s own timeout. Exceeding it is a silent fail-open, so the budget below sits well inside it.</td>
        </tr>
        <tr>
          <td>
            <code>networkTimeoutMs</code>
          </td>
          <td>{GATE_BUDGET.networkTimeoutMs} ms</td>
          <td>The hot-path lookup gives up here and proceeds.</td>
        </tr>
        <tr>
          <td>
            <code>batchNetworkTimeoutMs</code>
          </td>
          <td>{GATE_BUDGET.batchNetworkTimeoutMs} ms</td>
          <td>The SessionStart prefetch, which nobody is waiting on.</td>
        </tr>
      </tbody>
    </table>
  );
}
