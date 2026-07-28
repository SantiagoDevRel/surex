/**
 * Every user-facing string on the site, in one place — testable, since
 * `test/copy.test.mjs` walks this object through `copyViolations()`.
 *
 * The law (AGENTS.md §4, PRD §6):
 *   - never *safe*, *trusted*, *verified*, *secure* about a reviewed server.
 *     The word is **reviewed**.
 *   - never *reputation* about anything agent-shaped. SureX reviews servers.
 *   - every verdict shown in full states what was reviewed (commit + blob ID),
 *     when, by which model and prompt version, and that no human audited it.
 *   - never imply the registry knows what is running on a user's machine.
 *
 * Deliberately free of imports, so the test needs no build step.
 *
 * No counts live here — every count on the site is derived from the rows
 * actually rendered.
 */

export const COPY = {
  brand: {
    name: 'SUREX',
    tagline: 'trust registry for MCP servers',
    /** The one-line description of the mechanism, used in metadata. */
    description:
      'A public registry of automated reviews of MCP servers, and the linkage between what was reviewed and what you installed.',
    /** Named once. The chrome links it and the docs quote it. */
    repoUrl: 'https://github.com/SantiagoDevRel/surex',
  },

  /** The chrome, on every route. Lowercase throughout — the wordmark is the only thing on the row entitled to shout. */
  nav: {
    home: 'home',
    registry: 'registry',
    submit: 'submit an mcp',
    docs: 'docs',
    github: 'github',
    /** Styled as an action, not a destination: it's the one thing here that changes something on the visitor's machine. */
    install: 'install plugin',
    installTitle: 'Install the SureX gate into Claude Code: two slash commands, no npm install',
    skipToContent: 'Skip to content',
  },

  /** Hard rule (AGENTS.md §2, §4): wherever a screen renders non-real data, it says so. This banner is the whole disclosure, never shortened to a badge. */
  illustrative: {
    fixtureLabel: 'ILLUSTRATIVE DATA · LOCAL FIXTURES',
    fixtureBody:
      'The registry API is not reachable, so this page is rendering local fixtures. Every server, verdict, finding, blob ID and transaction digest below is placeholder content. Nothing here is a real review of a real MCP server.',
    mockLabel: 'ILLUSTRATIVE DATA · API MOCK MODE',
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

    /**
     * The default list is filtered, and the page says so: the count held
     * back is printed, broken down by state, next to a link that brings it all
     * back. No number lives in any of these strings — every count is derived
     * from the rows the page actually received.
     */
    viewDecided: 'with a verdict',
    hiddenTag: 'FILTERED',
    hiddenSuffix: 'not in this list',
    hiddenShowAll: 'show all',
    hiddenWhy:
      'By default this list shows the entries where a review reached a verdict. Nothing is removed from the registry. An entry we could not review is a published answer about source that could not be read, and it keeps its own page.',

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
    /**
     * The tier legend, at the top of the page rather than a footnote. The only
     * wording for tiers on the registry screen — the chain on the verdict page
     * says the same thing on purpose.
     */
    tierLegendLabel: 'TIER · HOW FAR THE LINKAGE REACHES',
    tierLegendA: 'the reviewed bytes are the installed bytes (recorded digest matches yours)',
    tierLegendB: 'same version string, but the bytes were never compared',
    tierLegendC: 'nothing was checked; the verdict may be about code that is not your code',
    rowsAreLinks: 'each row links to the evidence behind its verdict',

    /**
     * How to read a verdict — the two axes, and that they are independent. The
     * tier legend alone reads as one scale (state and tier conflated); these
     * pairs make the orthogonality concrete. No example package name — that
     * would be a claim about a real project this file can't keep true.
     */
    axesLabel: 'HOW TO READ A VERDICT · TWO SEPARATE QUESTIONS',
    axesVerdictTerm: 'VERDICT',
    axesVerdictBody:
      'what the review found in the code it read: clean, flagged, disputed, unreviewable, or unknown when nobody has looked.',
    axesTierTerm: 'TIER',
    axesTierBody:
      'whether the code it read is the code you will run. A, B or C. It says nothing about whether the review found anything.',
    axesIndependent:
      'They move independently. A clean verdict at tier C is a real review of a real package, of a version your machine may not resolve to. A flagged verdict at tier A is a finding in exactly the bytes you have.',
    /** Hover title on the REVIEWED cell — the cell truncates to the minute; this carries seconds so nothing is rounded away unreadably. */
    reviewedAtTitle: 'recorded review time, UTC',
    countSuffix: 'shown',
  },

  /** The stamp's impression line and its counter-stamp. Caps — but each is a claim about linkage, saying exactly how strong and no more. */
  stamp: {
    tierA: 'TIER A · RECORDED DIGEST MATCHES THE REVIEWED BLOB',
    tierB: 'TIER B · VERSION PINNED · BYTES NOT COMPARED',
    tierC: 'TIER C · NOTHING WAS CHECKED',
    tierMismatch: 'THE PUBLISHED ARTIFACT CHANGED AFTER THIS REVIEW',
    notInRegistry: 'NO ENTRY · NOTHING WAS REVIEWED',
    counterUncontested: 'UNCONTESTED',
    counterContested: 'CONTESTED · REBUTTAL ON FILE',
    counterEvidenceExpired: 'EVIDENCE NO LONGER RETRIEVABLE',
    superseded: 'SUPERSEDED',
  },

  /** `reason` on an unreviewable head, in words. */
  reasons: {
    licence: 'no licence permits us to store this source',
    'source-unavailable': 'the source could not be fetched at the named commit',
    'remote-endpoint': 'a remote endpoint: there is no local code to read',
    'no-agreement': 'the readings disagreed and no majority formed',
    /** Distinct from `no-agreement`: here there were no readings to disagree — the reviewer was never reached. */
    'no-reading': 'the reviewer could not be reached, so the code was never read',
    /** Distinct from `unknown` ("nobody has looked") — publishing only clean results and calling the rest unknown would be publication bias. */
    withheld: 'a review ran and its result is held for a human to release',
    /** The reviewer could not see all of the code, so it cannot say it found nothing. */
    'partial-source': 'part of the source was not read, so no clean verdict can be given',
  },

  verdict: {
    notFoundTitle: 'Not in the registry.',
    notFoundBody:
      'No entry exists for this fingerprint. That means nobody has submitted this exact install configuration for review. It does not mean the code is fine, and it does not mean it is not. The gate treats this as unknown and warns rather than stopping the call.',
    notFoundAction: 'Submit a server for review',
    summaryLabel: 'IN TWENTY SECONDS',
    linkageLabel: 'LINKAGE · WHAT THIS VERDICT IS ABOUT VS WHAT YOU INSTALLED',
    linkageNote:
      'the registry never sees your machine; the gate compares digests locally and keeps the answer there',
    reviewedBlob: 'REVIEWED BLOB',
    yourInstall: 'YOUR INSTALL',
    findingLabel: 'FINDING',
    findingsNoneLabel: 'FINDINGS',
    findingsNone:
      'None recorded. That is a statement about what the model saw, at that commit, at that time. Read the capability surface below for what this code can reach. It is usually the more useful half.',
    /** For an entry whose result is held, not empty — "none recorded" would falsely say the reviewer found nothing. */
    findingsWithheldLabel: 'FINDINGS · NOT PUBLISHED',
    findingsWithheld:
      'A review ran and reached a conclusion. It is not published here: SureX publishes findings only about servers it wrote itself, because an unaudited model reading somebody else\'s code is not grounds for a public accusation. The maintainer who submitted this was given the result in full, and can publish it themselves.',
    /** A flagged entry whose head carries no finding (pre-dates the submit pipeline passing the whole finding through). Must not read as "found nothing". */
    findingsMissing:
      'The finding behind this verdict is not on the record shown here. The certified blob under PROVENANCE is what the verdict was made from. Read that rather than this page.',
    /** Distinct from "a review found nothing" — seeded entries are `unknown`, and this must not imply a model looked at the code. */
    findingsNeverReviewed:
      'Nobody has reviewed this entry. There are no findings because no review has run, not because one ran and found nothing. The gate treats this as unknown and warns rather than stopping the call.',
    /** A review ran, reached no verdict, and so established nothing to publish. */
    findingsNoVerdict:
      'No finding is published. A review that reaches no verdict has established nothing, and anything raised along the way is not a claim this registry will stand behind.',
    /** The rest of a multi-finding verdict lives in the certified record. */
    findingsRemainder:
      'Only the highest-severity finding is carried on the registry entry. The rest are in the certified review blob linked under PROVENANCE.',
    /** rv-7. What kind of gap this is, above the findings. */
    concernLabel: 'WHAT KIND OF PROBLEM',
    /**
     * Every value describes a mechanism rather than a motive — a wrong accusation
     * of purpose (e.g. "works to hide what it does") is an accusation about a
     * person, not a program, on the strength of an unaudited reading.
     */
    concerns: {
      none: 'nothing found beyond what it says it does',
      'does-not-do-what-it-claims': 'it does less than it says it does',
      'undeclared-behaviour': 'it does more than its description accounts for',
      'misleading-description': 'its description steers the calling model beyond what the tool does',
      'data-leaves-the-machine': 'data leaves the machine to somewhere undeclared',
      'runs-code-it-fetched': 'it fetches code at run time and runs it, and that code is not in the reviewed blob',
      'deliberate-concealment': 'the code is written to be hard to read, and to hide what it did',
    } as Record<string, string>,
    couldBeWrongLabel: 'Could this be wrong?',
    couldBeWrongBody:
      'Yes. This is a model reading the code, not a human. If you believe it misreads the code, contest it with evidence. The rebuttal is shown beside it, with equal weight.',
    capabilityLabel: 'CAPABILITY SURFACE',
    capabilityNote:
      'what the reviewed code can reach, from a static scan that does not ask the server what it does. Shown on clean verdicts too.',
    capabilityAbsent: 'not present in the reviewed blob',
    provenanceLabel: 'PROVENANCE · WHAT WAS REVIEWED, WHEN, BY WHAT',
    provenanceCommit: 'COMMIT',
    provenanceReviewed: 'REVIEWED',
    provenanceSourceBlob: 'SOURCE BLOB',
    provenanceModel: 'MODEL',
    provenancePrompt: 'PROMPT',
    provenanceIndex: 'INDEX',
    provenanceIntegrity: 'INTEGRITY',
    provenanceEns: 'ENS NAME',
    provenanceUnknown: 'not recorded',
    /** "Signed" doesn't mean the review is right — say so on the surface, not just in docs. */
    ensNote:
      'Any Ethereum client can read this verdict from the name above, and the response carries a signature made by the key the resolver names. That signature says the answer came from SureX. It does not say the review is right, and the gate that blocks tool calls does not read it.',
    ensExample: "getEnsText({ name, key: 'surex:state' })",
    /** The disclosure sentence. Appears on every verdict rendered in full. */
    automatedDisclosure:
      'This review was automated. No human audited this code. The model and prompt version above produced every word of the finding.',
    cleanMeansLabel: 'WHAT CLEAN MEANS HERE',
    disagreeLabel: 'DISAGREE WITH THIS VERDICT?',
    disagreeBody:
      'Anyone with standing can contest it: the maintainer, a user, or an agent that depends on this server. Rebuttals are stored as their own blob and shown beside the accusation with equal weight.',
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
      'The flag stands. A second model pass and the maintainer window did not overturn the finding. The rebuttal remains on record with equal prominence. Standing to disagree survives losing.',
    stageOverturnedBody:
      'The rebuttal held. A superseding verdict was written. The original verdict and this dispute remain on chain, permanently readable. The correction is as durable as the accusation.',
    fileLabel: 'FILE A DISPUTE · TWO KINDS OF STANDING, ONE BAR TO CLEAR',
    fileBody:
      'A wrongly-flagged server hurts the humans who wrote it and the agents that depend on it. Both can defend it here. The requirements differ, the weight of the rebuttal does not.',
    humanTitle: 'You are a person',
    humanBadge: 'WORLD ID',
    /** Not "prove unique personhood" — only the Orb credential establishes uniqueness; that sentence lives in `world.credential.orb`. */
    humanStep1:
      'Prove personhood with World ID. How much that establishes depends on which credential this deployment requests. The button states which one it got, and what it does and does not settle.',
    humanStep2: 'Write the rebuttal. Point at code: file, line, commit.',
    humanStep3:
      'Attach evidence: repo link, test, config. Stored as a blob, hashed, and linked from the index.',
    humanAction: 'Prove personhood with World ID',
    humanRebuttalLabel: 'THE REBUTTAL',
    humanRebuttalPlaceholder: 'Which file, which line, which commit, and what the model got wrong about it.',
    humanFileAction: 'File the rebuttal',
    humanFilingNote:
      'The proof is checked by the registry, server-side, before the rebuttal is taken. Whatever the registry answers is shown below exactly as it arrives.',
    resultFiledLabel: 'REBUTTAL ACCEPTED',
    resultRefusedLabel: 'REFUSED BY THE REGISTRY',
    resultUnreachableLabel: 'REGISTRY UNREACHABLE',
    resultUnreachableBody:
      'Nothing was filed. Whatever you typed stayed in this browser. The request never left it.',
    resultMissingBody: 'A rebuttal needs both a World ID proof and something to say.',
    agentTitle: 'You are an agent',
    agentBadge: 'WORLD AGENTKIT',
    agentStep1:
      'A human registers this agent’s wallet in AgentBook once, from World App. That step needs an Orb-verified World ID, and it costs nothing, a hosted relay pays the transaction, so the wallet needs no balance.',
    agentStep2:
      'The agent signs each dispute request with that wallet. SureX recovers the address from the signature. An address typed into the request body proves nothing, and then asks AgentBook whether a human stands behind it.',
    agentStep3:
      'A non-null answer grants standing to be heard: same endpoint, same schema, same weight as a rebuttal a person filed.',
    agentAction: 'This step runs in the agent, not in this browser:',
    /** World track exclusion: never describe this as agent reputation. */
    standingNote:
      'Standing means one thing: a human registered this wallet. It is not a score, it says nothing about how this agent has behaved, and it does not make the rebuttal right. SureX reviews servers.',
    agentRefusedNote:
      'If AgentBook has no registration for the wallet, the request is refused with 403 agent_not_human_backed. If the lookup itself could not be completed, the answer is 503 and standing is reported as unknown. An agent is never told a human does not stand behind it because a lookup failed.',
    filedBy: 'filed by',
    evidence: 'evidence',
    onChain: 'on-chain',
    standing: 'standing',
  },

  /** The World ID step, shared by /submit and /d/[fp]. A proof arriving in the browser is not a claim the registry accepted, and a non-production proof is not a person. */
  world: {
    preparing: 'preparing the request…',
    again: 'prove personhood again',
    unconfiguredLabel: 'WORLD ID NOT CONFIGURED IN THIS DEPLOYMENT',
    unconfiguredBody:
      'There is no World ID relying party configured here, so no proof can be requested. Nothing was sent, and nothing on this screen is behaving as though a person had been checked.',
    failedLabel: 'NO PROOF OBTAINED',
    failedBody:
      'World ID did not return a proof, so there is nothing to send. The error is shown as it arrived rather than replaced with a screen that claims otherwise.',
    /** A proof in hand is not an accepted claim. `heldShort` is always on screen; `heldBody` sits behind `heldWhy`. */
    heldShort: 'Proof in hand: the registry has not seen it yet.',
    heldWhy: 'why that is not acceptance',
    heldBody:
      'World ID returned a proof to this browser. That is not acceptance: the registry checks the proof server-side when you submit, and only its answer decides anything.',
    simulatedLabel: 'SIMULATED IDENTITY · NOT A PERSON',
    simulatedBody:
      'This deployment points at a non-production World ID environment, where proofs come from a simulator rather than from a phone. Anything proven here is a test of the plumbing, not a human.',

    /**
     * What this deployment actually asked for — named here since the credential
     * is chosen server-side and arrives with the signature. Every other World ID
     * string is written true of the weakest of the three, since a static page
     * can't know which one a deployment requested. `short` is always on screen;
     * `body` is the same claim in full.
     */
    credential: {
      face: {
        short: 'Selfie Check: a live person answered. Not one person, one submission.',
        body:
          'World App opens the camera on your phone, checks that a live face is there, and matches it against the face you enrolled. On a desktop that means scanning the QR first, and the camera is never opened by this browser. World rates its sybil resistance as "some", explicitly weaker than the Orb, and files it under lower-friction liveness rather than one-human-one-action. So it establishes that a live person answered. It does not establish that this person has not already answered under another World ID.',
      },
      orb: {
        short: 'Proof of Human: Orb. The same person cannot come back as somebody else.',
        body:
          'This deployment requests Proof of Human: an Orb-checked World ID. That is the strong anti-sybil credential. The same person cannot come back as somebody else, so the per-person limits the registry applies actually hold. It is also the highest bar to clear, and a maintainer who has never been to an Orb cannot clear it.',
      },
      device: {
        short: 'Device level: a World App account. Nothing biometric is checked.',
        body:
          'This deployment requests device level: the person holds a World App account. Nothing biometric is checked. It raises the cost of bulk automation and says nothing at all about a live person being present, which is the weakest of the three bars this app can ask for.',
      },
    },

    /** The `<summary>` on the disclosure that holds `credential[…].body`. */
    credentialWhy: 'what that credential proves',
    /** Before the request is prepared, no credential is known — and that is said. */
    credentialUnknown: 'World ID: the credential is named the moment the request is prepared.',
  },

  submit: {
    title: 'Submit your server for review',
    lede:
      'Submission is consent to a public record. Whatever the review concludes, the verdict blob publishes to the index when the run completes, and you are told first, so a rebuttal can ship with it from hour zero.',
    formLabel: 'THE RELEASE TO REVIEW',
    repoLabel: 'Repository',
    repoPlaceholder: 'github.com/acme/acme-mcp',
    releaseLabel: 'Release tag',
    releasePlaceholder: 'v2.3.0',
    /** "No releases" is a fact about the repository; "we could not read it" is a fact about the request — kept distinct. */
    releaseEmpty: 'paste a repository first',
    releaseDefaultBranch: 'default branch (moves, cannot pin bytes)',
    action: 'Queue the review',

    /**
     * The repository inspection. Three states, kept distinct: "not an MCP
     * server" and "we could not read the repository" (GitHub rate-limits
     * unauthenticated browsers at 60/hour) are different refusals.
     */
    inspecting: 'reading the repository…',
    inspectMcpYes: 'MCP server confirmed',
    inspectMcpNo: 'This does not look like an MCP server',
    inspectMcpNoBody:
      'SureX reviews MCP servers against what they declare, so it needs a server to read: no MCP SDK dependency, framework, manifest or keyword was found in this repository\'s manifests. If this is an MCP server, the signal is somewhere we did not look. Say so and it gets added.',
    inspectUnknownLabel: 'Could not read the repository',
    inspectUnknownBody:
      'GitHub did not answer, so nothing was determined about this repository. This is a statement about the request, not about the code. The tag and commit can be typed by hand.',
    inspectPinnedLabel: 'PINNED TO',
    /** Why a commit and not just a tag. Tier language, deliberately. */
    inspectShaNote:
      'The commit is what the review is about. A tag can be moved or deleted, so a submission that names only a tag can never link a verdict to the bytes you shipped.',
    inspectNoShaNote:
      'No commit was resolved, so this submission names a tag only. The verdict cannot be linked to specific bytes.',
    /** Proof checked first; a deployment with no ingest path answers "not built", rendered as the API sent it. */
    worldIdNote:
      'The proof is checked by the registry before a submission is looked at, so it comes first and the release second. A deployment with no ingest path behind that gate answers "not built", and that answer is shown as it arrives.',
    resultAcceptedLabel: 'ACCEPTED',
    resultAcceptedBody:
      'The registry queued the release. A verdict blob publishes to the index when the run completes.',
    resultNotBuiltLabel: 'PROOF CHECKED · THE REST IS NOT BUILT',
    resultNotBuiltBody:
      'The registry checked the World ID proof and stopped there: the ingest path behind the gate does not exist in this deployment. Nothing was queued, no review will run, and the proof was not spent. The same person can submit once the pipeline is built.',
    resultRefusedLabel: 'REFUSED BY THE REGISTRY',
    resultUnreachableLabel: 'REGISTRY UNREACHABLE',
    resultUnreachableBody:
      'Nothing was submitted. Whatever you typed stayed in this browser. The request never left it.',
    resultMissingLabel: 'INCOMPLETE',
    // A repo with no releases resolves to its default-branch commit, a complete
    // submission — so this doesn't name a release tag as required.
    resultMissingBody:
      'Paste a repository. SureX resolves its versions and its latest commit for you; you never type one in.',
  },

  /**
   * The live loader on /submit — what the pipeline is doing, while it does it.
   * Every string here describes a step the backend reported, never a step that
   * might be happening. The `…Absent` strings are load-bearing: a field the API
   * didn't send renders as one of them, never as a plausible-looking value.
   */
  pipeline: {
    label: 'WHAT THE REGISTRY IS DOING',
    /**
     * One per stage of `GET /v1/submissions/:id`. Functional, not narrated: each
     * says what the machine is doing, in the vocabulary the verdict will use.
     */
    stage: {
      resolving: 'resolving the release to a commit',
      licence: 'reading the licence',
      fetching: 'fetching the source at that commit',
      starting: 'starting the reviewer',
      reviewing: 'the model is reading the source',
      walrus: 'writing the record to Walrus',
      arkiv: 'writing the entity to Arkiv',
      done: 'finished',
    },
    queuedLabel: 'QUEUED',
    queuedBody:
      'Accepted and waiting for the reviewer. Nothing has been read yet, and nothing is asserted until the run completes.',
    queuePosition: 'position in queue',
    runningLabel: 'RUNNING',
    doneLabel: 'RUN COMPLETE',
    doneBody:
      'The run finished and its records are linked below. What it concluded is on the entry page. A completed run is not a clean result.',
    failedLabel: 'THE RUN STOPPED',
    failedBody:
      'It did not finish. Nothing partial is published: an entry appears only when a record is written, so a stopped run leaves the registry as it was.',
    interruptedLabel: 'INTERRUPTED',
    interruptedBody:
      'The process died mid-run, so it may have written some of what it intended. Whatever landed is linked below; anything not linked did not happen.',
    unknownIdLabel: 'NO SUCH SUBMISSION',
    unknownIdBody:
      'The registry has no record of this id. That is an answer about the registry, not a failed request. The submission above is the one to trust.',
    notBuiltLabel: 'NOTHING TO REPORT ON',
    notBuiltBody:
      'This deployment has no writer, so it has no runs to report progress for.',
    lostLabel: 'STOPPED WATCHING',
    lostBody:
      'The registry stopped answering, so this page has no idea what the run is doing now. Nothing about the run itself changed. Reload to pick the watch back up.',

    /** The reading panel's source line and its meta label. */
    readingLabel: 'reading',
    readingSource: 'the submitted source, on the DGX',

    /** The two-reading split. Only ever rendered when the backend said so. */
    disagreeLabel: 'THE TWO READINGS DISAGREE',
    disagreeBody:
      'The reviewer takes two paraphrased readings of the same source. These two did not land in the same place, so a second pair is running to break the tie. A tie that does not break is published as no-agreement, which is a review with no verdict rather than a verdict of clean.',
    readingOne: 'reading·1',
    readingTwo: 'reading·2',
    rerunThree: 're-read·3',
    rerunFour: 're-read·4',
    /** What a reading card says when the run reported a split but not its sides. */
    readingAbsent: 'not reported',

    /** The write receipts. Built only from an id the pipeline actually sent. */
    blobLabel: 'blob',
    entityLabel: 'entity',
    sha256Label: 'sha256',
    txLabel: 'tx',
    stampWalrus: 'on walrus',
    stampArkiv: 'on arkiv',
    openBlob: 'Open the blob on the Walrus aggregator',
    openEntity: 'Open the entity on the Arkiv explorer',
    entryAction: 'Read the entry',

    /** Provenance of the run, named while it runs rather than after. */
    modelLabel: 'MODEL',
    promptLabel: 'PROMPT',
    passesLabel: 'PASSES',
    elapsedLabel: 'ELAPSED',
    startedLabel: 'STARTED',
    /** An unset model is a real fact about the deployment — say so rather than naming one nobody configured. */
    modelAbsent: 'the deployment did not name a model',
    /** The density is stage-derived, not counted. Said plainly, beside it. */
    stepOf: 'step',
    unitsOf: 'of',
    nothingReported:
      'The run has not reported a stage yet.',

    /**
     * The rail — which technology is being touched, right now. The halftone
     * says how far the run has got, not where it is. Phases claim as little as
     * possible: a stage the run has moved beyond reads as "the run is past
     * this", not "done" — the watch can miss what happened inside an
     * unreported stage.
     */
    rail: {
      label: 'THE FLOW',
      legend:
        'Six steps, in order. Each one ticks when the run actually reports it, and a link appears the moment it reports an identifier, never before.',
      /** Which stage the panel below is describing, and how it got chosen. */
      following: 'following the run',
      picked: 'you picked this stage, choose it again to follow the run',
      /** `phaseDone` says the run moved on, not that the stage succeeded — a licence refusal jumps straight to the write. */
      phasePending: 'not reached',
      phaseActive: 'running now',
      phaseDone: 'the run is past this',
      phaseStopped: 'the run stopped here',
      nothingReported:
        'The run reported no identifiers for this stage. Whatever happened here, it did not say, so this panel does not say either.',

      /** The tile's name, not a second description — `COPY.pipeline.stage` stays the one description. `done` is called `published`, what the pipeline emits. */
      name: {
        resolving: 'resolve',
        licence: 'licence',
        fetching: 'fetch',
        starting: 'start',
        reviewing: 'review',
        walrus: 'walrus',
        arkiv: 'arkiv',
        done: 'published',
      },

      /** The technology a stage touches. A stage that touches none has no chip. */
      tech: {
        world: 'World ID',
        source: 'GitHub · npm',
        dgx: 'NVIDIA DGX',
        walrus: 'Walrus on Sui',
        arkiv: 'Arkiv · Braga',
        ens: 'ENS · mainnet',
      },

      /**
       * The six steps the page reads as. Four of the pipeline's eight stages
       * answer one question (where did the source come from), so the flow folds
       * them into one step; purely presentational — `flowFacts()` merges, never
       * invents. `world` has no stage behind it: it happens in this browser
       * before the registry has anything to report, and belongs in the same
       * sequence rather than a separate rail.
       */
      flow: {
        name: {
          world: 'World',
          source: 'GitHub',
          review: 'NVIDIA DGX',
          walrus: 'Walrus',
          arkiv: 'Arkiv',
          published: 'Published',
        },
        /** What the step is for. One line, in the vocabulary the verdict will use. */
        caption: {
          world: 'proving a person is here',
          source: 'the repo, the commit, the licence',
          review: 'the model reads the source',
          walrus: 'the blob',
          arkiv: 'the entity',
          published: 'readable as a name',
        },
        /**
         * The World step's own panel. The other five borrow the stage copy above,
         * so there is one description per thing rather than two vocabularies.
         */
        world: {
          lede: 'A person, checked by World ID, before the registry looks at anything.',
          body:
            'Nothing is signed in this browser. The request is signed server-side and World App answers on a phone, so what the proof establishes depends on the credential this deployment asked for, which is named beside this step the moment the request is prepared, and again once a proof is in hand.',
        },
        /** Phase words for the World step — the pipeline's four don't fit: there's no run to be "past". */
        worldPhase: {
          pending: 'not started',
          active: 'checking…',
          done: 'proof in hand',
          stopped: 'no proof',
        },
        /** The sub-steps folded into `source`, listed in the panel that describes it. */
        subStagesLabel: 'this step, in the pipeline',
      },

      /** One lede per stage — the point of the stage, plus what the identifiers beside it can't say on their own. */
      stage: {
        resolving: {
          lede: 'A submission names a repository at one commit.',
        },
        licence: {
          // This path stores the review, never the source, so a missing licence
          // is published as `none` and the review runs.
          lede: 'The licence is read and recorded. None is an answer, not a stop.',
        },
        fetching: {
          lede: 'The bytes that execute, not the bytes on the branch.',
        },
        starting: {
          lede: 'The server was started so it could be asked what tools it declares.',
        },
        reviewing: {
          lede: 'An open-source model reads the source on our own hardware, against what the server says it does.',
        },
        walrus: {
          lede: 'The record goes to Walrus and is certified on Sui.',
        },
        arkiv: {
          lede: 'The entity the gate reads is written to Arkiv.',
        },
        done: {
          lede: 'Published. The entry answers from here on.',
        },
      },

      /** Fact labels — `blob`/`entity`/`sha256`/`tx` are not repeated here; the receipts render from the `*Label` fields above. */
      fact: {
        repo: 'repo',
        commit: 'commit',
        release: 'release',
        package: 'package',
        tier: 'tier',
        fingerprint: 'fingerprint',
        licence: 'licence',
        artifact: 'artifact',
        integrity: 'integrity',
        model: 'model',
        prompt: 'prompt',
        files: 'files read',
        readings: 'readings',
        custody: 'custody',
        suiObject: 'sui object',
        registerTx: 'register tx',
        certifyTx: 'certify tx',
        state: 'published as',
        ensName: 'ens name',
        ensRead: 'read it with',
        ensParent: 'parent name',
      },

      /** Whose wallet registered the blob, stated rather than inferred — on the publisher path "our wallet registered this" stops being true. */
      custodyWallet: 'our own wallet registered the blob',
      custodyPublisher: 'a public publisher registered the blob: the Sui object is theirs',

      /** Why the name is not a link. An offchain resolver cannot enumerate keys. */
      ensAppNote: 'the ENS app renders an empty records tab for a name like this one',
    },
  },

  banners: {
    unreachableLabel: 'REGISTRY UNREACHABLE',
    unreachableBody:
      'The registry API did not answer. The gate fails open with a warning; it never silently blocks, and never silently clears something it had already flagged.',
    supersededLabel: 'SUPERSEDED',
    supersededBody:
      'This verdict was replaced. It remains on record and on chain. Verdicts are superseded, never deleted.',
    evidenceExpiredLabel: 'EVIDENCE EXPIRED',
    evidenceExpiredBody:
      'The source blob behind this verdict is no longer retrievable. The finding stands as a historical record but can no longer be re-derived from evidence, so linkage is downgraded to C.',
    reviewRunningLabel: 'REVIEW RUNNING',
    reviewRunningBody:
      'A verdict blob will be written when the run completes. Nothing is asserted until then.',
    /** A withheld entry is not a failed review — `stateMeaning.unreviewable`'s "could not be read" is false for `withheld`, where the source was read and the result held back. */
    withheldLabel: 'REVIEWED · RESULT NOT PUBLISHED',
    withheldBody:
      'The source was read and the review completed. Its result is not published here: SureX publishes findings only about servers it wrote itself, because an unaudited model reading somebody else’s code is not grounds for a public accusation.',
    /** The short form, for the hero, so one page never prints the long one twice. */
    withheldShort: 'A review ran and completed. Its result is not published.',

    /** One body per reason, deliberately not composed from a shared prefix — composing "could not be read" with a reason like `no-agreement` (read twice) contradicts itself. */
    unreviewableLabel: 'UNREVIEWABLE',
    unreviewableBody: {
      licence:
        'No licence permits us to store this source, so it was not reviewed. That is a fact about the licence, not about the code. The gate warns.',
      'source-unavailable':
        'The source could not be fetched at the named commit, so there was nothing to read. The gate warns.',
      'remote-endpoint':
        'This entry is a remote endpoint. There is no local code to read, so there is nothing a static review can say about it. The gate warns.',
      'no-agreement':
        'The source WAS read, more than once, and the readings did not converge, so no verdict is claimed. A disagreement is not a finding, and it is not a pass either. The gate warns.',
      'no-reading':
        'The reviewer could not be reached, so the code was never read. Nothing is claimed about it. The gate warns.',
      'partial-source':
        'Part of the source was not read, so no clean verdict can be given for it. The gate warns.',
    } as Record<string, string>,
    /** A reason nothing here knows. Never guess a cause on a reader's behalf. */
    unreviewableUnknownReason:
      'This entry has no verdict, and the record does not say which of the possible causes applies. The gate warns.',
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
    disputed: 'Flagged, and contested with evidence. Still stops the call. Both claims are shown.',
    stale: 'An entry exists, but a newer release landed than the one reviewed. The gate warns.',
    unreviewable: 'The source could not be read or could not be stored. The gate warns.',
    unknown: 'Not in the registry. The gate warns and the call proceeds.',
  },

  confidence: {
    unconfirmed: 'automated only, no human audit',
    confirmed: 'uncontested',
    disputed: 'rebuttal on file, both claims stand',
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

  /** The homepage. Numbers on the stat band come from `lib/home-data.ts`, never from here. */
  home: {
    nav: {
      /** The mobile nav trigger and its dismiss, lowercase like the rest of the nav. */
      menuOpen: 'menu',
      menuClose: 'close',
    },

    hero: {
      headline: "MCPs are fun. Until they're not.",
      lede: 'Making the use of MCPs a safe experience.',
      body: 'MCPs can see your files. See your secrets. We put a check in the path. Before your agent calls any tool, we look the server up, and tell you what we see so you can be SureX.',
      actionInstall: 'Install Now',
      actionBrowse: 'View Registry',
    },

    /**
     * Keyed by `StatKey` in lib/home-data.ts. Labels only — no count is
     * hardcoded here; every number is derived from the rows actually returned.
     */
    stats: {
      entriesIndexed: 'MCPS ANALYZED',
      reviewed: 'REVIEWED',
      flagged: 'FLAGGED',
    },

    /** The pipeline. Six steps in order, plus the dispute branch off step 05. */
    pipeline: {
      title: 'How it works',
      steps: [
        {
          index: '01',
          label: 'THE CODE',
          body: 'Published source, at one exact version.',
          chip: 'mcp-server-postgres 0.6.2',
        },
        {
          index: '02',
          label: 'SEALED',
          body: 'An exact copy goes under seal. Change one character and it breaks.',
          chipLabel: 'CODE RECORD',
          chip: '0x8e4c\u20269c41',
        },
        {
          index: '03',
          label: 'THE READING',
          body: 'A model reads the code against what the server says it does.',
          chip: 'fs \u00b7 net \u00b7 env \u00b7 exec',
        },
        {
          index: '04',
          label: 'THE VERDICT',
          body: 'One judgement, sealed on its own, apart from the code it judges.',
          chip: 'clean',
        },
        {
          index: '05',
          label: 'THE INDEX',
          body: 'One entry, the only thing the check reads. It points at both sealed records.',
          chip: '\u2192 code \u00b7 \u2192 verdict',
          tier: 'TIER B',
        },
        {
          index: '06',
          label: 'THE CHECK',
          body: 'Runs before the tool call, on your machine.',
          outcomes: [
            { state: 'clean', gate: 'silent', because: 'bytes match' },
            { state: 'unknown', gate: 'a caution', because: 'no entry' },
            { state: 'flagged', gate: 'stopped', because: 'a finding' },
          ],
        },
      ],
      dispute: {
        label: 'THE DISPUTE',
        branch: 'BRANCHES OFF 05',
        body: 'A verdict can be contested by a person, or by an agent a real human registered. Standing is checked first.',
        markers: [
          '\u25cc STANDING CHECKED',
          'DISPUTED \u00b7 STANDING OPEN',
          'SUPERSEDED, NEVER DELETED',
        ],
      },
    },

    /**
     * The roadmap. Three views over the work. Progress is carried by form, never
     * hue: filled means done, outlined means committed and not done, dashes mean
     * nothing to check yet \u2014 a milestone tinted sage would read as a clean
     * verdict on something that doesn't exist. `phase` drives the marker.
     */
    roadmap: {
      title: 'Roadmap',
      views: {
        timeline: {
          tab: 'timeline',
          heading: 'Timeline',
          milestones: [
            {
              phase: 'BUILDING',
              when: 'IN FLIGHT',
              title: 'Disputes with standing',
              body: 'Humans rebut with World ID, agents with AgentKit. A fresh flag stays unconfirmed for 72 hours so the maintainer can answer first.',
            },
            {
              phase: 'NEXT',
              when: 'NOT STARTED',
              title: 'Train the MCP reviewer for accuracy',
              body: 'The model that reads code gets measured against labelled servers, and the prompt version that scored a verdict stays recorded next to it.',
            },
            {
              phase: 'NEXT',
              when: 'NOT STARTED',
              title: 'Dispute on context about why it was flagged',
              body: 'A rebuttal argues the reading, not only the result. The maintainer answers the exact line the model cited.',
            },
            {
              phase: 'NEXT',
              when: 'NOT STARTED',
              title: 'Support for other agent frameworks and harnesses',
              body: 'The gate is a pre-call hook, so anything with a pre-call hook can read the registry. Each harness needs its own way to identify a server from config alone.',
            },
            {
              phase: 'LATER',
              when: 'NO DATE',
              title: 'Enterprise access controls',
              body: 'Permissioned access for organisations that need a private lane: who may submit, who may override, and a record of both.',
            },
            {
              phase: 'LATER',
              when: 'NO DATE',
              title: 'Encryption for closed-source MCPs with Walrus Seal',
              body: 'Closed source is unreviewable today. Sealed blobs would let a model read what nobody else can, and the record would say that is what happened.',
            },
          ],
        },
        adoption: {
          tab: 'adoption',
          heading: 'Adoption',
          milestones: [
            {
              phase: 'NEXT',
              when: 'NOT STARTED',
              title: 'SureX integrates with other coding agents beyond Claude Code',
              body: 'The gate is a pre-call hook, so anything with a pre-call hook can read the registry. Each harness needs its own way to identify a server from config alone.',
            },
            {
              phase: 'LATER',
              when: 'NO DATE',
              title: 'Enterprise support',
              body: 'A company builds a permissioned registry, encrypted with Seal, and runs it over its own internal tooling. Who may submit and who may override are recorded, and the record stays inside.',
            },
          ],
        },
        scaling: {
          /** Shortened on the tab strip so three chips fit 390pt; full in the heading. */
          tab: 'scaling',
          heading: 'Data scaling',
          milestones: [
            {
              phase: 'BUILDING',
              when: 'IN FLIGHT',
              title: 'Users challenge or validate a SureX decision',
              body: 'Feedback argues the reading, not only the result. A rebuttal answers the exact line the model cited. Humans sign with World ID, agents with AgentKit.',
            },
            {
              phase: 'LATER',
              when: 'NO DATE',
              title: 'A human review as final escalation',
              body: 'The last step for a challenged verdict or an uncertain score. Until it exists, a flag stands or it is disputed, and nothing else moves it.',
            },
            {
              phase: 'LATER',
              when: 'NO DATE',
              title: 'Analysis of private MCPs',
              body: 'Closed source is unreviewable today. A sealed blob would let a model read what nobody else can, and the record would say that is what happened.',
            },
          ],
        },
      },
    },

    /**
     * The terminal window. One window, three surfaces: the hook that blocks a
     * call, the plugin that asks before one, and the ENS text records that hold
     * the same verdict with no pixels. All three are transcripts, quoted
     * verbatim \u2014 nothing here is live, and none of it says more than the registry knows.
     */
    terminal: {
      /** The accessible name for the transcript, and the tab strip's label. */
      label: 'Recorded gate transcript',
      tabsLabel: 'Which surface printed this',
      tabs: {
        plugin: { tab: 'plugin' },
        ens: { tab: 'ens' },
      },

      plugin: {
        source: 'surex plugin \u00b7 confirm',
        elapsed: 'awaiting answer',
        state: 'flagged',
        /** Six blocks, one blank line between them, never two. Never says "blocked" \u2014 the plugin asks, and an answer the reader didn't give isn't a decision. */
        lines: {
          question: 'Are you sureX you want to use @surex/mal-tool-shadow?',
          recommendation: 'SureX does not recommend proceeding.',
          finding:
            'Finding (moderate): exfiltration gated on an env var that no tool description mentions (src/telemetry.mjs:48)',
          capability: 'This code can reach: network \u00b7 filesystem \u00b7 env vars \u00b7 credentials',
          provenance: 'Reviewed 2026-07-25 by qwen3-coder-next. No human audited this.',
          linkage: 'Link to your install (C): nothing was checked.',
          evidence: 'Evidence: arkiv-surex.vercel.app/r/sxf1_ceacc357\u2026',
          wayOut: 'You can proceed anyway, at your own risk:',
          command: 'surex allow sxf1_ceacc357\u2026',
        },
      },

      /**
       * Five text records are the whole verdict at this route. A text record
       * can't carry a meter or a border style, so tier is the letter and
       * severity is the integer \u2014 the canonical values the pixels elsewhere render.
       */
      ens: {
        source: 'ens resolver \u00b7 text records',
        elapsed: 'surex.eth',
        state: 'flagged',
        name: 'sxf1-ceacc357115421177295dd5b183871b3192c17b1.surex.eth',
        records: [
          { key: 'surex:state', value: 'flagged', isState: true },
          { key: 'surex:severity', value: '3' },
          { key: 'surex:tier', value: 'C' },
          { key: 'surex:reviewed', value: '2026-07-25' },
          { key: 'url', value: 'arkiv-surex.vercel.app/r/sxf1_ceacc357\u2026' },
        ],
      },
    },

    /** The install band, immediately before the closer (which prints the same command, so no copy chip is duplicated here). */
    install: {
      headline: 'We check the MCPs so you can explore safely.',
      lede: 'Be Surex before calling it, not after.',
    },

    closer: {
      installCommand: '/plugin install surex@surex',
    },

    footer: {
      registry: 'registry',
      api: 'api',
      docs: 'docs',
      ens: 'surex.eth',
      github: 'github',
      builtAt: 'built at ETHGlobal Lisbon 2026',
    },
  },
} as const;

export type Copy = typeof COPY;
