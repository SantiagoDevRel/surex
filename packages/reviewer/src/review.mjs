// The orchestration: deterministic scan + double model run + merge.
//
// Three layers produce one ReviewRecord, and they are kept apart on purpose
// (tech-spec §6):
//
//   1. The capability scan   — deterministic. Cannot be argued with by the file
//                              it is reading. Runs whether or not the model does,
//                              and is shown on `clean` verdicts too.
//   2. The injection scan    — deterministic. A planted instruction is evidence.
//   3. The model review      — twice, with paraphrased prompts. Agreement means
//                              the verdict stands; disagreement caps severity.
//
// And one hard rule sits above all of it:
//
//     A MALFORMED OR MISSING MODEL RESPONSE IS `unreviewable`.
//     IT IS NEVER `clean`.
//
// `clean` is the only verdict that makes SureX silent. Reaching it by accident —
// a parse failure, a timeout, one run out of two — would turn every glitch into a
// pass, which is the exact failure the double run exists to prevent.

import { NO_HUMAN_AUDIT } from '@surex/core/copy';
import {
  scanFiles, emptyCapabilities,
} from './capabilities.mjs';
import {
  PROMPT_VERSION, VARIANTS, buildPrompt, inputKey, newFenceId,
  scanAllInjection, injectionFinding,
} from './prompt.mjs';
import {
  callModel, resolveConfig, readFixture, writeFixture, endpointFingerprint, FIXTURES_DIR,
} from './model.mjs';
import {
  extractJson, validateModelOutput, validateReviewRecord, unreviewableRecord,
  DISAGREEMENT_SEVERITY_CAP, clampSeverity,
} from './schema.mjs';

export const REVIEW_KIND = 'review';

/**
 * How a split is broken: **one more reading of each variant**, not one more
 * reading overall.
 *
 * The obvious tie-break — a single third call — is biased, and the bias is not
 * subtle. With readings {a₁, b₁, a₂} the third draw comes from variant `a`'s own
 * distribution, so it agrees with a₁ more often than with b₁ for reasons that
 * have nothing to do with the code. The split would resolve toward whichever
 * prompt happened to be re-run.
 *
 * A balanced panel of {a₁, b₁, a₂, b₂} has no such tilt, and it earns something
 * else: when the two prompts persistently disagree — a₁,a₂ flagged against
 * b₁,b₂ clean — there is no 3-of-4 majority, and `mergeRuns` returns
 * `unreviewable / no-agreement`. That is the correct answer for a server two
 * competent readings will not agree about, and a single tie-break would have
 * papered over it with a verdict.
 *
 * Cost is two extra calls, only on a split (1 fixture in 16), on hardware we own.
 * (There is no CAUTION_ORDER any more: the cautious side of a split is no longer
 * how a disagreement resolves. See `mergeRuns`.)
 */
const TIEBREAK_VARIANTS = VARIANTS;

// ---------------------------------------------------------------------------
// wording
// ---------------------------------------------------------------------------

/**
 * The sentence that goes wherever this record is presented. Every claim the copy
 * law requires — what model, what prompt, when, how many runs, no human — in one
 * string, so no surface can render a verdict while forgetting one of them.
 *
 * Copy law (AGENTS.md §4): the word is *reviewed*. Never safe, trusted, verified
 * or secure about a server. Asserted by test/copy.test.mjs, not by good intentions.
 */
export function reviewNotice(record) {
  const when = (record?.run?.finishedAt ?? '').slice(0, 10) || 'unknown date';
  const model = record?.modelId ?? 'unknown model';
  const prompt = record?.promptVersion ?? PROMPT_VERSION;
  const runs = Number(record?.agreementRuns ?? 0);

  if (record?.run?.cached) {
    const recorded = (record.run.cachedFrom ?? '').slice(0, 19).replace('T', ' ') || 'an earlier run';
    return `Served from a review recorded at ${recorded} UTC — not a fresh run. ` +
      `Reviewed by model ${model}, prompt ${prompt}. ${NO_HUMAN_AUDIT}`;
  }

  const runPhrase = runs === 2
    ? 'from 2 runs that agreed'
    : runs === 1
      ? 'from 1 usable run of 2 — severity is capped because the runs did not agree'
      : 'from 0 usable runs of 2 — the model review did not complete';
  return `Reviewed ${when} by model ${model}, prompt ${prompt}, ${runPhrase}. ${NO_HUMAN_AUDIT}`;
}

// ---------------------------------------------------------------------------
// merging the two runs
// ---------------------------------------------------------------------------

function findingKey(f) {
  return `${f.file}|${f.line}|${f.category}`;
}

/**
 * The pseudo-paths a finding is allowed to cite for something that is not in the
 * source tree — a tool description, an input schema, the README. Generated from
 * the same input the prompt showed the model, so a citation outside this set and
 * outside the supplied files is a path nobody can open.
 */
export function statedIntentPaths(statedIntent = {}) {
  const paths = new Set();
  for (const tool of statedIntent.tools ?? []) {
    const name = tool?.name ?? '(unnamed)';
    paths.add(`stated-intent:tools/${name}#description`);
    paths.add(`stated-intent:tools/${name}#inputSchema`);
  }
  paths.add('stated-intent:README');
  return paths;
}

/**
 * Merge the model runs.
 *
 * Rules from tech-spec §6.3 — "Agreement → verdict stands. Disagreement →
 * severity capped and agreementRuns recorded; do not flag on a single dissenting
 * run" — with one change made on evidence, described below.
 *
 *   all valid runs agree       → verdict stands, agreementRuns = the count. Where
 *                                severities differ, the LOWEST wins: a higher
 *                                number was asserted by fewer runs.
 *   a strict majority agrees   → that verdict, agreementRuns = the majority size,
 *                                severity = the lowest inside the majority.
 *   no majority                → `unreviewable`, reason `no-agreement`.
 *   one valid                  → agreementRuns 1, severity capped at 2. A single
 *                                run saying `clean` becomes `unreviewable`: the
 *                                spec says every review runs twice, so one run
 *                                cannot deliver the silent verdict.
 *   none valid                 → `unreviewable`, agreementRuns 0.
 *
 * **Why "no majority" is no longer the more cautious verdict.** It used to keep
 * the cautious side of a two-way split, capped at severity 2. Calibration showed
 * what that means in practice: `honest-sqlite` — a fixture we wrote, whose whole
 * point is that it is well behaved — came back **flagged, clean, clean** across
 * three identical inputs. The runs were splitting on sampling noise, and the
 * cautious rule converted that coin flip into a published accusation. Note what
 * it did NOT do: at severity 2 core `decide()` answers `warn`, exactly as it does
 * for `unreviewable`. So the user-facing action is identical either way, and the
 * only thing that changes is whether the registry calls a server flagged or
 * admits its readings would not converge. The second is true; the first is a
 * claim about somebody's code that we cannot support.
 *
 * The caller resolves ties by asking for a third reading before it gets here —
 * see `TIEBREAK_VARIANT` in reviewServer. This function is what happens when even
 * that does not converge.
 *
 * A finding only one run reported is kept — dropping evidence is worse than
 * showing it — but its severity is capped, and `runs` on the finding says how
 * many runs saw it.
 */
export function mergeRuns(runs) {
  const valid = runs.filter((r) => r.parsed);
  const parsed = valid.map((r) => r.parsed);

  if (parsed.length === 0) {
    return { verdict: 'unreviewable', reason: null, severity: 0, findings: [], statedIntentSummary: '', agreementRuns: 0, agreed: false };
  }

  // Findings first — they are the same computation in every branch.
  const counted = new Map();
  for (const p of parsed) {
    for (const f of p.findings) {
      const key = findingKey(f);
      const prev = counted.get(key);
      if (!prev) counted.set(key, { ...f, runs: 1 });
      else counted.set(key, { ...prev, runs: prev.runs + 1, severity: Math.max(prev.severity, f.severity) });
    }
  }

  if (parsed.length === 1) {
    const only = parsed[0];
    const findings = [...counted.values()].map((f) => ({ ...f, severity: Math.min(f.severity, DISAGREEMENT_SEVERITY_CAP) }));
    if (only.verdict === 'clean') {
      return {
        verdict: 'unreviewable', reason: null, severity: 0, findings,
        statedIntentSummary: only.statedIntentSummary, agreementRuns: 1, agreed: false,
        note: 'one run of two produced a usable answer; a single run cannot deliver a clean verdict',
      };
    }
    return {
      verdict: only.verdict, reason: only.reason,
      severity: Math.min(only.severity, DISAGREEMENT_SEVERITY_CAP),
      findings, statedIntentSummary: only.statedIntentSummary, agreementRuns: 1, agreed: false,
      note: 'one run of two produced a usable answer; severity capped',
    };
  }

  const summary = parsed.find((p) => p.statedIntentSummary)?.statedIntentSummary ?? '';

  // A finding seen by only one run is a single dissenting run, whether the panel
  // was two readings or three.
  const findings = [...counted.values()].map((f) => (
    f.runs >= 2 ? f : { ...f, severity: Math.min(f.severity, DISAGREEMENT_SEVERITY_CAP) }
  ));

  // Tally the verdicts rather than compare a pair: the panel is two readings
  // normally and three when the first two split.
  const tally = new Map();
  for (const p of parsed) tally.set(p.verdict, (tally.get(p.verdict) ?? 0) + 1);
  const [topVerdict, topCount] = [...tally.entries()].sort((x, y) => y[1] - x[1])[0];
  const majority = parsed.filter((p) => p.verdict === topVerdict);

  if (topCount === parsed.length) {
    const severities = majority.map((p) => p.severity);
    const reasons = new Set(majority.map((p) => p.reason));
    return {
      verdict: topVerdict,
      reason: reasons.size === 1 ? [...reasons][0] : null,
      severity: Math.min(...severities),
      findings,
      statedIntentSummary: summary,
      agreementRuns: parsed.length,
      agreed: true,
      ...(new Set(severities).size === 1 ? {} : {
        note: `runs agreed on the verdict but not the severity (${severities.join(' vs ')}); the lower one stands`,
      }),
    };
  }

  if (topCount * 2 > parsed.length) {
    const severities = majority.map((p) => p.severity);
    // A `clean` verdict carrying findings is contradictory — the schema rejects
    // it, and rightly: a finding is a claim, and the panel has just decided not
    // to make it. So when the majority is clean the minority's findings do not
    // travel in `findings`. They are NOT lost: every run's raw output is kept in
    // `rawModelOutput` and goes into the evidence blob, and the note below
    // records that a reading dissented and how much it claimed. What is refused
    // is publishing a `clean` verdict that quietly ships an accusation inside it.
    const setAside = topVerdict === 'clean' ? findings.length : 0;
    return {
      verdict: topVerdict,
      reason: null,
      severity: Math.min(...severities),
      findings: setAside ? [] : findings,
      statedIntentSummary: summary,
      agreementRuns: topCount,
      agreed: false,
      note:
        `${topCount} of ${parsed.length} readings returned ${topVerdict}; the dissenting reading does not decide` +
        (setAside
          ? `, and its ${setAside} finding(s) are set aside rather than shipped inside a clean verdict — the raw output of every reading is kept in the evidence`
          : ''),
    };
  }

  // No majority. See the note on this function: the cautious side of a split is
  // an accusation produced by sampling noise, and `unreviewable` warns exactly
  // as a capped `flagged` did.
  return {
    verdict: 'unreviewable',
    reason: 'no-agreement',
    severity: 0,
    findings,
    statedIntentSummary: summary,
    agreementRuns: 1,
    agreed: false,
    note: `the readings did not converge (${parsed.map((p) => p.verdict).join(', ')}); no majority formed, so no verdict is claimed`,
  };
}

// ---------------------------------------------------------------------------
// the review
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ReviewInput
 * @property {string=} fingerprint          SXF-1, passed through for provenance
 * @property {object}  statedIntent         {name, tools:[{name,description,inputSchema}], readme}
 * @property {{path:string,text:string}[]} files   the source tree, as fetched from the Walrus blob
 */

/**
 * Review one server.
 *
 * @param {ReviewInput} input
 * @param {object} [options]
 * @param {object}   [options.config]      from resolveConfig(); resolved from env if omitted
 * @param {Function} [options.fetchImpl]   injected in tests
 * @param {string}   [options.fixturesDir]
 * @param {boolean}  [options.allowCache]  serve a recorded run when the endpoint is unreachable
 * @param {boolean}  [options.writeCache]  record a real run as a demo-recovery fixture
 * @returns {Promise<object>} a validated ReviewRecord (the Walrus blob body)
 */
export async function reviewServer(input, options = {}) {
  const {
    config = resolveConfig(),
    fetchImpl,
    fixturesDir = FIXTURES_DIR,
    allowCache = true,
    writeCache = true,
    now = () => new Date(),
    // Sized for this repo's fixtures by default. A caller reviewing a real npm
    // package must supply a budget that fits its model's context — see the note
    // on renderSource in prompt.mjs, and read `run.sourceCoverage` afterwards.
    limits = undefined,
  } = options;

  const startedAt = now();
  const files = input?.files ?? [];
  const statedIntent = input?.statedIntent ?? {};

  // --- layer 1: deterministic capability scan -------------------------------
  // Runs first and unconditionally. Every path out of this function carries it,
  // including the failure paths, because "we could not review it" and "we cannot
  // tell you what it can reach" are two different admissions.
  const scan = files.length ? scanFiles(files) : { capabilities: emptyCapabilities(), sites: [], meta: { filesScanned: 0, filesSkipped: [] } };

  // --- layer 2: deterministic injection scan --------------------------------
  const injectionHits = scanAllInjection({ files, statedIntent });
  const injectionFindings = injectionHits.map(injectionFinding);

  const key = inputKey({ statedIntent, files, modelId: config.modelId });
  const endpoint = { label: config.label, fingerprint: endpointFingerprint(config.baseUrl) };

  // --- layer 3: the model, twice --------------------------------------------
  const fenceId = newFenceId();
  const runResults = [];
  let omittedFromPrompt = [];
  const runOnce = async (variant, fence) => {
    const built = buildPrompt({ variant, statedIntent, files, fenceId: fence, ...(limits ? { limits } : {}) });
    omittedFromPrompt = built.omitted ?? [];
    const call = await callModel({ messages: built.messages, config, fetchImpl });
    runResults.push(interpretRun(variant, call));
  };

  for (const variant of VARIANTS) await runOnce(variant, fenceId);

  // The tie-break. Calibration showed that on a borderline server the split
  // itself is sampling noise — `honest-sqlite` returned flagged, clean, clean on
  // three identical inputs — and the old rule turned that coin flip into a
  // published accusation. So a split buys another reading of EACH variant and
  // the merge takes the majority of four; see TIEBREAK_VARIANTS for why both and
  // not one.
  //
  // Each extra reading gets a fresh fence nonce, which is what makes it a new
  // sample rather than a replay: sampling is greedy, so a re-run under the same
  // nonce returns the same answer and decides nothing.
  const firstTwo = runResults.filter((r) => r.parsed).map((r) => r.parsed.verdict);
  if (firstTwo.length === 2 && firstTwo[0] !== firstTwo[1]) {
    for (const variant of TIEBREAK_VARIANTS) await runOnce(variant, newFenceId());
  }

  const usable = runResults.filter((r) => r.parsed).length;
  const transportFailures = runResults.filter((r) => !r.call.ok);

  // --- the cache: only when the endpoint could not be reached ---------------
  // Not an optimisation and not a shortcut. A reachable endpoint that returns
  // nonsense is a real `unreviewable` result and must be reported as one — the
  // cache is for the tunnel dropping, not for a bad answer.
  if (usable === 0 && transportFailures.length === runResults.length && allowCache) {
    const fixture = readFixture(key, { dir: fixturesDir });
    if (fixture?.kind === REVIEW_KIND && fixture.value) {
      return serveFromCache(fixture, { scan, endpoint, servedAt: startedAt.toISOString() });
    }
  }

  const merged = mergeRuns(runResults);

  // Deterministic findings are merged on top of the model's, and they do not
  // wait for the runs to agree — a regex has no attention to hijack, so its
  // conclusion is not a "single dissenting run". FR-22: severity 4.
  //
  // The model's paths are reconciled against the files we handed it first, so a
  // block message never points a developer at a file that is not there.
  const reconciled = reconcileFindingPaths(merged.findings, files, statedIntentPaths(statedIntent));
  const collapsed = collapseInjectionDuplicates(dedupeFindings([...injectionFindings, ...reconciled]));
  const findings = collapsed.findings;
  const deterministicSeverity = injectionFindings.length ? 4 : 0;

  let verdict = merged.verdict;
  let severity = clampSeverity(Math.max(merged.severity, deterministicSeverity));
  const notes = merged.note ? [merged.note] : [];

  if (injectionFindings.length) {
    if (usable > 0) {
      verdict = 'flagged';
      severity = 4;
      notes.push('a planted instruction aimed at the reviewer was found by the deterministic scan; that finding does not depend on the model runs');
    } else {
      // The model review did not complete, so the verdict stays `unreviewable`.
      // The deterministic finding is still reported — we know that much.
      notes.push('the model review did not complete, but the deterministic scan found a planted instruction aimed at the reviewer');
    }
  }

  const finishedAt = now();
  const runMeta = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    endpoint,
    cached: false,
    inputKey: key,
    runs: runResults.map((r) => ({
      variant: r.variant,
      ok: r.call.ok,
      parsed: Boolean(r.parsed),
      ms: r.call.ms,
      attempts: r.call.attempts,
      usage: r.call.usage ?? null,
      error: r.error ?? null,
    })),
    capabilityScan: scan.meta,
    // What the MODEL was actually shown. The capability scan reads every file it
    // is given; the prompt is budgeted, so on anything larger than a fixture the
    // two differ — and a verdict that does not say which files it could not see
    // is claiming more than it knows.
    sourceCoverage: {
      filesSupplied: files.length,
      filesOmittedOrTruncated: omittedFromPrompt.length,
      omitted: omittedFromPrompt,
    },
    notes,
  };
  if (omittedFromPrompt.length) {
    notes.push(
      `${omittedFromPrompt.length} of ${files.length} supplied file(s) were omitted from or truncated in the ` +
      'prompt to fit the model context; the deterministic capability scan still read all of them',
    );
  }
  if (collapsed.collapsed) {
    notes.push(`${collapsed.collapsed} model-reported injection finding(s) collapsed into the deterministic scan's exact line for the same file`);
  }
  const renamed = findings.filter((f) => f.pathNormalisedFrom).length;
  if (renamed) notes.push(`${renamed} finding path(s) rewritten to the paths supplied to the reviewer`);
  const unplaceable = findings.filter((f) => f.pathUnresolved || f.lineOutOfRange).length;
  if (unplaceable) notes.push(`${unplaceable} finding(s) could not be placed in a supplied file and are marked unresolved`);

  const errors = runResults.filter((r) => r.error).map((r) => `run ${r.variant}: ${r.error}`);

  let record;
  if (verdict === 'unreviewable' && usable < 2) {
    record = unreviewableRecord({
      errors: errors.length ? errors : ['the two runs did not produce a verdict that could stand'],
      capabilities: scan.capabilities,
      findings,
      modelId: config.modelId,
      promptVersion: PROMPT_VERSION,
      agreementRuns: merged.agreementRuns,
      statedIntentSummary: merged.statedIntentSummary,
      extra: { rawModelOutput: rawOutputs(runResults), run: runMeta, fingerprint: input?.fingerprint ?? null },
    });
    // `unreviewableRecord` derives severity from findings; the deterministic
    // floor still applies.
    record.severity = clampSeverity(Math.max(record.severity, deterministicSeverity));
  } else {
    record = {
      verdict,
      reason: merged.reason ?? null,
      severity,
      findings,
      statedIntentSummary: merged.statedIntentSummary,
      capabilities: scan.capabilities,
      modelId: config.modelId,
      promptVersion: PROMPT_VERSION,
      agreementRuns: merged.agreementRuns,
      rawModelOutput: rawOutputs(runResults),
      run: runMeta,
      fingerprint: input?.fingerprint ?? null,
      ...(errors.length ? { reviewErrors: errors } : {}),
    };
  }

  record.notice = reviewNotice(record);

  const check = validateReviewRecord(record);
  if (!check.ok) {
    // A record we built ourselves and cannot validate is a bug here, not a bad
    // model. It still must not become a `clean` verdict.
    const fallback = unreviewableRecord({
      errors: [`assembled record failed validation: ${check.errors.join('; ')}`],
      capabilities: scan.capabilities,
      findings,
      modelId: config.modelId,
      promptVersion: PROMPT_VERSION,
      agreementRuns: merged.agreementRuns,
      statedIntentSummary: merged.statedIntentSummary,
      extra: { rawModelOutput: rawOutputs(runResults), run: runMeta, fingerprint: input?.fingerprint ?? null },
    });
    fallback.notice = reviewNotice(fallback);
    return fallback;
  }

  // Record it. A real run that reached the model is worth keeping even when the
  // verdict is `unreviewable` — that is a real result about a real input, and it
  // is what the demo will have to fall back on.
  if (writeCache && usable > 0) {
    writeFixture(key, {
      kind: REVIEW_KIND,
      promptVersion: PROMPT_VERSION,
      modelId: config.modelId,
      endpoint,
      durationMs: runMeta.durationMs,
      value: record,
    }, { dir: fixturesDir });
  }

  return record;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function interpretRun(variant, call) {
  if (!call.ok) {
    return { variant, call, parsed: null, error: `${call.error.code}: ${call.error.message}` };
  }
  const json = extractJson(call.text);
  if (!json.ok) return { variant, call, parsed: null, error: json.error };
  const validated = validateModelOutput(json.value);
  if (!validated.ok) return { variant, call, parsed: null, error: validated.errors.join('; ') };
  return { variant, call, parsed: validated.value, error: null };
}

/**
 * Reconcile every model-reported `file` and `line` against the input we actually
 * handed it.
 *
 * Observed on the first real run against the DGX: asked to review
 * `packages/fixture-mcp/src/tools/search.mjs`, the model reported findings in
 * `src/tools/search.mjs`. Not a hallucination — a shortened path — but the block
 * message tells a developer to open a file at a line, so a path that does not
 * resolve is a fabricated file:line as far as the reader is concerned.
 *
 * Rules:
 *   exact match                  → kept as is.
 *   unique suffix match          → rewritten to the path we supplied, with
 *                                  `pathNormalisedFrom` recording what the model
 *                                  said. A rewrite has to be unambiguous.
 *   line beyond the end of file  → kept, marked `lineOutOfRange`.
 *   nothing matches              → kept, marked `pathUnresolved`.
 *
 * Nothing is dropped — a finding we cannot place may still be true. It is
 * labelled, so a surface can decline to quote it as *the* evidence.
 */
export function reconcileFindingPaths(findings, files, pseudoPaths = new Set()) {
  const lineCounts = new Map();
  for (const f of files ?? []) {
    if (f && typeof f.path === 'string' && typeof f.text === 'string') {
      lineCounts.set(f.path, f.text.split(/\r?\n/).length);
    }
  }
  const known = [...lineCounts.keys()];

  return findings.map((finding) => {
    const claimed = String(finding.file ?? '');
    let path = claimed;
    let out = { ...finding };

    if (!lineCounts.has(claimed)) {
      if (pseudoPaths.has(claimed)) return out;               // a stated-intent pseudo-path we generated
      const candidates = known.filter((k) => k === claimed || k.endsWith(`/${claimed}`) || claimed.endsWith(`/${k}`));
      if (candidates.length === 1) {
        path = candidates[0];
        out = { ...out, file: path, pathNormalisedFrom: claimed };
      } else {
        return { ...out, pathUnresolved: true };
      }
    }

    const max = lineCounts.get(path);
    if (max !== undefined && Number(out.line) > max) out = { ...out, lineOutOfRange: true };
    return out;
  });
}

/**
 * The deterministic injection scan reports an exact line. When it has already
 * fired on a file, the model's own injection findings for that same file are
 * removed as duplicates: they describe the same planted text, from a source that
 * can be steered, at a line that is usually a few off. Keeping both turned two
 * planted comments into five findings on the first real run.
 *
 * Only `reviewer-injection` is collapsed, and only where the deterministic scan
 * covers the file. Everything else the model found is untouched.
 */
export function collapseInjectionDuplicates(findings) {
  const covered = new Set(
    findings.filter((f) => f.category === 'reviewer-injection' && f.detectedBy === 'deterministic-scan').map((f) => f.file),
  );
  if (!covered.size) return { findings, collapsed: 0 };
  const kept = findings.filter((f) => !(
    f.category === 'reviewer-injection' && f.detectedBy !== 'deterministic-scan' && covered.has(f.file)
  ));
  return { findings: kept, collapsed: findings.length - kept.length };
}

function dedupeFindings(findings) {
  const out = new Map();
  for (const f of findings) {
    const key = findingKey(f);
    const prev = out.get(key);
    if (!prev || f.severity > prev.severity) out.set(key, f);
  }
  return [...out.values()].sort((a, b) => b.severity - a.severity
    || String(a.file).localeCompare(String(b.file))
    || a.line - b.line);
}

/** Kept per tech-spec §4.1 (`rawModelOutput` in the blob body), bounded. */
function rawOutputs(runResults) {
  return runResults.map((r) => ({
    variant: r.variant,
    ok: r.call.ok,
    text: r.call.ok ? String(r.call.text ?? '').slice(0, 20_000) : null,
    error: r.error ?? null,
  }));
}

/**
 * Serve a recorded run.
 *
 * The recorded verdict and findings are returned verbatim — rewriting them would
 * make the fixture a draft rather than a record. What changes is the provenance:
 * `cached: true`, the original `recordedAt`, and a notice that says so in the
 * first clause. Never presented as fresh.
 *
 * The capability scan is re-run live rather than replayed, because it is
 * deterministic and costs nothing — and if it ever disagrees with the recorded
 * one, that difference is worth seeing.
 */
function serveFromCache(fixture, { scan, endpoint, servedAt }) {
  const record = {
    ...fixture.value,
    capabilities: scan.capabilities,
    run: {
      ...(fixture.value.run ?? {}),
      cached: true,
      cachedFrom: fixture.recordedAt,
      servedAt,
      endpoint: { ...endpoint, recordedEndpoint: fixture.endpoint ?? null },
      capabilityScan: scan.meta,
      notes: [
        ...(fixture.value.run?.notes ?? []),
        'the reviewer endpoint was unreachable; this is a recorded run served from the demo-recovery cache',
      ],
    },
  };
  record.notice = reviewNotice(record);
  return record;
}

export { inputKey, PROMPT_VERSION };
