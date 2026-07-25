/**
 * Every user-facing string on the site, in one place.
 *
 * One place because the copy law is testable — `test/copy.test.mjs` walks this
 * object and runs every leaf through `copyViolations()` from `@surex/core`.
 * A banned word here fails the test instead of shipping.
 *
 * The law (AGENTS.md §4, PRD §6):
 *   - never *safe*, *trusted*, *verified*, *secure* about a reviewed server.
 *     The word is **reviewed**.
 *   - never *reputation* about anything agent-shaped. SureX reviews servers.
 *   - every verdict shown in full states what was reviewed (commit + blob ID),
 *     when, by which model and prompt version, and that no human audited it.
 *   - never imply the registry knows what is running on a user's machine.
 *
 * Deliberately free of imports: Node runs this file directly under type
 * stripping, so the test needs no build step.
 *
 * No counts live here. Numbers drift, and a hardcoded "214 reviewed" is a
 * fabrication the moment the registry disagrees — every count on the site is
 * derived from the rows actually rendered.
 */

export const COPY = {
  brand: {
    name: 'SUREX',
    tagline: 'trust registry for MCP servers',
    /** The one-line description of the mechanism, used in metadata. */
    description:
      'A public registry of automated reviews of MCP servers, and the linkage between what was reviewed and what you installed.',
  },

  nav: {
    registry: 'registry',
    submit: 'submit a server',
    skipToContent: 'Skip to content',
    themeToDark: 'switch to dark',
    themeToLight: 'switch to light',
    themeLabel: 'Theme',
  },

  /**
   * The illustrative banner. Hard rule, AGENTS.md §2 and §4: wherever a screen
   * renders data that is not a real review, it says so on that screen. This
   * text is the whole disclosure — it never gets shortened to a badge.
   */
  illustrative: {
    fixtureLabel: 'ILLUSTRATIVE DATA — LOCAL FIXTURES',
    fixtureBody:
      'The registry API is not reachable, so this page is rendering local fixtures. Every server, verdict, finding, blob ID and transaction digest below is placeholder content. Nothing here is a real review of a real MCP server.',
    mockLabel: 'ILLUSTRATIVE DATA — API MOCK MODE',
    mockBody:
      'The registry API answered with records it marked illustrative. Every record below is placeholder content, not a review of a real MCP server.',
    rowMarker: 'illustrative',
    rowMarkerTitle: 'This record is placeholder content, not a real review.',
  },

  browse: {
    title: 'Registry',
    lede: 'Absence of a verdict is absence of knowledge.',
    searchLabel: 'Search the registry',
    searchPlaceholder: 'name, fingerprint, capability…',
    searchSubmit: 'Search',
    filterState: 'STATE',
    filterTier: 'TIER',
    filterSort: 'SORT',
    sortByState: 'by state',
    sortByName: 'name',
    sortByRecent: 'recent',
    all: 'all',
    columnServer: 'SERVER',
    columnState: 'STATE',
    columnTier: 'TIER',
    columnStanding: 'STANDING',
    columnReviewed: 'REVIEWED',
    columnCapabilities: 'CAPABILITIES',
    emptyTitle: 'No entry matches that query.',
    emptyBody:
      'That is a fact about this registry, not about the code. An entry is missing until someone submits the release and a review runs.',
    emptyAction: 'Submit a server for review',
    meterLegend: 'tier meter: ▮▮▮ A digest match · ▮▮ B pinned · ▮ C unpinned or remote',
    rowsAreLinks: 'each row links to the evidence behind its verdict',
    countSuffix: 'shown',
  },

  /**
   * The stamp's impression line and its counter-stamp. Caps, because the stamp
   * is a stamp — but every one of these is a claim about linkage, so each says
   * exactly how strong the link is and nothing more.
   */
  stamp: {
    tierA: 'TIER A · RECORDED DIGEST MATCHES THE REVIEWED BLOB',
    tierB: 'TIER B · VERSION PINNED · BYTES NOT COMPARED',
    tierC: 'TIER C · NOTHING WAS CHECKED',
    tierMismatch: 'THE PUBLISHED ARTIFACT CHANGED AFTER THIS REVIEW',
    notInRegistry: 'NO ENTRY — NOTHING WAS REVIEWED',
    counterAutomated: 'AUTOMATED · NO HUMAN AUDIT',
    counterUncontested: 'UNCONTESTED',
    counterContested: 'CONTESTED · REBUTTAL ON FILE',
    counterEvidenceExpired: 'EVIDENCE NO LONGER RETRIEVABLE',
    superseded: 'SUPERSEDED',
  },

  /** `reason` on an unreviewable head, in words. */
  reasons: {
    licence: 'no licence permits us to store this source',
    'source-unavailable': 'the source could not be fetched at the named commit',
    'remote-endpoint': 'a remote endpoint — there is no local code to read',
  },

  verdict: {
    notFoundTitle: 'Not in the registry.',
    notFoundBody:
      'No entry exists for this fingerprint. That means nobody has submitted this exact install configuration for review — it does not mean the code is fine, and it does not mean it is not. The gate treats this as unknown and warns rather than stopping the call.',
    notFoundAction: 'Submit a server for review',
    summaryLabel: 'IN TWENTY SECONDS',
    linkageLabel: 'LINKAGE — WHAT THIS VERDICT IS ABOUT VS WHAT YOU INSTALLED',
    linkageNote:
      'the registry never sees your machine; the gate compares digests locally and keeps the answer there',
    reviewedBlob: 'REVIEWED BLOB',
    yourInstall: 'YOUR INSTALL',
    findingLabel: 'FINDING',
    findingsNoneLabel: 'FINDINGS',
    findingsNone:
      'None recorded. That is a statement about what the model saw, at that commit, at that time — read the capability surface below for what this code can reach. It is usually the more useful half.',
    couldBeWrongLabel: 'Could this be wrong?',
    couldBeWrongBody:
      'Yes. This is a model reading the code, not a human. If you believe it misreads the code, contest it with evidence — the rebuttal is shown beside it, with equal weight.',
    capabilityLabel: 'CAPABILITY SURFACE',
    capabilityNote:
      'what the reviewed code can reach, from a static scan that does not ask the server what it does. Shown on clean verdicts too.',
    capabilityAbsent: 'not present in the reviewed blob',
    provenanceLabel: 'PROVENANCE — WHAT WAS REVIEWED, WHEN, BY WHAT',
    provenanceCommit: 'COMMIT',
    provenanceReviewed: 'REVIEWED',
    provenanceSourceBlob: 'SOURCE BLOB',
    provenanceModel: 'MODEL',
    provenancePrompt: 'PROMPT',
    provenanceIndex: 'INDEX',
    provenanceIntegrity: 'INTEGRITY',
    provenanceUnknown: 'not recorded',
    /** The disclosure sentence. Appears on every verdict rendered in full. */
    automatedDisclosure:
      'This review was automated. No human audited this code. The model and prompt version above produced every word of the finding.',
    cleanMeansLabel: 'WHAT CLEAN MEANS HERE',
    disagreeLabel: 'DISAGREE WITH THIS VERDICT?',
    disagreeBody:
      'Anyone with standing can contest it — the maintainer, a user, or an agent that depends on this server. Rebuttals are stored as their own blob and shown beside the accusation with equal weight.',
    disagreeAction: 'File a dispute',
    overrideLabel: 'PROCEED ANYWAY',
    overrideBody:
      'Proceeding is your decision and your risk. SureX records nothing about your choice. The override is scoped to this fingerprint and version:',
    copy: 'copy',
    copied: 'copied',
    staleNote:
      'The gate passes calls to this server without comment while the verdict holds. When a newer release ships, this verdict goes stale until the new blob is reviewed.',
    accusationLabel: 'THE ACCUSATION',
    rebuttalLabel: 'THE REBUTTAL',
    bothStand: 'Both claims stand. Neither has been withdrawn or overruled.',
    followDispute: 'Follow the dispute',
  },

  dispute: {
    title: 'Dispute over',
    notFoundTitle: 'No dispute on file for this fingerprint.',
    notFoundBody:
      'Nothing has been contested here. If a verdict on this server misreads the code, that is the thing this page exists for.',
    openedBy: 'opened',
    stageOpen: 'OPEN',
    stageReview: 'UNDER REVIEW',
    stageUpheld: 'UPHELD',
    stageOverturned: 'OVERTURNED',
    stageOpenBody:
      'Rebuttal received and stored as its own blob. From this moment the verdict reads DISPUTED everywhere it appears, including in the terminal block.',
    stageReviewBody:
      'A fresh model pass on a different prompt lineage is reading the contested path, and the maintainer response window is open. Both claims stand until it closes; neither is hidden.',
    stageUpheldBody:
      'The flag stands. A second model pass and the maintainer window did not overturn the finding. The rebuttal remains on record with equal prominence — standing to disagree survives losing.',
    stageOverturnedBody:
      'The rebuttal held. A superseding verdict was written. The original verdict and this dispute remain on chain, permanently readable. The correction is as durable as the accusation.',
    fileLabel: 'FILE A DISPUTE — TWO KINDS OF STANDING, ONE BAR TO CLEAR',
    fileBody:
      'A wrongly-flagged server hurts the humans who wrote it and the agents that depend on it. Both can defend it here — the requirements differ, the weight of the rebuttal does not.',
    humanTitle: 'You are a person',
    humanBadge: 'WORLD ID',
    humanStep1:
      'Prove unique personhood with World ID — one human, one voice per dispute, so a rebuttal cannot be manufactured in bulk.',
    humanStep2: 'Write the rebuttal. Point at code: file, line, commit.',
    humanStep3:
      'Attach evidence — repo link, test, config. Stored as a blob, hashed, and linked from the index.',
    humanAction: 'Prove personhood with World ID',
    agentTitle: 'You are an agent',
    agentBadge: 'WORLD AGENTKIT',
    agentStep1: 'Authenticate with your AgentKit credential; your operator co-signs once.',
    agentStep2:
      'Your standing is legible: call volume through this server is read from your attestation, not asserted.',
    agentStep3: 'Submit the machine-readable rebuttal — same schema, same weight as a human wrote it.',
    agentAction: 'Authenticate agent',
    /** World track exclusion: never describe this as agent reputation. */
    standingNote:
      'Standing is a claim about calls this agent actually made through this server. It is not a score, and it is not about the agent — SureX reviews servers.',
    filedBy: 'filed by',
    evidence: 'evidence',
    onChain: 'on-chain',
    standing: 'standing',
  },

  submit: {
    title: 'Submit your server for review',
    lede:
      'Submission is consent to a public record. Whatever the review concludes, the verdict blob publishes to the index when the run completes — and you are told first, so a rebuttal can ship with it from hour zero.',
    stepHuman: 'Unique human',
    stepHumanNote: 'World ID — personhood proven',
    stepRepo: 'Repo control',
    stepRepoNote: '.well-known/surex.txt found at the repo root',
    stepRelease: 'Release picked',
    stepReleaseNote: 'one tag, one commit, one blob',
    stepReview: 'Review',
    stepReviewNote: 'three passes over the stored blob',
    formLabel: 'THE RELEASE TO REVIEW',
    repoLabel: 'Repository',
    repoPlaceholder: 'github.com/acme/acme-mcp',
    releaseLabel: 'Release tag',
    releasePlaceholder: 'v2.3.0',
    action: 'Queue the review',
    worldIdNote:
      'World ID personhood is not wired into this form yet, so the registry will refuse the submission — POST /v1/submissions requires a proof. The refusal is shown below exactly as the API sends it, rather than a screen pretending the submission went through.',
    resultAcceptedLabel: 'ACCEPTED',
    resultAcceptedBody:
      'The registry queued the release. A verdict blob publishes to the index when the run completes.',
    resultRefusedLabel: 'REFUSED BY THE REGISTRY',
    resultUnreachableLabel: 'REGISTRY UNREACHABLE',
    resultUnreachableBody:
      'Nothing was submitted. Whatever you typed stayed in this browser — the request never left it.',
    resultMissingLabel: 'INCOMPLETE',
    resultMissingBody: 'A repository and a release tag are both needed before anything is fetched.',
    whatHappensLabel: 'WHAT HAPPENS TO YOUR CODE',
    whatHappens1:
      'The release is fetched at the commit you name and normalised — sorted paths, zeroed timestamps — so two people submitting the same release produce the same bytes.',
    whatHappens2:
      'Those bytes are written to Walrus as a content-addressed blob and the blob is certified on Sui. The review is about that blob, and the blob does not change afterwards.',
    whatHappens3:
      'An open-source model reads the code against what your server says it does. The finding, the model ID and the prompt version are written as their own blob and indexed on Arkiv.',
    whatHappens4:
      'A licence that does not permit redistribution stops the process before anything is stored. Unmatched licences are treated as ineligible.',
    outcomeLabel: 'IF THE REVIEW FINDS SOMETHING',
    outcomeBody:
      'Not a judgement of you or your work — a model reading of one code path, written down where you can answer it.',
    outcomeIsLabel: 'What this is',
    outcomeIs:
      'automated, with no human reading your code · about one blob and one commit only · already on the public index',
    outcomeIsNotLabel: 'What it is not',
    outcomeIsNot:
      'not a claim that you are malicious — the verdict says what the code can do · not final, because rebuttals show with equal weight, forever · not a takedown, because nothing is delisted or deleted',
    answerTitle: 'Answer it — file a rebuttal',
    answerBody:
      'If the model misread the path, say so with file and line. Shown beside the finding, same size, same permanence.',
    fixTitle: 'Fix it — resubmit a release',
    fixBody:
      'A new release gets a fresh review. If it comes back clean, this verdict is superseded — it stays readable, marked as answered by the newer version.',
    leaveTitle: 'Leave it — it may be intended',
    leaveBody:
      'Some servers legitimately need broad access. A shell-execution server is flagged and stays flagged; the finding simply remains visible.',
    windowNote:
      'Maintainer window: a verdict reads unconfirmed — maintainer notified — for 72 hours before confirmation can begin. Protection is never delayed; only the wording changes.',
  },

  banners: {
    unreachableLabel: 'REGISTRY UNREACHABLE',
    unreachableBody:
      'The registry API did not answer. The gate fails open with a warning; it never silently blocks, and never silently clears something it had already flagged.',
    supersededLabel: 'SUPERSEDED',
    supersededBody:
      'This verdict was replaced. It remains on record and on chain — verdicts are superseded, never deleted.',
    evidenceExpiredLabel: 'EVIDENCE EXPIRED',
    evidenceExpiredBody:
      'The source blob behind this verdict is no longer retrievable. The finding stands as a historical record but can no longer be re-derived from evidence, so linkage is downgraded to C.',
    reviewRunningLabel: 'REVIEW RUNNING',
    reviewRunningBody:
      'A verdict blob will be written when the run completes. Nothing is asserted until then.',
  },

  states: {
    clean: 'clean',
    flagged: 'flagged',
    disputed: 'disputed',
    stale: 'stale',
    unreviewable: 'unreviewable',
    unknown: 'unknown',
    running: 'review running',
  },

  stateMeaning: {
    clean: 'Reviewed; no mismatch found between stated purpose and code, at the commit and time stated.',
    flagged: 'Reviewed; a mismatch or a malicious pattern was found. The gate stops the call, and you can override it.',
    disputed: 'Flagged, and contested with evidence. Still stops the call — both claims are shown.',
    stale: 'An entry exists, but a newer release landed than the one reviewed. The gate warns.',
    unreviewable: 'The source could not be read or could not be stored. The gate warns.',
    unknown: 'Not in the registry. The gate warns and the call proceeds.',
  },

  confidence: {
    unconfirmed: 'automated only — no human audit',
    confirmed: 'uncontested',
    disputed: 'rebuttal on file — both claims stand',
  },

  footer: {
    sourceBlobs: 'source blobs: Walrus on Sui',
    verdictIndex: 'verdict index: Arkiv',
    personhood: 'personhood: World ID',
    agentIdentity: 'agent identity: World AgentKit',
    permanence: 'verdicts are superseded, never deleted',
  },

  errors: {
    badFingerprint: 'That is not a fingerprint this registry can read.',
    badFingerprintBody:
      'A SureX fingerprint looks like sxf1_ followed by 64 hexadecimal characters. It is computed from the install configuration, not from the server name.',
  },
} as const;

export type Copy = typeof COPY;
