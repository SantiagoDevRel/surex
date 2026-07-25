# SureX — Track Fit: Sui and World

> Version 1, 2026-07-24. Companion to [`surex-prd.md`](./surex-prd.md) and [`surex-tech-spec.md`](./surex-tech-spec.md).
> Purpose: map SureX to both prize tracks requirement by requirement, and prepare honest answers to the questions judges will actually ask.

---

## 1. Sui — "Best App Built on Sui" ($4,000, up to 2 teams at $2,000)

### Requirement mapping

| Requirement (verbatim) | How SureX meets it | Confidence |
|---|---|---|
| "Project must be newly developed during the hackathon" | Built from scratch this weekend. Keep real commit history from hour one. | High |
| "Must be built on Sui with meaningful integration (not superficial)" | Walrus is the registry's storage layer, not a file dump beside it. Every record SureX holds — each reviewed source tree, each verdict, each dispute submission — is a content-addressed blob registered and certified as a `Blob` object on Sui. Arkiv indexes; Walrus *is* the record. See argument below. | Medium-high |
| "Working demo deployed to Sui testnet or mainnet required" | Each upload produces two Sui testnet transactions (register + certify) with public digests, plus a `Blob` object viewable on SuiVision/Suiscan and Walruscan. Verdict UI links out to them. | High |
| "market-viable products — real apps people would actually use" | The consumer side is a hook a developer installs and forgets. The pain is real and current (PRD §3). | High |

### The meaningful-integration argument

Use this close to verbatim:

> SureX's trust registry is only as credible as its evidence trail, so we put the whole trail on Walrus. Not just the source code we review — every record the registry holds. Each source snapshot, each review with its findings, each dispute submission is written as a content-addressed blob and certified as a `Blob` object on Sui — the code and the judgement about the code as two separately verifiable records. Arkiv indexes those records so they're queryable; Walrus is where the records actually live. Because a blob ID is derived deterministically from content, a verdict points at the exact bytes it judged — not a URL, not a claim — and any tampering afterwards produces a different ID that no longer matches what we certified. Registration and certification are separate Sui transactions with public digests, so anyone can click from a SureX verdict through to the exact Sui testnet object and confirm it wasn't written after the fact. That applies to the accusations as much as the evidence: a contestant's dispute is certified the same way our verdict is, so the appeals process doesn't ask the accused to trust the accuser's database. This isn't a file upload bolted onto an app — it's the chain of custody the entire product rests on.

### Counterarguments, and what to say

| Judge says | Honest answer |
|---|---|
| "This is storage, not logic on Sui — you wrote no Move." | Correct, we wrote no Move. But Walrus isn't a bucket next to our database — it *is* our record store. Every verdict and every dispute is a certified Sui object; Arkiv holds the queryable index over them. What we needed from Sui was a record nobody, including us, can quietly swap, and that's exactly what blob certification gives. Adding a Move contract to re-hold verdicts would be a second copy of the same data — one thing properly beats two things thinly. |
| "Why is anything in Arkiv then? Why not all Sui?" | Because Walrus stores; it doesn't query. The Gate has to answer "what's the state of this fingerprint" before every tool call, which needs annotation-level filtering and range queries. Walrus is the record, Arkiv is the index over it, and each does the job it's actually good at. |
| "The verdict lives off-chain; Sui only proves a blob existed." | Yes. Sui proves *what was reviewed*, not *that the review was right*. We're explicit about that split everywhere — the review is an automated model's opinion, and the dispute flow exists precisely because it can be wrong. |
| "You're a consumer of Walrus, not an extender of Sui." | True. We're using Sui infrastructure the way an application should. The novelty is the system it serves, not a fork of the storage layer. |
| "One service address owns and renews every blob — that's centralised." | Correct, and it's a stated v1 gap. `--share`d blobs, so anyone can extend storage on a record they care about, is the fix. We chose owned+permanent for the weekend because non-deletable evidence mattered more than distributed renewal. |

### Logistics

Testnet epoch is **1 day** — buy generous epochs (max 183) or the demo's blobs expire mid-weekend. Testnet has been fully redeployed before: don't hardcode package or object IDs, read them from `walrus info` on the day, and re-fund from `faucet.sui.io` + `walrus get-wal` on day one. Public testnet publishers cap requests at 10 MiB.

---

## 2. World — "AgentKit New Use Cases" ($8,000: $4,000 / $2,500 / $1,500)

### Requirement mapping

| Requirement (verbatim) | How SureX meets it | Confidence |
|---|---|---|
| "Meaningful AgentKit implementation" | `createAgentBookVerifier().lookupHuman(agentAddress)` gates a real state transition: a dispute is only accepted, and a verdict only moves to `disputed`, if the calling agent's wallet is AgentBook-registered. A `null` result rejects the request. | High |
| "Human-backed agent verification" | The agent wallet is registered in AgentBook by a human via World App; SureX verifies that backing server-side on every dispute. | High |
| "Working end-to-end flow (not wrapper or static demo)" | Demo path §11 of the tech spec: blocked call → human-backed agent disputes → block now shows the rebuttal beside the accusation → human overturns → call proceeds. Three observable state changes, and the AgentKit check is the gate that lets the first one happen. | High |
| "Cannot reuse prior hackathon patterns without genuinely new workflow, vertical, or trust model" | See below — this is the one to address head-on, unprompted. | Medium |

### The differentiator — say it before they ask

Prior art at ETHGlobal Cannes already used AgentBook the obvious way. **agentDesk** ([showcase](https://ethglobal.com/showcase/agentdesk-wobh0)) put x402 + AgentKit in front of a marketplace: verify the header, `lookupHuman`, then let a human hire the agent. **HumanENS** ([showcase](https://ethglobal.com/showcase/humanens-9qp31)) rooted ENS names on World Chain in AgentBook identity. Both use human-backing as **transactional access control** — proving a human exists is the whole point, and the reward is a green light for a transaction.

SureX uses the identical primitive for a structurally different job. Human-backing here does not grant access to anything. It grants **standing to dispute an automated verdict** inside an adjudication process — the agent gets no resource, no payment, no privilege. It gets the right to be heard against a machine-generated accusation about a named project, and its dispute is judged on the evidence it submits, not on its identity.

That is the frame: **AgentKit as process integrity for a supply-side trust registry, not as a paywall.** It also answers the track's actual prompt more directly than access-gating does — "accountability" is one of its named focus areas, and an appeals process is what accountability looks like when the accuser is a model.

Related, worth saying: SureX is one of the first cases where **an autonomous agent has a legitimate reason to defend a piece of software** — an agent that depends on an MCP server has a direct stake in whether it's wrongly flagged. That's a new relationship between agents and the supply chain they run on.

### Logistics — the biggest single demo risk in the project

**AgentBook has no testnet.** Registration resolves against World Chain (`eip155:480`); the CLI defaults to a gasless hosted relay on Base mainnet (`eip155:8453`). It requires a real World App verification on a real phone.

- Do **one** registration on **day one**, with a named owner. Not hour 35.
- World ID itself *does* have staging + [simulator.worldcoin.org](https://simulator.worldcoin.org/) — use it for all iteration on the maintainer-submit and human-dispute flows so no one burns real verifications while debugging.
- Contract address reported as `0xA23aB2712eA7BBa896930544C7d6636a96b944dA` — **unverified**, confirm on a World Chain explorer before hardcoding.
- Coinbase ships a different product also called "AgentKit". Anyone searching "agentkit testnet" will land on the wrong docs and waste an hour.

### Secondary World tracks

Selfie Check and Identity Check ($1,750 each) are beta-test tracks requiring written developer and user feedback. Only chase one if the AgentKit build lands early — Selfie Check would fit the maintainer-submit flow as a lower-friction alternative to device verification. Do not split focus before the primary flow works.

---

## 3. The questions judges will ask

Twelve questions, honest answers. Where the answer is "we don't solve that," say so — a stated limitation reads as rigour; a discovered one reads as an oversight.

**1. "If I patch a package that has a clean verdict, does the hook still say clean?"**
For npm servers, no — we record the version's `dist.integrity` at review time and the Gate compares it against your installed copy. A republished tarball under the same version stops matching and the entry drops to `stale`. For non-npm runners we can't do that yet, so it stays true until re-review completes: a new release immediately marks the entry `stale` rather than leaving it `clean`.

**2. "What stops a vague tool description from trivially matching malicious code?"**
Nothing, structurally — intent-matching checks *consistency*, not safety, and a server that says "runs commands as requested" and then runs commands is perfectly consistent. That's why every verdict also carries a capability surface: a static scan of what the code can actually reach — network, filesystem, exec, env, credentials — shown independently of what it claims, on clean verdicts too. The consistency check isn't the only signal a developer gets.

**3. "The reviewer is an LLM reading attacker-controlled text. What stops prompt injection against it?"**
Partial defences, and we can show them working: untrusted source is delimited and labelled as data, the reviewer is told that instructions found inside reviewed content are findings rather than commands, every review runs twice with paraphrased prompts and a split buys one more reading of each prompt and the majority decides, rather than resolving to whichever side is more accusatory, and an injection attempt is recorded as a severity-4 finding in its own right rather than merely ignored. Our demo fixture carries a planted injection for exactly this reason. This is the same unsolved problem every LLM-as-judge system has. We reduced it; we didn't solve it. A false "clean" here is worse than no registry, because it launders code with the appearance of scrutiny — we know that.

**4. "For a remote MCP server, what did you actually review?"**
Whatever source the maintainer submitted at registration. We cannot verify that's what runs behind the URL on any given call, and the backend can serve different behaviour per caller — so remote servers are permanently Tier C. What we add is monitoring of the one observable surface: we poll `tools/list` and hash the tool names, descriptions and schemas, so a changed description raises a drift finding. That catches the tool-poisoning rug-pull specifically. It says nothing about backend behaviour, and the UI doesn't pretend otherwise.

**5. "Who can submit someone else's server? What stops me flagging a competitor?"**
Nobody can. Submission requires both a World ID proof of personhood and proof you control the repo — GitHub OAuth, or a SureX token committed to the default branch. The only exception is our own seed crawler, whose entries are marked crawler-sourced and start at `unknown`, never `clean`. The DoS vector is removed at the root rather than patched after the fact. And every block is overridable in one command from the message itself, so even a wrong flag costs a developer seconds rather than blocking their work outright.

**6. "Did you get permission to upload other people's source to permanent storage?"**
SureX covers open-source servers only, and the crawler resolves the licence before any upload — MIT, Apache, BSD, ISC, MPL and GPL proceed; no licence, a proprietary one, or an unmatched custom text is recorded as `unreviewable / reason: licence` with no source stored. Unmatched counts as ineligible, because guessing wrong writes someone's code somewhere with no delete. Honest residue: Walrus has no admin delete, so a licence misdetection isn't fully reversible, and index delisting is the only lever we have.

**7. "You link a World ID nullifier to a public accusation of malice. GDPR?"**
Real exposure, acknowledged. We store the nullifier and nothing else — no name, no email. But a persistent pseudonymous identifier attached to a damaging public claim is still personal-data processing. It's also why corrections must be as durable and prominent as the original flag, and why "tamper-proof" is a liability here, not a selling point.

**8. "Your registry goes down. Does every tool call break?"**
No — we fail open with a visible notice. Fail-closed would turn our outage into a total agent outage for everyone, which is disproportionate for a trust layer with no SLA and the fastest route to being uninstalled. The trade is honest: under a targeted outage, fail-open means no protection.

**9. "What's your reviewer's false-positive and false-negative rate?"**
Unmeasured. There is no public labelled corpus of malicious and benign MCP servers to benchmark against — building one is the prerequisite for any real claim, and we'd rather say "unmeasured" than quote a number we made up.

**10. "A verified human files a fabricated dispute against a correct flag. What stops the reversal?"**
Structurally, a dispute buys nothing on its own — the server stays blocked while contested, the block just also shows the rebuttal. Only a human reviewer can overturn it. So a fabricated dispute costs an attacker effort and gains them no access. What remains unsolved is the reviewer being fooled by good-looking fabricated evidence: World ID proves a person is unique, not that they're honest, and identities can be rented. That's a process gap, not a cryptographic one, and it's out of scope for 36 hours.

**11. "The flagged server in your demo is one you wrote yourselves. Isn't that rigged?"**
It's deliberate. Publicly accusing a real, named project of malice on the strength of an unaudited model verdict is a real-world harm we're not willing to cause for a demo — and it's the exact failure mode our own PRD calls the biggest reputational risk in the product. So the fixture is flagged and real seeded servers show `reviewed` or `unknown` only. The pipeline is identical either way; the only thing that changes is who absorbs the cost if the model is wrong.

**12. "Your Gate makes a security decision based on an unsigned HTTP response. Why should I trust it?"**
You shouldn't, fully, and we didn't sign it. Response signing is explicitly out of scope for this build, so anyone who can MITM the Gate can influence agent control flow. It's the largest knowingly-open gap in the system, it's written into the PRD as accepted rather than mitigated, and a pinned-key signature is the first thing we'd add with more time.

---

## 4. What not to claim

Rehearse these as hard rules — one overclaim in a demo undoes the credibility the honesty buys.

- Never say SureX makes an MCP server **safe**, **secure**, **trusted** or **verified**. Say **reviewed**.
- Never say the registry proves what's running on the user's machine. It proves what was reviewed.
- Never present Walrus as decentralised backup. Present it as chain of custody.
- Never describe the review as independent audit. It's an automated model, stated as such on every verdict.
- Never claim ecosystem coverage. Say "seeded with N servers" and give the number.

The strongest version of this demo is the one where the team names the weaknesses before the judges do. The product's actual claim is modest and defensible: *a registry that is continuously re-reviewed, enforced at the moment of the call, hard for its own operator to edit, and open to dispute.* Nothing today does all four.
