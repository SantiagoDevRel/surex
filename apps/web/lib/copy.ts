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
    /**
     * A PROOF IN HAND IS NOT AN ACCEPTED CLAIM — said in one line, with the
     * reasoning one disclosure away.
     *
     * It used to be a four-line banner. The distinction is not optional (a screen
     * that goes quiet here lets a reader assume the registry took something it has
     * never seen), but it does not need a paragraph on the happy path either. So
     * `heldShort` is always on screen and `heldBody` sits behind `heldWhy`.
     */
    heldShort: 'Proof in hand — the registry has not seen it yet.',
    heldWhy: 'why that is not acceptance',
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
     *
     * `short` is the line that is ALWAYS on screen, beside the World step of the
     * flow. `body` is the same claim in full, one disclosure away. Compressing
     * this was allowed; dropping it was not — a screen that names no credential is
     * a screen where the reader supplies the strongest bar they can imagine.
     */
    credential: {
      face: {
        short: 'Selfie Check — a live person answered. Not one person, one submission.',
        body:
          'World App opens the camera on your phone, checks that a live face is there, and matches it against the face you enrolled — on a desktop that means scanning the QR first, and the camera is never opened by this browser. World rates its sybil resistance as "some", explicitly weaker than the Orb, and files it under lower-friction liveness rather than one-human-one-action. So it establishes that a live person answered. It does not establish that this person has not already answered under another World ID.',
      },
      orb: {
        short: 'Proof of Human — Orb. The same person cannot come back as somebody else.',
        body:
          'This deployment requests Proof of Human: an Orb-checked World ID. That is the strong anti-sybil credential — the same person cannot come back as somebody else — so the per-person limits the registry applies actually hold. It is also the highest bar to clear, and a maintainer who has never been to an Orb cannot clear it.',
      },
      device: {
        short: 'Device level — a World App account. Nothing biometric is checked.',
        body:
          'This deployment requests device level: the person holds a World App account. Nothing biometric is checked. It raises the cost of bulk automation and says nothing at all about a live person being present, which is the weakest of the three bars this app can ask for.',
      },
    },

    /** The `<summary>` on the disclosure that holds `credential[…].body`. */
    credentialWhy: 'what that credential proves',
    /** Before the request is prepared, no credential is known — and that is said. */
    credentialUnknown: 'World ID — the credential is named the moment the request is prepared.',
  },

  submit: {
    title: 'Submit your server for review',
    lede:
      'Submission is consent to a public record. Whatever the review concludes, the verdict blob publishes to the index when the run completes — and you are told first, so a rebuttal can ship with it from hour zero.',
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
    /**
     * One line, not a paragraph. It keeps the ordering fact (the proof is checked
     * first) and the one that stops a screen from over-claiming: a deployment with
     * no ingest path behind the gate answers *not built*, and that answer is
     * rendered as the API sent it.
     */
    worldIdNote:
      'The proof is checked by the registry before a submission is looked at, so it comes first and the release second. A deployment with no ingest path behind that gate answers "not built", and that answer is shown as it arrives.',
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

    /**
     * THE RAIL — which technology is being touched, right now.
     *
     * The halftone says HOW FAR the run has got. It does not say WHERE it is, and
     * "where" is the question a person watching a submission is actually asking:
     * whose machine is reading my code, what got written, and can I go and look at
     * it. So the rail names one technology per stage and puts a link next to it the
     * moment the run reports an identifier — never before, which is why every
     * string in `fact` is a LABEL and not one of them carries a value.
     *
     * The phases are worded to claim as little as possible. The watch polls every
     * 1.8 s and a short stage can pass between two polls, so a stage the run has
     * moved beyond is described as *the run is past this* rather than as *done*:
     * we know the run advanced, and we do not know what happened inside a stage
     * nobody reported.
     */
    rail: {
      label: 'THE FLOW',
      legend:
        'Six steps, in order. Each one ticks when the run actually reports it, and a link appears the moment it reports an identifier — never before.',
      /** Which stage the panel below is describing, and how it got chosen. */
      following: 'following the run',
      picked: 'you picked this stage — choose it again to follow the run',
      /**
       * Phases. `phaseDone` deliberately says the run moved on rather than that
       * the stage succeeded: a licence refusal jumps straight from the licence
       * gate to the write, so "past" is the only thing a jumped number proves.
       */
      phasePending: 'not reached',
      phaseActive: 'running now',
      phaseDone: 'the run is past this',
      phaseStopped: 'the run stopped here',
      nothingReported:
        'The run reported no identifiers for this stage. Whatever happened here, it did not say — so this panel does not say either.',

      /**
       * The tile's NAME — a name, not a second description. `COPY.pipeline.stage`
       * stays the one description of what each stage does, and the rail reuses it
       * verbatim as the caption, so there is no second vocabulary for the same
       * eight steps. `done` is called `published` because that is what the
       * pipeline says when it emits it.
       */
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
       * THE SIX STEPS THE PAGE READS AS.
       *
       * The pipeline reports eight stages and four of them are the same question —
       * *where did the source come from* — so the flow folds those four into one
       * step and the panel underneath names whichever of them the run is on. The
       * folding is presentational and nothing else: every fact still comes from the
       * stage that reported it, and `flowFacts()` merges rather than invents.
       *
       * `world` is the one step with no stage behind it. It happens in this browser
       * before the registry has anything to report, which is exactly why it belongs
       * in the same sequence — a form and then a separate rail reads as two
       * unrelated things, and it is one sequence.
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
        /** What the step is FOR. One line, in the vocabulary the verdict will use. */
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
            'Nothing is signed in this browser. The request is signed server-side and World App answers on a phone, so what the proof establishes depends on the credential this deployment asked for — which is named beside this step the moment the request is prepared, and again once a proof is in hand.',
        },
        /**
         * Phase words for the World step. The pipeline's four do not fit it: there
         * is no run to be "past", and "not reached" is wrong for a step the reader
         * is being asked to start.
         */
        worldPhase: {
          pending: 'not started',
          active: 'checking…',
          done: 'proof in hand',
          stopped: 'no proof',
        },
        /** The sub-steps folded into `source`, listed in the panel that describes it. */
        subStagesLabel: 'this step, in the pipeline',
      },

      /**
       * One lede and one paragraph per stage. The lede is the point of the stage;
       * the paragraph is the part that is not obvious and that the identifiers
       * beside it cannot say on their own.
       */
      stage: {
        resolving: {
          lede: 'A submission names a repository at one commit.',
        },
        licence: {
          // Was 'Nothing is stored until a licence permits it.' — which stopped
          // being true when the licence became a recorded fact rather than a
          // gate. This path stores the REVIEW, never the source, so a missing
          // licence is published as `none` and the review runs.
          lede: 'The licence is read and recorded — none is an answer, not a stop.',
        },
        fetching: {
          lede: 'The bytes that execute, not the bytes on the branch.',
        },
        starting: {
          lede: 'The server was started so it could be asked what tools it declares.',
        },
        reviewing: {
          // Carries the DGX fact now that the paragraph under it is gone: the
          // source never reaching a hosted model is the substantive claim this
          // step makes, and it is worth a clause.
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

      /**
       * Fact labels. `blob`, `entity`, `sha256` and `tx` are NOT repeated here —
       * they already exist above as `blobLabel`/`entityLabel`/`sha256Label`/
       * `txLabel` and the receipts render from those. One word per identifier.
       */
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

      /**
       * Whose wallet registered the blob. Stated rather than inferred from which
       * fields are missing: on the publisher path the Sui object and any digest
       * belong to the publisher, so "our wallet registered this" stops being true
       * and the screen has to stop saying it.
       */
      custodyWallet: 'our own wallet registered the blob',
      custodyPublisher: 'a public publisher registered the blob — the Sui object is theirs',

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
