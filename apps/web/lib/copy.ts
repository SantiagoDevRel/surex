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
    /**
     * The one thing a visitor can do that changes anything on their machine, so
     * it is the one thing in the chrome styled as an action rather than a
     * destination. "Get the plugin" over "download": nothing is downloaded — the
     * install is two slash commands pasted into Claude Code, and a button
     * promising a file would be describing a different product.
     */
    install: 'get the plugin',
    installTitle: 'Install the SureX gate into Claude Code — two slash commands, no npm install',
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

    /**
     * THE DEFAULT LIST IS FILTERED, AND IT SAYS SO ON THE PAGE.
     *
     * The default view is the entries where a review reached a verdict. It has to
     * be: a registry whose honest answer for most third-party packages is "we
     * could not read this, and here is why" ends up with those entries
     * outnumbering the verdicts several to one, and a reader who opens the list
     * and meets a screen of `unreviewable` learns nothing about the reviews.
     *
     * But hiding a real answer is exactly the move this product exists to refuse,
     * so the filter is announced rather than applied quietly: the count of what is
     * held back is printed, broken down by state, next to a link that brings it
     * all back in one click. `hiddenWhy` is there so the reader knows the entries
     * still exist rather than inferring that they were dropped — an `unreviewable`
     * is a published answer, not a gap in the record.
     *
     * No number lives in any of these strings. Every count on this line is counted
     * off the rows the page actually received.
     */
    viewDecided: 'with a verdict',
    hiddenTag: 'FILTERED',
    hiddenSuffix: 'not in this list',
    hiddenShowAll: 'show all',
    hiddenWhy:
      'By default this list shows the entries where a review reached a verdict. Nothing is removed from the registry — an entry we could not review is a published answer about source that could not be read, and it keeps its own page.',

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
     * The tier legend. The TIER column is the most important thing in the table
     * and the least self-explanatory, so the meanings sit at the top of the page
     * rather than in a footnote.
     *
     * This is the ONLY wording for tiers on the registry screen — it replaced a
     * one-line footer gloss ("▮▮▮ A digest match · ▮▮ B pinned · ▮ C unpinned or
     * remote"), which is why the footer no longer carries one. Two vocabularies
     * for the same three letters is worse than none. The sentences are the ones
     * in design/tokens.html §05, where the linkage chain is specified; the chain
     * on the verdict page and this legend say the same thing on purpose.
     */
    tierLegendLabel: 'TIER — HOW FAR THE LINKAGE REACHES',
    tierLegendA: 'the reviewed bytes are the installed bytes (recorded digest matches yours)',
    tierLegendB: 'same version string, but the bytes were never compared',
    tierLegendC: 'nothing was checked; the verdict may be about code that is not your code',
    rowsAreLinks: 'each row links to the evidence behind its verdict',

    /**
     * How to read a verdict — the two axes, and that they are independent.
     *
     * Added because the tier legend alone taught the wrong thing. A reader who
     * sees three letters explained and a coloured state unexplained concludes
     * they are one scale, and then reads "Tier C" as a weaker verdict rather
     * than as a statement about linkage. They are orthogonal, and the pairs
     * below are the fastest way to make that concrete: the same verdict at two
     * tiers means two different things, and so does the same tier at two
     * verdicts.
     *
     * No count, no example package name — a named example here would be a claim
     * about a real project that this file cannot keep true.
     */
    axesLabel: 'HOW TO READ A VERDICT — TWO SEPARATE QUESTIONS',
    axesVerdictTerm: 'VERDICT',
    axesVerdictBody:
      'what the review found in the code it read: clean, flagged, disputed, unreviewable, or unknown when nobody has looked.',
    axesTierTerm: 'TIER',
    axesTierBody:
      'whether the code it read is the code you will run. A, B or C — it says nothing about whether the review found anything.',
    axesIndependent:
      'They move independently. A clean verdict at tier C is a real review of a real package, of a version your machine may not resolve to. A flagged verdict at tier A is a finding in exactly the bytes you have.',
    /**
     * Hover title on the REVIEWED cell. The cell itself is now truncated to the
     * minute (`2026-07-25 14:31Z`); the title carries the timestamp as recorded,
     * seconds and all, so nothing is rounded away without somewhere to read it.
     */
    reviewedAtTitle: 'recorded review time, UTC',
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
    /**
     * The readings disagreed and a third did not break the tie. Measured, not
     * hypothetical: one honest fixture came back flagged, clean, clean on three
     * identical inputs, so a two-reading panel can resolve to an accusation by
     * sampling noise alone. When the readings will not converge, the registry
     * says that instead of picking one.
     */
    'no-agreement': 'the readings disagreed and no majority formed',
    /**
     * A review ran and its result is not published. Distinct from `unknown`
     * ("nobody has looked") on purpose: publishing only the clean results and
     * leaving everything else as unknown is publication bias, and it would make
     * `unknown` quietly mean two different things.
     */
    withheld: 'a review ran and its result is held for a human to release',
    /** The reviewer could not see all of the code, so it cannot say it found nothing. */
    'partial-source': 'part of the source was not read, so no clean verdict can be given',
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
    provenanceEns: 'ENS NAME',
    provenanceUnknown: 'not recorded',
    /**
     * What the ENS name is for, and what it is not for. On the surface rather
     * than only in `docs/`, because "signed" is a word people finish the
     * sentence of themselves, and they finish it wrong.
     */
    ensNote:
      'Any Ethereum client can read this verdict from the name above, and the response carries a signature made by the key the resolver names. That signature says the answer came from SureX. It does not say the review is right, and the gate that blocks tool calls does not read it.',
    ensExample: "getEnsText({ name, key: 'surex:state' })",
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
    /**
     * NOT "prove unique personhood". This deployment can be configured to request
     * any of three World ID credentials, and only one of them — the Orb — actually
     * establishes uniqueness. The strong sentence moved to `world.credential.orb`,
     * which renders only when the Orb is what was requested.
     */
    humanStep1:
      'Prove personhood with World ID. How much that establishes depends on which credential this deployment requests — the button states which one it got, and what it does and does not settle.',
    humanStep2: 'Write the rebuttal. Point at code: file, line, commit.',
    humanStep3:
      'Attach evidence — repo link, test, config. Stored as a blob, hashed, and linked from the index.',
    humanAction: 'Prove personhood with World ID',
    humanRebuttalLabel: 'THE REBUTTAL',
    humanRebuttalPlaceholder: 'Which file, which line, which commit — and what the model got wrong about it.',
    humanFileAction: 'File the rebuttal',
    humanFilingNote:
      'The proof is checked by the registry, server-side, before the rebuttal is taken. Whatever the registry answers is shown below exactly as it arrives.',
    resultFiledLabel: 'REBUTTAL ACCEPTED',
    resultRefusedLabel: 'REFUSED BY THE REGISTRY',
    resultUnreachableLabel: 'REGISTRY UNREACHABLE',
    resultUnreachableBody:
      'Nothing was filed. Whatever you typed stayed in this browser — the request never left it.',
    resultMissingBody: 'A rebuttal needs both a World ID proof and something to say.',
    agentTitle: 'You are an agent',
    agentBadge: 'WORLD AGENTKIT',
    agentStep1:
      'A human registers this agent’s wallet in AgentBook once, from World App. That step needs an Orb-verified World ID, and it costs nothing — a hosted relay pays the transaction, so the wallet needs no balance.',
    agentStep2:
      'The agent signs each dispute request with that wallet. SureX recovers the address from the signature — an address typed into the request body proves nothing — and then asks AgentBook whether a human stands behind it.',
    agentStep3:
      'A non-null answer grants standing to be heard: same endpoint, same schema, same weight as a rebuttal a person filed.',
    agentAction: 'This step runs in the agent, not in this browser:',
    /** World track exclusion: never describe this as agent reputation. */
    standingNote:
      'Standing means one thing: a human registered this wallet. It is not a score, it says nothing about how this agent has behaved, and it does not make the rebuttal right — SureX reviews servers.',
    agentRefusedNote:
      'If AgentBook has no registration for the wallet, the request is refused with 403 agent_not_human_backed. If the lookup itself could not be completed, the answer is 503 and standing is reported as unknown — an agent is never told a human does not stand behind it because a lookup failed.',
    filedBy: 'filed by',
    evidence: 'evidence',
    onChain: 'on-chain',
    standing: 'standing',
  },

  /**
   * The World ID step, shared by /submit and /d/[fp].
   *
   * The distinction these strings exist to hold: a proof arriving in the browser is
   * not a claim the registry accepted, and a non-production proof is not a person.
   */
  world: {
    preparing: 'preparing the request…',
    again: 'prove personhood again',
    unconfiguredLabel: 'WORLD ID NOT CONFIGURED IN THIS DEPLOYMENT',
    unconfiguredBody:
      'There is no World ID relying party configured here, so no proof can be requested. Nothing was sent, and nothing on this screen is behaving as though a person had been checked.',
    failedLabel: 'NO PROOF OBTAINED',
    failedBody:
      'World ID did not return a proof, so there is nothing to send. The error is shown as it arrived rather than replaced with a screen that claims otherwise.',
    heldLabel: 'PROOF IN HAND — THE REGISTRY HAS NOT SEEN IT YET',
    heldBody:
      'World ID returned a proof to this browser. That is not acceptance: the registry checks the proof server-side when you submit, and only its answer decides anything.',
    simulatedLabel: 'SIMULATED IDENTITY — NOT A PERSON',
    simulatedBody:
      'This deployment points at a non-production World ID environment, where proofs come from a simulator rather than from a phone. Anything proven here is a test of the plumbing, not a human.',

    /**
     * WHAT THIS DEPLOYMENT ACTUALLY ASKED FOR — stated where it is known.
     *
     * The credential is chosen server-side (`lib/world.ts`) and arrives with the
     * signature, so this is the only place on the site that can name it without
     * guessing. Every other string about World ID is written to be true of the
     * WEAKEST of the three, because a static page cannot know which one a given
     * deployment requested.
     *
     * The three do not prove the same thing, and the difference is the whole
     * point: Orb is the one-human-one-action bar, Face Check is liveness with
     * what World itself rates as "some" sybil resistance, and device level is an
     * account with no biometric behind it at all. Wording them alike would make
     * two of the three a false claim.
     */
    credential: {
      face: {
        label: 'FACE CHECK — LIVENESS, NOT ONE-HUMAN-ONE-SUBMISSION',
        body:
          'This deployment requests Selfie Check. World App opens the camera on your phone, checks that a live face is there, and matches it against the face you enrolled — on a desktop that means scanning the QR first, and the camera is never opened by this browser. World rates its sybil resistance as "some", explicitly weaker than the Orb, and files it under lower-friction liveness rather than one-human-one-action. So it establishes that a live person answered. It does not establish that this person has not already answered under another World ID.',
      },
      orb: {
        label: 'PROOF OF HUMAN — ORB, ONE PERSON CANNOT BE TWO',
        body:
          'This deployment requests Proof of Human: an Orb-verified World ID. That is the strong anti-sybil credential — the same person cannot come back as somebody else — so the per-person limits the registry applies actually hold. It is also the highest bar to clear, and a maintainer who has never been to an Orb cannot clear it.',
      },
      device: {
        label: 'DEVICE LEVEL — AN ACCOUNT, NO BIOMETRIC',
        body:
          'This deployment requests device level: the person holds a World App account. Nothing biometric is checked. It raises the cost of bulk automation and says nothing at all about a live person being present, which is the weakest of the three bars this app can ask for.',
      },
    },
  },

  submit: {
    title: 'Submit your server for review',
    lede:
      'Submission is consent to a public record. Whatever the review concludes, the verdict blob publishes to the index when the run completes — and you are told first, so a rebuttal can ship with it from hour zero.',
    // "Unique human" was true only while this app requested an Orb. It now requests
    // Face Check by default, which is liveness — so the step label says what is
    // constant across all three credentials, and the precise claim is made at the
    // button, where the credential is actually known.
    stepHuman: 'Person check',
    stepHumanNote: 'World ID — the credential requested is named at the button',
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
    /**
     * The release is chosen from what the repository has, never typed. These two
     * cover the cases where there is nothing to choose from — said plainly,
     * because "no releases" is a fact about the repository and "we could not
     * read it" is a fact about the request.
     */
    releaseEmpty: 'paste a repository first',
    releaseDefaultBranch: 'default branch (moves — cannot pin bytes)',
    action: 'Queue the review',

    /**
     * The repository inspection, in words.
     *
     * Three states and they stay distinct, because the difference between "this
     * is not an MCP server" and "we could not read the repository" is the
     * difference between a refusal a maintainer deserves and one they do not.
     * GitHub rate-limits an unauthenticated browser at sixty requests an hour.
     */
    inspecting: 'reading the repository…',
    inspectMcpYes: 'MCP server confirmed',
    inspectMcpNo: 'This does not look like an MCP server',
    inspectMcpNoBody:
      'SureX reviews MCP servers against what they declare, so it needs a server to read: no MCP SDK dependency, framework, manifest or keyword was found in this repository\'s manifests. If this is an MCP server, the signal is somewhere we did not look — say so and it gets added.',
    inspectUnknownLabel: 'Could not read the repository',
    inspectUnknownBody:
      'GitHub did not answer, so nothing was determined about this repository — this is a statement about the request, not about the code. The tag and commit can be typed by hand.',
    inspectPinnedLabel: 'PINNED TO',
    /** Why a commit and not just a tag. Tier language, deliberately. */
    inspectShaNote:
      'The commit is what the review is about. A tag can be moved or deleted, so a submission that names only a tag can never link a verdict to the bytes you shipped.',
    inspectNoShaNote:
      'No commit was resolved, so this submission names a tag only — the verdict cannot be linked to specific bytes.',
    worldIdNote:
      'World ID personhood is checked by the registry before a submission is looked at, so the proof comes first and the release second. What is NOT built yet is everything after that gate — repo-ownership proof, licence gate, blob upload and the index write — so a submission with a good proof still comes back as not built. That answer is shown below exactly as the API sends it, rather than a screen pretending a review was queued.',
    resultAcceptedLabel: 'ACCEPTED',
    resultAcceptedBody:
      'The registry queued the release. A verdict blob publishes to the index when the run completes.',
    resultNotBuiltLabel: 'PROOF CHECKED — THE REST IS NOT BUILT',
    resultNotBuiltBody:
      'The registry checked the World ID proof and stopped there: the ingest path behind the gate does not exist in this deployment. Nothing was queued, no review will run, and the proof was not spent — the same person can submit once the pipeline is built.',
    resultRefusedLabel: 'REFUSED BY THE REGISTRY',
    resultUnreachableLabel: 'REGISTRY UNREACHABLE',
    resultUnreachableBody:
      'Nothing was submitted. Whatever you typed stayed in this browser — the request never left it.',
    resultMissingLabel: 'INCOMPLETE',
    // Says what to DO, and no longer names a release tag as required — a repo with
    // no releases resolves to its default-branch commit, which is a complete
    // submission and a stronger identifier than a tag.
    resultMissingBody:
      'Paste a repository. SureX resolves its versions and its latest commit for you; you never type one in.',
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

  /**
   * The live loader on /submit — what the pipeline is doing, while it does it.
   *
   * A review is minutes, and the screen used to say "queued" and then nothing.
   * Every string here describes a step the backend REPORTED; there is no copy in
   * this block for a step that might be happening, because the loader has no way
   * to know that and neither does this file.
   *
   * The two `…Absent` strings are load-bearing. A field the API did not send
   * renders as one of them — never as a plausible-looking value.
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
      'The run finished and its records are linked below. What it concluded is on the entry page — a completed run is not a clean result.',
    failedLabel: 'THE RUN STOPPED',
    failedBody:
      'It did not finish. Nothing partial is published: an entry appears only when a record is written, so a stopped run leaves the registry as it was.',
    interruptedLabel: 'INTERRUPTED',
    interruptedBody:
      'The process died mid-run, so it may have written some of what it intended. Whatever landed is linked below; anything not linked did not happen.',
    unknownIdLabel: 'NO SUCH SUBMISSION',
    unknownIdBody:
      'The registry has no record of this id. That is an answer about the registry, not a failed request — the submission above is the one to trust.',
    notBuiltLabel: 'NOTHING TO REPORT ON',
    notBuiltBody:
      'This deployment has no writer, so it has no runs to report progress for.',
    lostLabel: 'STOPPED WATCHING',
    lostBody:
      'The registry stopped answering, so this page has no idea what the run is doing now. Nothing about the run itself changed — reload to pick the watch back up.',

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
    /**
     * `reviewerIdentity()` reads the model name from the same env var the
     * reviewer itself reads, so an unset one is a real fact about the deployment.
     * Saying so beats naming a model nobody configured.
     */
    modelAbsent: 'the deployment did not name a model',
    /** The density is stage-derived, not counted. Said plainly, beside it. */
    stepOf: 'step',
    unitsOf: 'of',
    nothingReported:
      'The run has not reported a stage yet.',
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
