import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractJson, validateModelOutput, validateReviewRecord, unreviewableRecord,
  VERDICTS, REASONS, CAPABILITY_KEYS, clampSeverity,
} from '../src/schema.mjs';
import { emptyCapabilities } from '../src/capabilities.mjs';
import { mergeRuns } from '../src/review.mjs';
import { extractAssistantText, resolveConfig, DEFAULT_MODEL_ID, DEFAULT_TIMEOUT_MS } from '../src/model.mjs';

const GOOD = {
  verdict: 'flagged',
  reason: null,
  severity: 3,
  findings: [{ file: 'src/x.ts', line: 88, category: 'exfiltration', description: 'sends a key out', severity: 3 }],
  statedIntentSummary: 'Claims to search notes.',
};

test('extractJson parses a bare object', () => {
  const r = extractJson(JSON.stringify(GOOD));
  assert.equal(r.ok, true);
  assert.equal(r.value.verdict, 'flagged');
});

test('extractJson survives a markdown fence and a sentence of preamble', () => {
  const fenced = extractJson('Here is my review:\n```json\n{"verdict":"clean"}\n```\nHope that helps.');
  assert.equal(fenced.ok, true);
  assert.equal(fenced.value.verdict, 'clean');
});

test('extractJson ignores braces inside strings when balancing', () => {
  const r = extractJson('noise {"a":"a } brace","b":2} trailing');
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { a: 'a } brace', b: 2 });
});

test('extractJson fails on a truncated object rather than repairing it', () => {
  const r = extractJson('{"verdict":"clean","findings":[');
  assert.equal(r.ok, false);
  assert.match(r.error, /unterminated/);
});

test('extractJson fails on prose with no object at all', () => {
  assert.equal(extractJson('Looks fine to me.').ok, false);
  assert.equal(extractJson('').ok, false);
  assert.equal(extractJson(null).ok, false);
});

test('extractJson refuses a JSON array — the contract is an object', () => {
  assert.equal(extractJson('[1,2,3]').ok, false);
});

test('a well-formed run validates and keeps only contract fields', () => {
  const r = validateModelOutput({ ...GOOD, capabilities: { network: { present: false } } });
  assert.equal(r.ok, true);
  // The model is never the source of the capability surface.
  assert.equal('capabilities' in r.value, false);
});

test('numeric strings are coerced, anything else is an error', () => {
  const ok = validateModelOutput({ ...GOOD, severity: '3', findings: [{ ...GOOD.findings[0], line: '88', severity: '3' }] });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.severity, 3);
  assert.equal(ok.value.findings[0].line, 88);

  const bad = validateModelOutput({ ...GOOD, severity: 'high' });
  assert.equal(bad.ok, false);
});

test('an unknown verdict is rejected, never coerced to clean', () => {
  for (const verdict of ['ok', 'CLEAN', 'safe', '', null, 5]) {
    const r = validateModelOutput({ ...GOOD, verdict });
    assert.equal(r.ok, false, `verdict ${JSON.stringify(verdict)} should be rejected`);
  }
  for (const verdict of VERDICTS) {
    const findings = verdict === 'clean' ? [] : GOOD.findings;
    const severity = verdict === 'clean' ? 0 : 3;
    assert.equal(validateModelOutput({ ...GOOD, verdict, findings, severity }).ok, true, verdict);
  }
});

test('an out-of-enum reason is rejected', () => {
  assert.equal(validateModelOutput({ ...GOOD, reason: 'because' }).ok, false);
  for (const reason of REASONS) assert.equal(validateModelOutput({ ...GOOD, reason }).ok, true, reason);
  assert.equal(validateModelOutput({ ...GOOD, reason: null }).ok, true);
});

test('severity outside 0-4 is rejected', () => {
  assert.equal(validateModelOutput({ ...GOOD, severity: 5 }).ok, false);
  assert.equal(validateModelOutput({ ...GOOD, severity: -1 }).ok, false);
});

test('a finding without a real file or line is rejected — the block message needs both', () => {
  assert.equal(validateModelOutput({ ...GOOD, findings: [{ ...GOOD.findings[0], file: '' }] }).ok, false);
  assert.equal(validateModelOutput({ ...GOOD, findings: [{ ...GOOD.findings[0], line: undefined }] }).ok, false);
  assert.equal(validateModelOutput({ ...GOOD, findings: [{ ...GOOD.findings[0], line: 'somewhere' }] }).ok, false);
  assert.equal(validateModelOutput({ ...GOOD, findings: [{ ...GOOD.findings[0], description: null }] }).ok, false);
});

test('findings must be an array, not a string the model felt like writing', () => {
  assert.equal(validateModelOutput({ ...GOOD, findings: 'none' }).ok, false);
});

test('a flagged verdict with no findings is rejected', () => {
  assert.equal(validateModelOutput({ ...GOOD, findings: [] }).ok, false);
});

test('a clean verdict carrying severity or a finding is rejected as contradictory', () => {
  assert.equal(validateModelOutput({ ...GOOD, verdict: 'clean', severity: 2, findings: [] }).ok, false);
  assert.equal(validateModelOutput({ ...GOOD, verdict: 'clean', severity: 0 }).ok, false);
});

test('a non-object response is rejected', () => {
  for (const raw of [null, undefined, 'clean', 42, []]) assert.equal(validateModelOutput(raw).ok, false);
});

const RECORD = {
  verdict: 'flagged', reason: null, severity: 3, findings: GOOD.findings,
  statedIntentSummary: 'x', capabilities: emptyCapabilities(),
  modelId: 'm:1', promptVersion: 'rv-1', agreementRuns: 2,
};

test('a complete record validates', () => {
  assert.equal(validateReviewRecord(RECORD).ok, true);
});

test('a record missing any capability category is rejected', () => {
  for (const key of CAPABILITY_KEYS) {
    const capabilities = { ...emptyCapabilities() };
    delete capabilities[key];
    const r = validateReviewRecord({ ...RECORD, capabilities });
    assert.equal(r.ok, false, `${key} missing should fail`);
  }
});

test('a capability claiming present with no evidence is rejected', () => {
  const capabilities = { ...emptyCapabilities(), network: { present: true, evidence: [], evidenceTotal: 0 } };
  assert.equal(validateReviewRecord({ ...RECORD, capabilities }).ok, false);
});

test('a record must name a model and a prompt version', () => {
  assert.equal(validateReviewRecord({ ...RECORD, modelId: '' }).ok, false);
  assert.equal(validateReviewRecord({ ...RECORD, promptVersion: undefined }).ok, false);
});

test('agreementRuns is bounded by the panel — at most four readings', () => {
  // Two paraphrased readings, plus one more of each when those two disagree. Five
  // would mean a panel nothing in the reviewer can produce.
  assert.equal(validateReviewRecord({ ...RECORD, agreementRuns: 5 }).ok, false);
  assert.equal(validateReviewRecord({ ...RECORD, agreementRuns: -1 }).ok, false);
  for (const n of [0, 1, 2, 3, 4]) assert.equal(validateReviewRecord({ ...RECORD, agreementRuns: n }).ok, true);
});

test('unreviewableRecord is the only fallback, and it is never clean', () => {
  const record = unreviewableRecord({
    errors: ['model returned prose'], capabilities: emptyCapabilities(),
    modelId: 'm:1', promptVersion: 'rv-1',
  });
  assert.equal(record.verdict, 'unreviewable');
  assert.notEqual(record.verdict, 'clean');
  assert.equal(record.severity, 0);
  assert.deepEqual(record.reviewErrors, ['model returned prose']);
  assert.equal(validateReviewRecord(record).ok, true);
});

test('unreviewableRecord takes its severity from the deterministic findings it kept', () => {
  const record = unreviewableRecord({
    errors: ['x'], capabilities: emptyCapabilities(), modelId: 'm', promptVersion: 'rv-1',
    findings: [{ file: 'a.ts', line: 1, category: 'reviewer-injection', description: 'y', severity: 4 }],
  });
  assert.equal(record.severity, 4);
  assert.equal(record.verdict, 'unreviewable');
});

test('clampSeverity keeps severity inside the contract', () => {
  assert.equal(clampSeverity(9), 4);
  assert.equal(clampSeverity(-3), 0);
  assert.equal(clampSeverity('2'), 2);
  assert.equal(clampSeverity('nonsense'), 0);
});

test('a reasoning model that spent its whole budget on thinking is an empty response, not a verdict', () => {
  // Verbatim shape from the DGX: gpt-oss:20b with max_tokens 8 returned the
  // reasoning and an empty content, with finish_reason "length".
  const body = {
    choices: [{ index: 0, message: { role: 'assistant', content: '', reasoning: 'The user says "say' }, finish_reason: 'length' }],
  };
  const out = extractAssistantText(body);
  assert.equal(out.text, '');
  assert.equal(out.finishReason, 'length');
  assert.ok(out.error, 'must be reported as an error, not parsed');
});

test('inline <think> reasoning is stripped, leaving the answer', () => {
  const body = { choices: [{ message: { content: '<think>hmm, let me look</think>\n{"verdict":"clean"}' }, finish_reason: 'stop' }] };
  const out = extractAssistantText(body);
  assert.equal(out.error, null);
  assert.equal(extractJson(out.text).value.verdict, 'clean');
});

test('an unterminated <think> block leaves nothing, and that is an error', () => {
  const body = { choices: [{ message: { content: '<think>still thinking and then it stopped' }, finish_reason: 'stop' }] };
  assert.ok(extractAssistantText(body).error);
});

test('there is NO default base URL — an unset endpoint is a configuration error', () => {
  const config = resolveConfig({});
  assert.equal(config.baseUrl, null);
  assert.equal(config.modelId, DEFAULT_MODEL_ID);
  assert.equal(config.timeoutMs, DEFAULT_TIMEOUT_MS);
});

test('one environment variable switches the endpoint, and a trailing slash is tolerated', () => {
  const config = resolveConfig({ SUREX_REVIEWER_BASE_URL: 'https://oss.example.com/v1/', SUREX_REVIEWER_MODEL: 'other:70b' });
  assert.equal(config.baseUrl, 'https://oss.example.com/v1');
  assert.equal(config.modelId, 'other:70b');
});

test('a nonsense timeout falls back to the default rather than to zero', () => {
  assert.equal(resolveConfig({ SUREX_REVIEWER_TIMEOUT_MS: 'soon' }).timeoutMs, DEFAULT_TIMEOUT_MS);
  assert.equal(resolveConfig({ SUREX_REVIEWER_TIMEOUT_MS: '-5' }).timeoutMs, DEFAULT_TIMEOUT_MS);
  assert.equal(resolveConfig({ SUREX_REVIEWER_TIMEOUT_MS: '5000' }).timeoutMs, 5000);
});

test('one usable reading cannot publish the concern that accuses a person', () => {
  // The severity merge already caps a lone reading, so publishing
  // `deliberate-concealment` — the only value asserting purpose rather than
  // mechanism — uncapped from that same reading is an asymmetry.
  const one = mergeRuns([
    { parsed: { verdict: 'flagged', reason: null, severity: 4, concern: 'deliberate-concealment',
                assessment: 'It base64-encodes the destination.', findings: [], statedIntentSummary: 's' } },
    { error: 'timeout' },
  ]);
  assert.equal(one.agreementRuns, 1);
  assert.equal(one.concern, null, 'a single reading may not assert concealment');
  assert.equal(one.assessment, null, 'and the sentence arguing for it does not travel alone either');

  // A weaker concern from a single reading is still publishable — it describes a
  // mechanism, and the severity cap already limits what it can do.
  const weaker = mergeRuns([
    { parsed: { verdict: 'flagged', reason: null, severity: 3, concern: 'undeclared-behaviour',
                assessment: 'It pings a host the README never names.', findings: [], statedIntentSummary: 's' } },
    { error: 'timeout' },
  ]);
  assert.equal(weaker.concern, 'undeclared-behaviour');
  assert.match(weaker.assessment, /pings a host/);
});

test('the assessment never argues for a concern the panel rejected', () => {
  const merged = mergeRuns([
    { parsed: { verdict: 'flagged', reason: null, severity: 3, concern: 'deliberate-concealment',
                assessment: 'It base64-encodes the exfiltration URL so a reader will not spot it.',
                findings: [], statedIntentSummary: 's' } },
    { parsed: { verdict: 'flagged', reason: null, severity: 3, concern: 'undeclared-behaviour',
                assessment: null, findings: [], statedIntentSummary: 's' } },
  ]);
  assert.equal(merged.concern, 'undeclared-behaviour', 'the tie rounds down, away from the intent claim');
  assert.equal(merged.assessment, null, 'so the concealment sentence must not be published under it');
});

test('zero usable readings says nothing was read, not that readings disagreed', () => {
  const none = mergeRuns([{ error: 'connect ECONNREFUSED' }, { error: 'timeout' }]);
  assert.equal(none.verdict, 'unreviewable');
  assert.equal(none.reason, 'no-reading');
  assert.equal(none.agreementRuns, 0);
});
