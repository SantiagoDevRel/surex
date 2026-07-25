// Output validation. Hand-rolled, zero dependencies — same rule as @surex/core.
//
// The hard rule this file exists to enforce (tech-spec §6):
//
//     A MALFORMED MODEL RESPONSE IS A FAILED REVIEW (`unreviewable`).
//     IT IS NEVER A `clean` VERDICT.
//
// `clean` is the only verdict that causes SureX to say nothing at all. A parser
// that shrugs at a broken response and defaults to `clean` would turn every
// model hiccup into a silent pass — which is exactly the laundering service the
// spec warns about. So validation here is strict, it returns errors rather than
// guesses, and the only fallback constructor in this file builds an
// `unreviewable` record.

export const VERDICTS = Object.freeze(['clean', 'flagged', 'unreviewable']);

/** The closed `reason` enum from the contract. `null` means "no special reason". */
export const REASONS = Object.freeze(['licence', 'source-unavailable', 'remote-endpoint']);

export const CAPABILITY_KEYS = Object.freeze([
  'network', 'filesystem', 'exec', 'env', 'credentials',
]);

export const MAX_SEVERITY = 4;

/** The one category that is asserted deterministically, never taken from a model. */
export const INJECTION_CATEGORY = 'reviewer-injection';

/** Ceiling applied whenever the two runs did not agree (tech-spec §6.3). */
export const DISAGREEMENT_SEVERITY_CAP = 2;

// ---------------------------------------------------------------------------
// primitives
// ---------------------------------------------------------------------------

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Models emit `"severity": "3"` roughly as often as `3`. Coercing a numeric
 * string is parsing, not guessing — the value is unambiguous. Anything that is
 * not a finite number after that is an error, never a default.
 */
function asInt(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return Math.trunc(Number(value.trim()));
  }
  return null;
}

function asString(value) {
  return typeof value === 'string' ? value : null;
}

export function clampSeverity(n) {
  const i = asInt(n);
  if (i === null) return 0;
  return Math.max(0, Math.min(MAX_SEVERITY, i));
}

// ---------------------------------------------------------------------------
// getting JSON out of a chat completion
// ---------------------------------------------------------------------------

/**
 * Pull the JSON object out of a completion body.
 *
 * Ollama honours `response_format: {type:'json_object'}` for some models and
 * ignores it for others, and a reasoning model will happily wrap the object in
 * a ```json fence or a sentence of preamble. Locating the object inside that is
 * parsing. Repairing a truncated or contradictory object would not be, and this
 * function does not attempt it: if brace balancing does not land on valid JSON,
 * it fails.
 *
 * @returns {{ok:true, value:object} | {ok:false, error:string}}
 */
export function extractJson(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, error: 'empty model response' };
  }

  const direct = tryParse(text.trim());
  if (direct.ok) return direct;

  // Strip a fenced block if there is exactly one obvious candidate.
  const fenced = text.match(/```(?:json|jsonc)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const inner = tryParse(fenced[1].trim());
    if (inner.ok) return inner;
  }

  // Last resort: balance braces from the first `{`, ignoring braces in strings.
  const start = text.indexOf('{');
  if (start === -1) return { ok: false, error: 'no JSON object in model response' };
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return tryParse(text.slice(start, i + 1));
    }
  }
  return { ok: false, error: 'unterminated JSON object in model response' };
}

function tryParse(s) {
  try {
    const value = JSON.parse(s);
    if (!isPlainObject(value)) return { ok: false, error: 'model response is not a JSON object' };
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: `invalid JSON: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// the model's own output
// ---------------------------------------------------------------------------

/**
 * Validate one model run. The model is asked for judgement only — it is never
 * asked for `capabilities`, because that surface comes from the static scan and
 * must not be influenceable by the text being reviewed. A `capabilities` key in
 * a model response is dropped on the floor here, deliberately and silently.
 *
 * @returns {{ok:true, value:object} | {ok:false, errors:string[]}}
 */
export function validateModelOutput(raw) {
  const errors = [];
  if (!isPlainObject(raw)) return { ok: false, errors: ['response is not an object'] };

  const verdict = asString(raw.verdict);
  if (!verdict || !VERDICTS.includes(verdict)) {
    errors.push(`verdict must be one of ${VERDICTS.join('|')} (got ${JSON.stringify(raw.verdict)})`);
  }

  let reason = null;
  if (raw.reason !== undefined && raw.reason !== null && raw.reason !== '') {
    const r = asString(raw.reason);
    if (!r || !REASONS.includes(r)) {
      errors.push(`reason must be null or one of ${REASONS.join('|')} (got ${JSON.stringify(raw.reason)})`);
    } else {
      reason = r;
    }
  }

  const severity = asInt(raw.severity);
  if (severity === null || severity < 0 || severity > MAX_SEVERITY) {
    errors.push(`severity must be an integer 0-${MAX_SEVERITY} (got ${JSON.stringify(raw.severity)})`);
  }

  const summary = asString(raw.statedIntentSummary);
  if (summary === null) errors.push('statedIntentSummary must be a string');

  const findings = [];
  if (!Array.isArray(raw.findings)) {
    errors.push('findings must be an array');
  } else {
    raw.findings.forEach((f, i) => {
      const fErrors = [];
      if (!isPlainObject(f)) {
        errors.push(`findings[${i}] is not an object`);
        return;
      }
      const file = asString(f.file);
      if (!file) fErrors.push('file must be a string');
      const line = asInt(f.line);
      if (line === null || line < 0) fErrors.push('line must be a non-negative integer');
      const category = asString(f.category);
      if (!category) fErrors.push('category must be a string');
      const description = asString(f.description);
      if (!description) fErrors.push('description must be a string');
      const fSeverity = asInt(f.severity);
      if (fSeverity === null || fSeverity < 0 || fSeverity > MAX_SEVERITY) {
        fErrors.push(`severity must be an integer 0-${MAX_SEVERITY}`);
      }
      if (fErrors.length) {
        errors.push(`findings[${i}]: ${fErrors.join('; ')}`);
        return;
      }
      findings.push({ file, line, category, description, severity: fSeverity });
    });
  }

  // A `clean` verdict carrying severity or findings is internally contradictory.
  // Trusting either half of it would be a coin flip, so the response fails.
  if (verdict === 'clean') {
    if (severity !== null && severity > 0) errors.push('clean verdict with severity > 0');
    if (findings.some((f) => f.severity > 0)) errors.push('clean verdict with a non-zero-severity finding');
  }
  if (verdict === 'flagged' && findings.length === 0) {
    errors.push('flagged verdict with no findings — a flag with no evidence is not actionable');
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: { verdict, reason, severity, findings, statedIntentSummary: summary },
  };
}

// ---------------------------------------------------------------------------
// the assembled record
// ---------------------------------------------------------------------------

/**
 * Validate the full ReviewRecord blob body (tech-spec §4.1, §6) before it is
 * written anywhere. Called on the way out of `reviewServer`, so a bug in the
 * merge cannot produce a record that the API would later have to guess about.
 */
export function validateReviewRecord(raw) {
  const errors = [];
  if (!isPlainObject(raw)) return { ok: false, errors: ['record is not an object'] };

  if (!VERDICTS.includes(raw.verdict)) errors.push(`verdict must be one of ${VERDICTS.join('|')}`);
  if (raw.reason !== null && !REASONS.includes(raw.reason)) {
    errors.push(`reason must be null or one of ${REASONS.join('|')}`);
  }
  const severity = asInt(raw.severity);
  if (severity === null || severity < 0 || severity > MAX_SEVERITY) {
    errors.push(`severity must be an integer 0-${MAX_SEVERITY}`);
  }
  if (raw.verdict === 'clean' && severity > 0) errors.push('clean verdict with severity > 0');

  if (!Array.isArray(raw.findings)) errors.push('findings must be an array');
  if (typeof raw.statedIntentSummary !== 'string') errors.push('statedIntentSummary must be a string');
  if (typeof raw.modelId !== 'string' || !raw.modelId) errors.push('modelId must be a non-empty string');
  if (typeof raw.promptVersion !== 'string' || !raw.promptVersion) {
    errors.push('promptVersion must be a non-empty string');
  }
  const runs = asInt(raw.agreementRuns);
  if (runs === null || runs < 0 || runs > 2) errors.push('agreementRuns must be 0, 1 or 2');

  if (!isPlainObject(raw.capabilities)) {
    errors.push('capabilities must be an object');
  } else {
    for (const key of CAPABILITY_KEYS) {
      const c = raw.capabilities[key];
      if (!isPlainObject(c)) {
        errors.push(`capabilities.${key} missing`);
        continue;
      }
      if (typeof c.present !== 'boolean') errors.push(`capabilities.${key}.present must be a boolean`);
      if (!Array.isArray(c.evidence)) errors.push(`capabilities.${key}.evidence must be an array`);
      else if (c.present && c.evidence.length === 0) {
        errors.push(`capabilities.${key}.present is true with no evidence`);
      }
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: raw };
}

/**
 * The only fallback constructor in this file, and it builds the failed state.
 * Anything that cannot produce a validated review comes through here.
 *
 * @param {object} parts
 * @param {string[]} parts.errors        why the review failed, verbatim
 * @param {object}   parts.capabilities  the static scan — still real, still shown
 * @param {object[]} [parts.findings]    deterministic findings survive a model failure
 */
export function unreviewableRecord({
  errors, capabilities, findings = [], modelId, promptVersion, agreementRuns = 0,
  statedIntentSummary = '', reason = null, extra = {},
}) {
  const severity = findings.reduce((max, f) => Math.max(max, clampSeverity(f.severity)), 0);
  return {
    verdict: 'unreviewable',
    reason,
    severity,
    findings,
    statedIntentSummary,
    capabilities,
    modelId: modelId || 'none',
    promptVersion,
    agreementRuns,
    reviewErrors: errors,
    ...extra,
  };
}
