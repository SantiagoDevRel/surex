/**
 * /llms.txt — the whole product as one flat file, for a model with no navigation.
 *
 * Generated rather than written: the states, the decision outcomes, the routes,
 * the cache policy, the banned words and the install prompts all come from the
 * same modules the gate and the API import, so this file cannot describe a
 * contract that no longer exists.
 */
import { CACHE, DEFAULT_API_BASE, GATE_BUDGET, ROUTES } from '@surex/core/contract';
import { CLEAN_MEANS, NO_HUMAN_AUDIT } from '@surex/core/copy';
import { BLOCK_SEVERITY_THRESHOLD, BLOCKING_STATES, STATES, decide, tierSentence } from '@surex/core/verdict';

import { PROMPTS } from '../../components/prompts';
import { KNOWN_GAPS, STATUS, VERIFIED_ON } from '../../components/status';

export const dynamic = 'force-static';

const FP = 'sxf1_c6b016134fddd156bb76fce9c9e2cc8d697cbd35e311a4de50af6dbf102b761b';

function decisionLines() {
  const rows: { state: string; severity: number }[] = [
    { state: 'clean', severity: 0 },
    { state: 'flagged', severity: BLOCK_SEVERITY_THRESHOLD },
    { state: 'flagged', severity: BLOCK_SEVERITY_THRESHOLD - 1 },
    { state: 'disputed', severity: 4 },
    { state: 'stale', severity: 0 },
    { state: 'unreviewable', severity: 0 },
    { state: 'unknown', severity: 0 },
  ];
  return rows.map((h) => `  ${h.state.padEnd(14)} severity ${h.severity}  -> ${decide(h)}`).join('\n');
}

function routeLines() {
  const method: Record<string, string> = { verdictBatch: 'POST', submissions: 'POST', disputes: 'POST' };
  return Object.entries(ROUTES)
    .map(([key, fn]) => {
      const f = fn as (...a: unknown[]) => string;
      const path =
        key === 'verdict' || key === 'entry'
          ? f(FP)
          : key === 'source' || key === 'review'
            ? f('<entityKey>')
            : key === 'registry'
              ? f({ state: 'flagged', limit: 20 })
              : f();
      return `  ${(method[key] ?? 'GET').padEnd(5)} ${path}`;
    })
    .join('\n');
}

const BODY = `# SureX

> A trust registry for MCP servers, and a Claude Code plugin that reads it. Before your agent
> calls any MCP tool, a PreToolUse hook looks the server up. Reviewed with nothing found: the
> call proceeds silently. Flagged: the call is BLOCKED, the evidence is shown, and one command
> lets the user proceed anyway. Unknown, stale or registry unreachable: a notice, and the normal
> permission flow decides.

Docs:      https://surex-docs.vercel.app
Registry:  https://arkiv-surex.vercel.app/registry
API:       ${DEFAULT_API_BASE}
Source:    https://github.com/SantiagoDevRel/surex
Licence:   MIT

## Install

  /plugin marketplace add SantiagoDevRel/surex
  /plugin install surex@surex

No npm install step. The gate has zero runtime dependencies. Plugin hooks run UNSANDBOXED with
the user's permissions — say so before installing, and show the trust prompt rather than
clicking past it.

Registers: a PreToolUse hook (matcher "mcp__.*", 10 s timeout), a SessionStart prefetch hook,
a /surex slash command, and bin/surex.

NOTE: a plugin's bin/ does NOT join PATH on a marketplace install (measured, Claude Code
2.1.220). Invoke as: node "\${CLAUDE_PLUGIN_ROOT}/bin/surex" <args>, or use /surex <args>.

## The two axes — do not merge them into one score

VERDICT — what the review found, from the source:
  ${STATES.join(' · ')}

TIER — whether the reviewed bytes are the bytes the user will run, from their install config:
  A  ${tierSentence('A')}
  B  ${tierSentence('B')}
  C  ${tierSentence('C')}
  MISMATCH  ${tierSentence('MISMATCH')}

They are INDEPENDENT. A flagged Tier C verdict is a real finding about real code with no link
to the user's copy; both halves are true and neither cancels the other. Tier C is the normal
case today, because the ecosystem convention is "npx -y pkg@latest" and an unpinned version
cannot be linked to anything.

## The decision

${BLOCKING_STATES.join(' and ')} both BLOCK, at severity >= ${BLOCK_SEVERITY_THRESHOLD}. A dispute changes the wording of the
block, never the enforcement; only a human overturn produces a clean head.

${decisionLines()}

"unknown" is the absence of an entry, not a pass. The API returns it as a 200 body so the gate
always has something to decide from. A 503 means the registry could not look, which is a
different fact from having looked and found nothing — never report it as "not reviewed".

## Failure posture

Fail open, never fail unsafe. Every failure path proceeds and says so, with one exception: a
cached flagged/disputed head keeps blocking with no network at all, for up to
${CACHE.flaggedGraceMs / 86400000} days.

- A hook that returns permissionDecision "allow" GRANTS the call. The warn path therefore emits
  systemMessage alone and NO decision field — emitting "allow" would auto-approve exactly the
  servers SureX knows nothing about.
- A malformed response degrades to unknown, NEVER to clean.
- A miss may only be cached when the registry actually said so.
- A hook that exceeds its timeout is killed and the call proceeds silently. Anything that makes
  the gate slow disables enforcement; there is no fail-closed opt-in.

Budget: hook timeout ${GATE_BUDGET.hookTimeoutSeconds} s · hot-path network ${GATE_BUDGET.networkTimeoutMs} ms · batch ${GATE_BUDGET.batchNetworkTimeoutMs} ms ·
positive TTL ${CACHE.positiveTtlMs / 60000} min · negative TTL ${CACHE.negativeTtlMs / 1000} s.

## Stating a verdict — binding on anything that surfaces one

Every verdict repeated in full must state what was reviewed (commit + evidence blob id), when,
by which model, at which prompt version, and: "${NO_HUMAN_AUDIT}"

What clean means, in full: ${CLEAN_MEANS}

Never imply the registry knows what is running on a machine unless the tier is A. Never present
the override as the recommended next step; state that the risk transfers to the user.

## The identity: SXF-1

sha256 over a canonicalised install configuration, prefixed sxf1_. Computed from configuration
ON DISK ONLY — the gate never runs or connects to an MCP server to identify it, which is what
makes the SessionStart prefetch possible at all.

Dropped: runner ceremony (-y, --yes, -q), transient flags (--port, --debug, --verbose,
--log-level, --cwd) with their values, and environment variable values. A version counts as
pinned only if it names exactly one artifact. A locally-run script is identified by the CONTENT
of its entry file, so the path is not part of the identity.

  import { canonicalise, fingerprintOf } from '@surex/core/sxf1';
  fingerprintOf(canonicalise({ command: 'npx', args: ['-y', '@acme/mcp@2.1.0'] }));

## API — public, unauthenticated, read-only

Base: ${DEFAULT_API_BASE}   (override with SUREX_API_URL)

${routeLines()}

GET /v1/verdict returns the head shape itself as the body. Errors are always
{ error: { code, message, ... } }. /v1/flagged returns flagged AND disputed — a mirror that
takes only flagged silently stops enforcing everything anyone has contested.

Example:
  curl -s "${DEFAULT_API_BASE}${ROUTES.verdict(FP)}"

## CLI

  surex list                  every configured server, its fingerprint, its verdict
  surex why <fingerprint>     the full case, incl. the evidence fetched from Walrus and checked
  surex allow <fingerprint>   proceed anyway, at the user's own risk. --once = this session
  surex revoke <fingerprint>  undo an allow
  surex check [name]          what a server fingerprints to, and why
  surex status                where state lives, what is cached, the registry hit rate

## Evidence

A verdict body is written to Walrus (content-addressed, register + certify = 2 Sui
transactions); a compact head pointing at it is written to Arkiv on Braga, and that head is the
only thing the gate reads on the hot path. When the gate blocks it fetches the blob, checks
sha256 against the record, and RECOMPUTES the Walrus blob id locally with a vendored encoder —
a blob id is not sha256(bytes). Each check reports passed / failed / asserted / unavailable, and
"asserted" is not a pass. A failed check does not unblock anything.

Every consumer read is filtered by .createdBy(<the one writer address>), never ownedBy —
ownership is transferable, so ownedBy is attacker-influenceable.

## Copy-paste prompt — install

${PROMPTS.install}

## Copy-paste prompt — check that it blocks

${PROMPTS.verify}

## Honest status  (checked against the live product on ${VERIFIED_ON})

Built at ETHGlobal Lisbon 2026. ${STATUS.chain}

${STATUS.whatIsFlagged}
Live counts: ${DEFAULT_API_BASE}${ROUTES.stats()}

Agent disputes:  ${STATUS.agentDispute}

Human disputes:  ${STATUS.humanDispute}

Submissions:     ${STATUS.submissions}

Known gaps, stated rather than discovered:
${KNOWN_GAPS.map((g) => `  - ${g}`).join('\n')}

## Pages

  /                            overview + the gate decision flow
  /quickstart                  one paste to a real block from the live registry
  /concepts/verdict-and-tier   the two independent axes — read this first
  /concepts/verdict-states     the six states and the decision function
  /concepts/failure-posture    fail open, never fail unsafe
  /concepts/fingerprint        SXF-1
  /concepts/evidence-chain     review -> Walrus -> Arkiv -> the gate
  /guides/install              what gets installed, where state lives
  /guides/read-a-verdict       the block message line by line
  /guides/submit-a-server      submission, and what is built today
  /guides/dispute-a-verdict    World ID and AgentBook standing
  /reference/api               the frozen /v1 contract
  /reference/cli               the surex command
  /reference/architecture      where everything runs
  /agent                       this file, as a page
`;

export function GET() {
  return new Response(BODY, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
