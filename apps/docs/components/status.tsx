/**
 * Every claim this site makes about WHAT IS BUILT, in one place.
 *
 * This module exists because of a measured failure, not a preference. The
 * dispute guide shipped saying SureX's own agent was not registered in
 * AgentBook — true when written, false the same afternoon, and the correction
 * had to be made in four files. The reference tables on this site cannot drift
 * because they are computed from `@surex/core`; status claims have no such
 * source, so they get the next best thing: one file to edit, and a test that
 * fails on the phrasings we have already had to retract.
 *
 * RULES FOR EDITING THIS FILE
 *
 * 1. A status line states what is true and how it was checked. Never "coming
 *    soon", never a date for something unshipped.
 * 2. When something moves from unbuilt to built, edit it HERE and nowhere else,
 *    then run `pnpm --filter @surex/docs test`.
 * 3. `verifiedOn` is the day the claims below were last checked against the
 *    live product — not the day the file was touched.
 *
 * The strings are plain text on purpose: `/llms.txt` prints them verbatim, and
 * a model reading them should get the same sentence a person does.
 */

/** The day these claims were last checked against the live product. */
export const VERIFIED_ON = '2026-07-25';

export const STATUS = {
  /** The agent dispute path — World AgentKit / AgentBook. */
  agentDispute:
    'Live, end to end, both ways, against the deployed API: a registered agent gets 202 with ' +
    'AgentBook standing and the head moves flagged → disputed — still blocking — while a wallet ' +
    "nobody registered gets an honest 403. SureX's own agent wallet is registered on World Chain " +
    '480; lookupHuman returns a non-zero human id for it.',

  /** The human dispute path — World ID. */
  humanDispute:
    'Built, and not provable on this deployment: it needs a World Developer Portal relying party. ' +
    'Until one is configured, every human dispute fails with an explicit configuration error that ' +
    'says it is our misconfiguration and not a judgement about the contestant. Never a pass.',

  /** POST /v1/submissions. */
  submissions:
    'The identity half is built and load-bearing; the ingest half is not. A valid World ID proof ' +
    'gets 501, not 202 — and the nullifier is deliberately not spent, so nobody loses their one ' +
    'lifetime submission to a pipeline that never ran.',

  /** What the registry actually contains. AGENTS.md §4 — never soften this one. */
  whatIsFlagged:
    'Every server flagged in the registry is a fixture the SureX project wrote itself. Nothing ' +
    "published is a claim about anyone else's code.",

  /** The chain, end to end. */
  chain:
    'The chain runs end to end with no mocks: DGX review → Walrus blob → Arkiv head → gate block → ' +
    'blob-ID recompute → override.',
} as const;

/**
 * Gaps stated rather than discovered. AGENTS.md: a submission that lists only
 * what it built is not telling you anything.
 */
export const KNOWN_GAPS = [
  '/v1/verdict responses are not signed. The gate makes an enforcement decision from an unsigned HTTP response — the largest knowingly-open gap in the design.',
  'A verdict covers a server’s own source, not its dependency tree — which is the actual npm attack pattern.',
  'Walrus storage renewal is unbuilt. Arkiv expiry and Walrus epochs are independent clocks, so a head can outlive the bytes it points at.',
  'Tier A for uvx, docker and git installs. npm dist.integrity is implemented; the others stay Tier B and are labelled as such rather than implied.',
] as const;

export function StatusLine({ of }: { of: keyof typeof STATUS }) {
  return <>{STATUS[of]}</>;
}

export function KnownGaps() {
  return (
    <ul>
      {KNOWN_GAPS.map((gap) => (
        <li key={gap}>{gap}</li>
      ))}
    </ul>
  );
}

export function VerifiedOn() {
  return <>{VERIFIED_ON}</>;
}
