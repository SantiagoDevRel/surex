#!/usr/bin/env node
// Run one review against the configured endpoint and print the record.
//
//   SUREX_REVIEWER_BASE_URL=http://host:11434/v1 \
//   SUREX_REVIEWER_MODEL=gpt-oss:20b \
//   node bin/surex-review.mjs --intent intent.json --file src/server.mjs [--file …]
//
//   node bin/surex-review.mjs --ping            # is the endpoint answering?
//   node bin/surex-review.mjs --fixtures        # what recorded runs exist
//
// `--intent` is a JSON file holding what the server claims about itself:
//   { "name": "…", "tools": [{ "name": "…", "description": "…", "inputSchema": {…} }], "readme": "…" }
//
// Nothing here decides anything. It is the thinnest possible wrapper so a real
// review can be run, and its real output read, without a worker or an API.

import { readFileSync } from 'node:fs';
import { relative, resolve, isAbsolute } from 'node:path';
import { reviewServer } from '../src/review.mjs';
import { resolveConfig, pingModel, listFixtures, REVIEWER_ENV } from '../src/model.mjs';

function parseArgs(argv) {
  const out = { files: [], intent: null, ping: false, fixtures: false, json: false, base: process.cwd(), noCache: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--file' || arg === '-f') out.files.push(argv[++i]);
    else if (arg === '--intent' || arg === '-i') out.intent = argv[++i];
    else if (arg === '--base') out.base = argv[++i];
    else if (arg === '--ping') out.ping = true;
    else if (arg === '--fixtures') out.fixtures = true;
    else if (arg === '--json') out.json = true;
    else if (arg === '--no-cache') out.noCache = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

function relPath(path, base) {
  const abs = isAbsolute(path) ? path : resolve(base, path);
  const rel = relative(base, abs).split('\\').join('/');
  return rel.startsWith('..') ? path.split('\\').join('/') : rel;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).join('\n'));
  process.exit(0);
}

const config = resolveConfig();

if (args.fixtures) {
  const rows = listFixtures();
  if (!rows.length) console.log('no recorded runs in fixtures/');
  for (const r of rows) console.log(`${r.key}  ${String(r.kind).padEnd(8)} ${String(r.modelId ?? '').padEnd(26)} ${r.recordedAt ?? ''}`);
  process.exit(0);
}

if (!config.baseUrl) {
  console.error(`${REVIEWER_ENV.baseUrl} is not set. There is no default endpoint on purpose — see src/model.mjs.`);
  process.exit(2);
}

if (args.ping) {
  const result = await pingModel({ config });
  console.log(JSON.stringify(result, null, 2));
  if (result.ok && !result.modelAvailable) {
    console.error(`\nthe endpoint is up but does not list ${config.modelId} — a review would fail on model-not-found`);
    process.exit(1);
  }
  process.exit(result.ok ? 0 : 1);
}

if (!args.files.length) {
  console.error('nothing to review: pass at least one --file');
  process.exit(2);
}

const files = args.files.map((path) => ({
  path: relPath(path, args.base),
  text: readFileSync(isAbsolute(path) ? path : resolve(args.base, path), 'utf8'),
}));

const statedIntent = args.intent ? JSON.parse(readFileSync(resolve(args.intent), 'utf8')) : {};

const record = await reviewServer({ statedIntent, files }, { config, allowCache: !args.noCache });

if (args.json) {
  console.log(JSON.stringify(record, null, 2));
  process.exit(0);
}

console.log(`verdict      ${record.verdict}   severity ${record.severity}`);
console.log(`model        ${record.modelId}   prompt ${record.promptVersion}   agreementRuns ${record.agreementRuns}`);
console.log(`notice       ${record.notice}`);
console.log(`duration     ${record.run?.durationMs} ms  (runs: ${(record.run?.runs ?? []).map((r) => `${r.variant}=${r.parsed ? 'parsed' : 'failed'}/${r.ms}ms`).join(' ')})`);
if (record.run?.cached) console.log(`cached       yes, recorded ${record.run.cachedFrom}`);
console.log('');
console.log(`statedIntentSummary: ${record.statedIntentSummary}`);
console.log('');
console.log(`findings (${record.findings.length}):`);
for (const f of record.findings) {
  console.log(`  [${f.severity}] ${f.category}  ${f.file}:${f.line}${f.runs ? `  (runs:${f.runs})` : ''}${f.detectedBy ? `  (${f.detectedBy})` : ''}`);
  console.log(`        ${f.description}`);
}
console.log('');
console.log('capability scan (deterministic, not model output):');
for (const [name, cap] of Object.entries(record.capabilities)) {
  const more = cap.evidenceTotal > cap.evidence.length ? ` (+${cap.evidenceTotal - cap.evidence.length} more)` : '';
  console.log(`  ${name.padEnd(12)} ${cap.present ? 'yes' : 'no '}  ${cap.evidence.join(' · ')}${more}`);
}
for (const note of record.run?.notes ?? []) console.log(`note: ${note}`);
for (const err of record.reviewErrors ?? []) console.log(`error: ${err}`);
