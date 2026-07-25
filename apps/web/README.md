# @surex/web — the registry website

Four screens: the registry list, one verdict in full, the dispute over a verdict, and the maintainer
submission path. Built from `design/prototype.html` against the locked token and component set in
`design/tokens.html`.

```
pnpm --filter @surex/web dev      # http://localhost:4311   (the API takes 4310)
pnpm --filter @surex/web build    # must pass before anything ships
pnpm --filter @surex/web test     # the copy law, over every string
```

---

## Routes, and what backs each one

| Route | Screen | Live API | Fixture fallback |
|---|---|---|---|
| `/` | registry list | `GET /v1/registry?limit=200` + `GET /v1/stats`, falling back to `GET /v1/flagged` against an API that predates the route | full 11-row fixture registry |
| `/r/<fingerprint>` | one verdict, in full | `GET /v1/entry/<fp>` | 5 fixture entries (flagged · clean · disputed · stale · unreviewable) |
| `/d/<fingerprint>` | the dispute | the `dispute` record on `GET /v1/entry/<fp>` | one fixture dispute, `under_review` |
| `/submit` | maintainer submission | `POST /v1/submissions` — **real call**, no fixture | — |

Every route is `force-dynamic`. Prerendering would freeze whichever answer happened to be available at
build time — including the fixture fallback — and bake an illustrative banner into a page that could have
been live.

### The registry's default view is FILTERED — and it says so

`/` with no query shows the entries where a review **reached a verdict**: `clean`, `flagged`, `disputed`
and `stale`. Everything else — `unreviewable`, `unknown`, `running` — is one click away and never removed.

Why: on 2026-07-25 the live registry held 34 verdict heads and **25 of them were `unreviewable`**, almost
all a licence gate refusing to store source we may not redistribute (FRICTION-LOG R2). Those are real
answers and they stay published, but at three-to-one they bury every verdict on the screen the registry
exists to show.

The whole mechanism is in `lib/format.ts` — `DEFAULT_STATE`, `isDecided()`, `matchesState()`,
`hiddenFromDefault()` — and pinned by `test/registry-view.test.mjs`. Two properties make it a display
decision rather than concealment, and both are tested:

- **Nothing worse than `clean` is ever held back.** `isDecided()` is `statusRank(s) <= statusRank('clean')`,
  derived from the sort order rather than written out again, so `stale` — which ranks *worse* than clean —
  cannot be dropped by someone tidying a list of state names.
- **The count of what is held back is on the screen, broken down by state, next to the way back.**
  `HiddenNotice` in `RegistryFilters.tsx` renders `FILTERED · 25 unreviewable not in this list · show all 34`
  and only while the default view is the active one; every other filter is something the reader clicked and
  its chip is already lit. The table footer says `9 of 34 shown` underneath.

It is done entirely in the web layer. `GET /v1/registry` still returns every state and its default response
is unchanged, because the plugin's gate reads that API (`packages/plugin/lib/registry.mjs`) and a registry
that answers differently depending on who asks is not a registry.

### The three answers, kept distinct

| What happened | What renders |
|---|---|
| API answered | live data, no banner |
| API answered `404` | **"Not in the registry."** A real fact: nobody submitted this install configuration. Not an error, not fixtures. |
| API unreachable, or `5xx` | local fixtures, **and the illustrative banner** |

A malformed head degrades to `unknown`, never to `clean` — the same rule the gate follows, for the same
reason. `parseVerdictHead()` from `@surex/core` is what decides that, in `lib/api.ts`.

### `/v1` has no full-registry list route

The frozen contract exposes `GET /v1/verdict?fp=`, `GET /v1/entry/<fp>` and `GET /v1/flagged` (the public
feed for org-level gateways, FR-14) — but nothing that lists the whole registry. So a **live** `/` shows the
flagged feed and says so in a banner rather than implying it is everything. A clean entry is reachable by
its fingerprint. Closing this properly means an additive `/v1/registry` route, which is a contract decision,
not a web decision.

## Illustrative data — the banner, and when it appears

AGENTS.md §2 and §4: nothing fake may be presented as real, and anything illustrative is labelled
illustrative **on the same screen**. `app/_components/IllustrativeBanner.tsx` is that label. It is
`sticky top-0` — deliberately stickier than the nav, because if only one of the two can be on screen while
you scroll a page of placeholder verdicts, it should be the warning.

It appears when:

- the API is unreachable and the page fell back to `lib/fixtures.ts` → *ILLUSTRATIVE DATA — LOCAL FIXTURES*
- the API answered with `illustrative: true` anywhere in the payload (its mock mode) → *ILLUSTRATIVE DATA — API MOCK MODE*
- the API answered `404` **and** marked that answer illustrative — a mock registry's "no entry" is not a real
  fact about the registry either

Every fixture row also carries an inline `illustrative` marker in the registry table, so a screenshot of a
single row cannot lose the disclosure. A test asserts every fixture record is marked.

**Do not remove the banner while the data is fake.** There is no configuration flag for it: it is derived
from where the data came from, so the only way to turn it off is to have real data.

## The copy law is a test, not a convention

`lib/copy.ts` holds every user-facing string. `test/copy.test.mjs` walks it leaf by leaf and runs each
string through `copyViolations()` from `@surex/core`, plus the prose inside `lib/fixtures.ts` — a finding
description is as user-facing as a heading.

Never *safe*, *trusted*, *verified* or *secure* about a reviewed server. The word is **reviewed**. Never
*reputation* about anything agent-shaped — SureX reviews servers, and the World track excludes agent
reputation explicitly.

The test names the exact path when it fails:

```
browse.mutationProbe: "safe" → use reviewed — and say what was reviewed; "verified" → use reviewed
    This server is verified and safe to trust.
```

It also asserts the disclosure obligation is present (automated · no human audit · commit · blob · date ·
model · prompt) and that every fixture fingerprint is contract-shaped, so a typo in a 64-hex string fails
the suite instead of the page.

## No counts are ever hardcoded

Every figure on screen is counted off the rows that rendered, or read from `GET /v1/stats`. `unreviewable`
and `running` are excluded from "reviewed" — neither has been reviewed, and counting them would overstate
coverage. `/v1/stats` is a telemetry document rather than a counts document, so `normaliseStats()` takes the
counts it does report and leaves the rest **undefined**, which the stat strip simply omits. Nothing here
invents a number that nobody counted.

## Decisions come from `@surex/core`, always

The site and the gate have to agree about what a verdict means, and they agree by sharing one module.

| From core | Used for |
|---|---|
| `ROUTES` | every URL the client builds |
| `parseVerdictHead`, `unknownHead`, `isFingerprint` | validating anything off the wire |
| `decide`, `BLOCKING_STATES` | whether a verdict is a blocking one |
| `confidenceOf` | which of the three tones the stamp's counter-stamp carries |
| `tierSentence` | the one sentence about what the tier promises |
| `capabilityLine` | the prose capability line |
| `SEVERITY_LABEL` | 0-4 → word, on severity chips |
| `CLEAN_MEANS` | what `clean` means, in full, on any page rendering one |

`lib/verdict-view.ts` only chooses which locked component renders those answers. It does not decide any of
them.

## The locked verdict system

Do not redesign these. `design/tokens.html` §04-§06 is the specification.

- **`LinkageChain.tsx`** — the primary tier display. The tier is drawn as the bridge between the reviewed
  blob and the local install, with the **missing segments rendered as gaps**: filled = checked, outlined =
  asserted but unchecked, flowing dashes = nothing to check. Hue is the state. The right-hand well tells the
  truth about the local side, and that truth is often "we cannot see your machine".
- **`Stamp.tsx`** — the hero, one per page. Tier is the impression: A double-struck, B single 2px, C dashed.
  −2° rotation, counter-stamp for confirmation at +2° overlapping bottom-right.
- **`CustodyRow.tsx`** — the compact table row: state (hue, 600) · tier (letter + 3-cell meter) · standing ·
  meta right-aligned.

Accent (`#7aa3cc`) **never** appears in a verdict — it is for links, focus and actions. `unknown` and
`unreviewable` use ink-3, because grey is the honest colour of ignorance.

### Animation is never load-bearing

The chain stagger is three **durations**, not three delays, and the counter-stamp holds opacity 0 inside its
own keyframe rather than behind an `animation-delay`. A delay plus `both` fill-mode pins an element in its
`from` state — `scaleX(0)`, `opacity: 0` — so any environment that does not run the animation loses the
element. The first screenshot of this page lost the whole chain and the counter-stamp that way. The tier is
information; it cannot exist only while animating.

## Styling

Tailwind CSS v4, configured through CSS. `app/globals.css` holds the whole token layer:

- `--sx-*` on `:root` are the runtime values that flip with the theme
- `@theme inline` turns them into real Tailwind tokens, so a component writes `text-clean`, never `#6aa87c`
- `inline` is what makes one class follow the theme: the utility emits `var(--sx-clean)` rather than
  resolving a hex at build time

No inline `style={{}}` and no `<style>` blocks anywhere. Arbitrary values are used only for the stamp
rotation, the chain segment geometry and the animation durations.

State-dependent classes live in `lib/state-styles.ts` as literal strings. Tailwind only generates what it
can see in the source, so `text-${state}` would compile to nothing.

**Dark is the default.** `prefers-color-scheme: light` moves to the light variant; an explicit `data-theme`
on `<html>` beats both, in either direction. A tiny inline script in `app/layout.tsx` applies a stored
choice before first paint.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUREX_API` | `http://localhost:4310` | set to the deployed API in production |
| `NEXT_PUBLIC_WORLD_APP_ID` | *none* | `app_…` from developer.world.org |
| `NEXT_PUBLIC_WORLD_RP_ID` | *none* | `rp_…` from the same app |
| `RP_SIGNING_KEY` | *none* | **server only, and it must stay that way.** Shown exactly once by the portal. Never `NEXT_PUBLIC_*`, never logged, never sent to the browser — whoever holds it can forge proof requests in SureX's name. A test asserts the prefix never appears |
| `NEXT_PUBLIC_WORLD_ID_ENVIRONMENT` | `production` | `staging` / `sandbox` produce simulator identities, and every screen that uses one says **SIMULATED IDENTITY — NOT A PERSON** |
| `WORLD_CREDENTIAL` | `face` | which credential the widget requests: `face` (Selfie Check) · `orb` (Proof of Human) · `device` (device level). **Server only** — the browser is told which one, it never picks. An unrecognised value is a `503` configuration error, not a silent fallback, so `orbb` can never hand back a face check to someone who asked for an Orb |

With none of the three World variables set, `POST /api/world/rp-signature` answers `503` naming exactly
which are missing, and the screen renders that. There is no demo mode: nothing here ever behaves as though
a person had been checked when no proof exists.

The client's own timeout is 2500 ms — more generous than `GATE_BUDGET.networkTimeoutMs` (1500 ms) on
purpose. That budget exists because the gate sits in front of every tool call; a page render can afford to
wait a little longer before giving up on live data.

## World ID, on both screens that need it

`app/_components/WorldIdProof.tsx` is the shared step, used by `/submit` (`maintainer-submit`) and
`/d/<fp>` (`contest-verdict`). Three rules it exists to keep:

1. **Nothing is signed in the browser.** The relying-party signature *and* the signal come from
   `POST /api/world/rp-signature`, server-side (`lib/world.ts`, which no client component may import — a
   test enforces it).
2. **A proof in hand is not an accepted claim.** IDKit returning a result means World produced a proof.
   The registry checks it server-side on submit, and only its answer is rendered as an outcome — so the
   success state here reads *"PROOF IN HAND — THE REGISTRY HAS NOT SEEN IT YET"*.
3. **A non-production proof says so, loudly.** Staging and sandbox proofs come from a simulator, not a
   person, and a screen that looked identical either way would be the most misleading thing on the site.
4. **The screen names the credential, and states what that credential proves.** Because the three this app
   can request do not prove the same thing, and one sentence about "personhood" would be false under two
   of them.

### Which credential, and what each one actually proves

Set by `WORLD_CREDENTIAL`, **server-side**, and carried to the browser with the signature. The default is
`face`.

| `WORLD_CREDENTIAL` | IDKit preset | What it establishes |
|---|---|---|
| `face` *(default)* | `selfieCheckLegacy({ signal })` | **Liveness.** World App opens the camera on the phone (on desktop, after a QR scan — never in this browser), checks a live face and matches it to the enrolled one. World rates its sybil resistance as **"some"**, *"not as strong as Orb or NFC"*, and files the preset under *"lower-friction liveness or bot deterrence"* rather than one-human-one-action. Beta, and gated per app by `enable_face_check` |
| `orb` | `proofOfHuman({ signal })` | **Uniqueness.** An Orb-verified World ID — the only one of the three under which the same person cannot come back as somebody else, and therefore the only one under which the registry's per-person limits actually bind |
| `device` | `deviceLegacy({ signal })` | **An account.** No biometric at all. What this app requested before Face Check was enabled; kept reachable rather than deleted, because requiring an Orb of a maintainer defending their own code excludes almost every maintainer there is |

`allow_legacy_proofs` stays set for all three: Selfie Check returns a World ID 3.0 Face proof, and
`verification_level` no longer exists in IDKit 4.x (FRICTION-LOG **W11**).

**The copy follows the preset, and a test enforces it.** Every string outside `COPY.world.credential`
renders without knowing which credential the deployment requested, so each must be true of the *weakest*
one — which is why the submit step reads *"Person check"* and not *"Unique human"*, and why
`copy.test.mjs` fails on any string that claims uniqueness outside the Orb block. Face Check proves a live
person answered. It does **not** prove that person has not already answered under another World ID.

Editing the repository (on `/submit`) or the rebuttal (on `/d/<fp>`) **drops a held proof**, because the
signal is derived from those fields and a proof bound to the old value would be refused with
`signal_mismatch`.

## What is not wired up

- **The agent side of `/d/<fp>` is not a browser control, and the panel no longer pretends it is.** An
  agent signs its own request with the wallet a human registered in AgentBook, which a page cannot do on
  its behalf, so the panel shows the real registration command and the real request instead of a button
  that could not work. `scripts/agent-dispute.mjs` is that client.
- **`POST /v1/submissions` behind the gate.** The World ID proof is checked for real; everything after it
  — repo-ownership proof, licence gate, blob upload, index write — is not built, so a good proof returns
  `501` and the screen says *"PROOF CHECKED — THE REST IS NOT BUILT"*. Not a failure and not a success.
- The `open → under_review → upheld | overturned` transitions. A filed dispute is accepted by the API but
  not persisted (the API has no wallet); the timeline renders whichever status the record carries and
  nothing here moves it.

## Cross-lane notes

The API lane ships shapes the frozen contract does not pin down, so `lib/api.ts` reads tolerantly rather
than asking them to change:

- `GET /v1/flagged` returns `{ heads: [...] }`; `headList()` also accepts a bare array, `entries`,
  `verdicts`, `items`, `results`
- `capabilities[*]` prose arrives as `detail`, not `what` — components read both
- `topFinding` has no `title`, only `category` + `description` — the headline falls back to `category`
- `GET /v1/stats` is nested (`registry.byState`) rather than flat — see `normaliseStats()`

## Layout

```
app/
  layout.tsx            fonts, metadata, theme bootstrap, chrome
  globals.css           the token layer — @theme + the light/dark variants
  page.tsx              browse       (thin composer)
  r/[fp]/page.tsx       verdict      (thin composer)
  d/[fp]/page.tsx       dispute      (thin composer)
  submit/page.tsx       submit       (thin composer)
  _components/          Stamp · LinkageChain · CustodyRow · Chip · Panel · Banner ·
                        IllustrativeBanner · CapabilitySurface · Provenance · FindingCard ·
                        ClaimCard · DisputeTimeline · StandingPanels · SubmitForm · …
lib/
  api.ts                the client, against ROUTES from @surex/core
  fixtures.ts           local fallback, every record illustrative
  copy.ts               every user-facing string, so the law is testable
  types.ts              the TS mirror of the frozen contract
  verdict-view.ts       head → which locked component renders it
  state-styles.ts       state → literal Tailwind classes
  format.ts             display formatting only, no decisions
test/
  copy.test.mjs         the copy law over lib/copy.ts and lib/fixtures.ts
```
