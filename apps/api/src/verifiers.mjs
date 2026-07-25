// The identity seam. World integration is a SEPARATE LANE and does not live here.
//
// ════════════════════════════════════════════════════════════════════════════
// TODO(world-lane): implement this interface — `Verifiers` — against
// @worldcoin/idkit (human) and @worldcoin/agentkit (agent), and pass it into
// createApp({ verifiers }). Do NOT change the route, the state machine or the
// 403 path; they are owned by the API and already tested. Replace ONLY the two
// functions below.
//
//   interface Verifiers {
//     name: string                      // shows up in every response, so a stub is visible
//     isStub: boolean
//     verifyHumanProof({ proof, action, signal, body, headers })
//        → { ok, nullifier?, reason?, detail? }
//     verifyAgentStanding({ agentAddress, headers, body })
//        → { ok, humanId|null, reason?, detail? }
//   }
//
// The real implementations, per docs/surex-tech-spec.md §7:
//   human → POST https://developer.world.org/api/v4/verify/{app_id}, action
//            `contest-verdict`, signal hash(verdictKey + evidenceHash); store the
//            nullifier as decimal, nothing else about the person (NFR-4).
//   agent → createAgentBookVerifier({ rpcUrl }).lookupHuman(agentAddress).
//            Pass rpcUrl EXPLICITLY: the default is a shared public RPC and a
//            rate-limit throw looks exactly like a rejected agent (AGENTS.md §7).
//            A null result is 403 agent_not_human_backed — that is the gate.
// ════════════════════════════════════════════════════════════════════════════

export const STUB_DETAIL =
  'STUB VERIFIER — no identity check ran. This build of the API has no World integration wired in, so it ' +
  'refuses every dispute by design rather than accepting one it cannot check. Pass a real Verifiers ' +
  'implementation into createApp({ verifiers }) to enable disputes.';

/**
 * The default. Refuses everything, loudly, and says which of the two paths it
 * refused. Accepting a dispute we could not check would be the exact failure the
 * 403 exists to prevent, so the stub fails closed and never silently passes.
 */
export function createStubVerifiers({ logger = console } = {}) {
  let warned = false;
  const warnOnce = () => {
    if (warned) return;
    warned = true;
    logger.warn?.(`[surex-api] ${STUB_DETAIL}`);
  };

  return {
    name: 'stub',
    isStub: true,
    async verifyHumanProof() {
      warnOnce();
      return { ok: false, reason: 'verifier_not_wired', detail: STUB_DETAIL, stub: true };
    },
    async verifyAgentStanding() {
      warnOnce();
      // humanId null is precisely what lookupHuman returns for an agent no human
      // stands behind, so the route's 403 path is exercised for real by the stub.
      return { ok: false, humanId: null, reason: 'verifier_not_wired', detail: STUB_DETAIL, stub: true };
    },
  };
}

/**
 * Mock-mode only, opt-in with SUREX_MOCK_ACCEPT_DISPUTES=1.
 *
 * It exists so the web lane can build and demo the accept path standalone before
 * World is wired. It grants standing to nobody real: every result it returns is
 * marked illustrative, and it refuses outright unless mock mode is on.
 */
export function createIllustrativeVerifiers({ logger = console } = {}) {
  logger.warn?.(
    '[surex-api] ILLUSTRATIVE VERIFIERS ACTIVE (SUREX_MOCK=1 + SUREX_MOCK_ACCEPT_DISPUTES=1). ' +
      'No World ID proof and no AgentBook lookup happen. Every response is marked illustrative:true. ' +
      'Never enable this outside mock mode.',
  );
  return {
    name: 'illustrative',
    isStub: true,
    illustrative: true,
    async verifyHumanProof({ proof } = {}) {
      if (!proof) return { ok: false, reason: 'invalid_body', detail: 'no proof in the request body', illustrative: true };
      return { ok: true, nullifier: 'DEMO_nullifier_not_a_real_person', illustrative: true, stub: true };
    },
    async verifyAgentStanding({ agentAddress } = {}) {
      if (!agentAddress) {
        return { ok: false, humanId: null, reason: 'invalid_body', detail: 'no agentAddress in the request body', illustrative: true };
      }
      // Deliberate: an address ending in 0 is refused, so the 403 path stays
      // demonstrable in mock mode too. Not a rule — a fixture.
      if (/0$/.test(agentAddress)) {
        return {
          ok: false,
          humanId: null,
          reason: 'no_standing',
          detail: 'illustrative refusal — no human stands behind this agent',
          illustrative: true,
        };
      }
      return { ok: true, humanId: 'DEMO_humanId_not_a_real_person', illustrative: true, stub: true };
    },
  };
}

/** Which verifier set to use, given the environment. Stub unless told otherwise. */
export function resolveVerifiers({ env = process.env, logger = console } = {}) {
  const mock = env.SUREX_MOCK === '1';
  if (mock && env.SUREX_MOCK_ACCEPT_DISPUTES === '1') return createIllustrativeVerifiers({ logger });
  return createStubVerifiers({ logger });
}
