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
| `/` | registry list | `GET /v1/flagged` + `GET /v1/stats` | full 11-row fixture registry |
| `/r/<fingerprint>` | one verdict, in full | `GET /v1/entry/<fp>` | 5 fixture entries (flagged · clean · disputed · stale · unreviewable) |
| `/d/<fingerprint>` | the dispute | the `dispute` record on `GET /v1/entry/<fp>` | one fixture dispute, `under_review` |
| `/submit` | maintainer submission | `POST /v1/submissions` — **real call**, no fixture | — |

Every route is `force-dynamic`. Prerendering would freeze whichever answer happened to be available at
build time — including the fixture fallback — and bake an illustrative banner into a page that could have
been live.

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

The client's own timeout is 2500 ms — more generous than `GATE_BUDGET.networkTimeoutMs` (1500 ms) on
purpose. That budget exists because the gate sits in front of every tool call; a page render can afford to
wait a little longer before giving up on live data.

## What is not wired up

- **World ID on `/submit`.** The form makes the real `POST /v1/submissions` call with no proof, so a real
  registry refuses it — and the refusal is rendered exactly as the API sends it (`HTTP 401 ·
  unauthenticated`). A screen claiming to have queued a review it did not queue is precisely what this
  project exists to make impossible.
- **World ID / AgentKit on `/d/<fp>`.** Both standing panels are present and both buttons are disabled.
- Filing a dispute, and the `open → under_review → upheld | overturned` transitions. The timeline renders
  whichever status the record carries; nothing here moves it.

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
