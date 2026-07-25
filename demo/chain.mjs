#!/usr/bin/env node
// The whole chain, end to end, driven by a real Claude Code session.
//
//   the fixture MCP server we wrote
//     → a real tool call
//       → the SureX plugin's PreToolUse hook (loaded as a PLUGIN, not a setting)
//         → SXF-1 fingerprint from config alone
//           → the registry says flagged
//             → the gate fetches the evidence from Walrus
//               → and RECOMPUTES the blob ID from the bytes it received
//                 → the call is denied, with the case in one string
//
// Run:  node demo/chain.mjs            (registry stood in locally)
//       SUREX_API_URL=… node demo/chain.mjs   (against a live API)
//
// Nothing here is mocked past the registry. The Walrus fetch is a real HTTP
// request to a public aggregator for a blob that was really certified on Sui,
// and the blob ID is really recomputed locally with the vendored encoder. If
// the network is down, this fails loudly rather than pretending.

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalise, fingerprintOf } from '../packages/core/index.mjs';
import { localEntryResolver } from '../packages/plugin/lib/localentry.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_ENTRY = join(ROOT, 'packages', 'fixture-mcp', 'src', 'server.mjs');
const PLUGIN_DIR = join(ROOT, 'packages', 'plugin');

/**
 * A real blob, written and certified on Walrus testnet by probes/walrus-write.mjs.
 * The evidence in this demo points at bytes that genuinely exist on chain — the
 * point of the exercise is that the gate goes and gets them and checks them.
 */
const REAL_EVIDENCE = {
  blobId: '-SzjTmxUSjs01bmC2AZ48iqz-fTCcllwcLu3nc2rb2Y',
  contentSha256: 'f0457c3012a351b89df29a190d8189595074cf2fe843d85aeff8047cc1ff2ad7',
  suiObjectId: '0xe0ad0c98f40f23b5990ea5bee344e6fbb245366507910f93120975b25c6af5e8',
  registerTx: '2s1ogVLi6Gc2uEY3ZB4Ztb52DNxyHqftMa4aVrTRqeND',
  certifyTx: '7BiSZkhzAjucM2PNY8bMVi9cWBvtiLDBE6T8AEtm1tkq',
  nShards: 1000,
};

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;

const results = [];
function step(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? green('✓') : red('✗')} ${name}`);
  if (detail) console.log(`      ${dim(detail)}`);
}

// ── 1. what the gate will compute for the fixture ───────────────────────────
const fixtureDef = { command: 'node', args: [FIXTURE_ENTRY] };
const canonical = canonicalise(fixtureDef, { hashLocalEntry: localEntryResolver(ROOT) });
const fingerprint = fingerprintOf(canonical);

console.log(`\n${bold('SureX — the chain, end to end')}\n`);
console.log(`  fixture      ${dim(FIXTURE_ENTRY)}`);
console.log(`  canonical    ${dim(JSON.stringify(canonical))}`);
console.log(`  fingerprint  ${fingerprint}\n`);

step(
  'the fixture has a content-derived identity, not a colliding basename',
  canonical.package.version.startsWith('local:'),
  `version = ${canonical.package.version} — reproducible on any machine with the same file`,
);

// ── 2. stand in for the registry ────────────────────────────────────────────
const head = {
  fingerprint,
  state: 'flagged',
  severity: 4,
  tier: 'C',
  name: 'surex-fixture-mcp (local)',
  reviewedCommit: 'fixture',
  reviewedAt: new Date().toISOString().slice(0, 10),
  modelId: 'qwen3-coder-next',
  promptVersion: 'rv-1',
  enforceAfter: Date.now() + 72 * 3600 * 1000,
  topFinding: {
    file: 'src/tools/search.mjs',
    line: 110,
    severity: 4,
    category: 'intent-mismatch',
    description:
      'the tool describes itself as read-only and touching nothing outside the notes directory, ' +
      'then reads a private key file and includes it in an outbound request',
  },
  capabilities: {
    network: { present: true, evidence: ['src/tools/search.mjs:130 fetch()'] },
    filesystem: { present: true, evidence: ['src/tools/search.mjs:110 readFileSync()'] },
    exec: { present: false, evidence: [] },
    env: { present: true, evidence: ['src/tools/search.mjs:117 process.env'] },
    credentials: { present: true, evidence: ['src/tools/search.mjs:110 .ssh/id_rsa'] },
  },
  evidence: REAL_EVIDENCE,
};

let registryUrl = process.env.SUREX_API_URL ?? null;
let server = null;
if (!registryUrl) {
  server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('content-type', 'application/json');
    if (url.pathname.endsWith('/verdict')) {
      const fp = url.searchParams.get('fp');
      res.end(JSON.stringify(fp === fingerprint ? head : { fingerprint: fp, state: 'unknown', severity: 0, tier: 'C' }));
      return;
    }
    if (url.pathname.endsWith('/verdicts/batch')) {
      // Answer for EVERY requested fingerprint. A batch endpoint that stays
      // silent about one is how a flag gets suppressed -- see
      // partitionBatchResponse in packages/core.
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        let fps = [];
        try { fps = JSON.parse(body).fps ?? []; } catch { /* empty */ }
        res.end(JSON.stringify({
          heads: fps.map((fp) =>
            fp === fingerprint ? head : { fingerprint: fp, state: 'unknown', severity: 0, tier: 'C' }),
        }));
      });
      return;
    }
    res.end(JSON.stringify({ heads: [] }));
  });
  await new Promise((r) => server.listen(0, r));
  registryUrl = `http://127.0.0.1:${server.address().port}`;
  console.log(`  ${dim(`registry stood in at ${registryUrl} — Arkiv is the only mocked link`)}\n`);
}

// ── 3. a real Claude Code session, with the plugin installed as a plugin ────
const sandbox = mkdtempSync(join(tmpdir(), 'surex-chain-'));

// Claude Code sets ${CLAUDE_PLUGIN_DATA} itself and OVERRIDES anything we pass:
// for a plugin loaded with --plugin-dir it is ~/.claude/plugins/data/<name>-inline.
// That is the behaviour we want in production -- state survives plugin updates --
// but it means a demo run inherits the previous run's cache, so clear it.
const dataDir = join(homedir(), '.claude', 'plugins', 'data', 'surex-inline');
mkdirSync(dataDir, { recursive: true });
rmSync(join(dataDir, 'cache.json'), { force: true });
rmSync(join(dataDir, 'overrides.json'), { force: true });
rmSync(join(dataDir, 'gate.log'), { force: true });

// The server definition is written as a project-scope `.mcp.json` in the sandbox
// and the session is run from there.
//
// This is not decoration. A server passed only via `--mcp-config` is INVISIBLE to
// the gate: a hook receives no server config (FRICTION-LOG C3) and has to
// rediscover the definition from the config scopes on disk, and a file handed to
// the CLI on the command line is in none of them. Writing it where a real install
// would put it is both what makes the demo work and what a real install looks
// like. `--mcp-config` still points at the same file so the session connects
// without needing an interactive approval for a project-scoped server.
const mcpConfig = join(sandbox, '.mcp.json');
writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { fixture: fixtureDef } }, null, 2));

// Piped in rather than passed as an argv entry: the prompt contains quotes, and
// on Windows a shell-spawned argv mangles it — the model received the single word
// "Use" and asked what we meant.
const PROMPT =
  'Use the search tool from the fixture MCP server to search for the word onboarding. ' +
  'Then tell me in one sentence exactly what happened, and if the call was blocked, ' +
  'quote the block message back to me verbatim.';

const streamPath = join(sandbox, 'stream.jsonl');
const claudeArgs = [
  '-p',
  '--mcp-config', mcpConfig,
  '--strict-mcp-config',
  '--plugin-dir', PLUGIN_DIR,
  // NOTE: no `--setting-sources ''`. An empty-string argv entry is dropped when
  // spawning through a shell on Windows, and the next flag is then consumed as
  // its value — which fails as "Invalid setting source: --allowedTools" and
  // looks exactly like the hook not firing.
  '--allowedTools', 'mcp__fixture__search',
  '--output-format', 'stream-json',
  '--include-hook-events',
  '--verbose',
  '--no-session-persistence',
];

console.log(`  ${dim('running a real headless session…')}\n`);
const child = spawn('claude', claudeArgs, {
  cwd: sandbox,
  env: {
    ...process.env,
    SUREX_API_URL: registryUrl,
    SUREX_WEB_URL: 'https://surex.dev',
    CLAUDE_PLUGIN_DATA: dataDir,
  },
  shell: process.platform === 'win32',
  stdio: ['pipe', 'pipe', 'pipe'],
});
child.stdin.end(PROMPT);

let raw = '';
let stderr = '';
child.stdout.on('data', (d) => (raw += d));
child.stderr.on('data', (d) => (stderr += d));
const exitCode = await new Promise((r) => child.on('close', r));
writeFileSync(streamPath, raw);
server?.close();

// ── 4. what actually happened ───────────────────────────────────────────────
const events = raw
  .trim()
  .split('\n')
  .map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  })
  .filter(Boolean);

const hookResponses = events.filter((e) => e.type === 'system' && e.subtype === 'hook_response');
const toolResults = events.flatMap((e) =>
  e.type === 'user' ? (e.message?.content ?? []).filter((c) => c.type === 'tool_result') : [],
);
const assistantText = events
  .filter((e) => e.type === 'assistant')
  .flatMap((e) => e.message.content.filter((c) => c.type === 'text').map((c) => c.text))
  .join('\n');

const hookFired = hookResponses.some((h) => String(h.hook_name ?? '').includes('mcp__fixture'));
step('the plugin\'s hook fired on the MCP tool call', hookFired,
  hookFired ? hookResponses.map((h) => h.hook_name).join(', ') : `no PreToolUse hook ran (exit ${exitCode})`);

const denied = hookResponses.some((h) => String(h.stdout ?? '').includes('"permissionDecision":"deny"'));
step('the gate denied the call', denied);

const blockText = toolResults
  .map((r) => (typeof r.content === 'string' ? r.content : JSON.stringify(r.content)))
  .find((t) => t.includes('SureX blocked this call')) ?? '';

step('the block message reached the model', Boolean(blockText));
step('it names the finding, with file and line', blockText.includes('src/tools/search.mjs:110'));
step('it discloses that no human audited it', blockText.includes('No human audited this'));
// The override must be present AND be an invocation that exists on this machine.
// Bare `surex` is not on PATH from a marketplace install (FRICTION-LOG C7), so
// the gate resolves its own location and prints that instead.
step(
  'it prints an override that exists, and says the risk is the user\'s',
  new RegExp(`allow ${fingerprint}`).test(blockText) && /at your own risk/i.test(blockText),
  blockText.split('\n').find((l) => /own risk/.test(l)),
);
step('it does not claim the reviewed bytes are the installed bytes (tier C)',
  /may be about code that is not your code/.test(blockText));

// The non-negotiable.
const fetched = /Evidence fetched from Walrus and checked/.test(blockText);
step('the gate FETCHED the evidence from Walrus while blocking', fetched,
  fetched ? blockText.split('\n').find((l) => l.includes('Walrus')) : 'no Walrus line in the block message');

const shaOk = /✓ content-sha256/.test(blockText);
const blobOk = /✓ blob-id/.test(blockText);
step('the fetched bytes matched the digest recorded on the record', shaOk);
step('the blob ID was RECOMPUTED from the bytes and matched — not asserted', blobOk,
  blobOk ? 'the vendored Walrus encoder ran locally' : 'blob-id was not reported as passed');

step('the model understood it as a block, not as a tool error',
  /block/i.test(assistantText) && !/tool error/i.test(assistantText));

// ── 5. the override, and that it is honoured ────────────────────────────────
console.log('');
const surexBin = join(PLUGIN_DIR, 'bin', 'surex');
const allow = spawn(process.execPath, [surexBin, 'allow', fingerprint], {
  env: { ...process.env, CLAUDE_PLUGIN_DATA: dataDir, NO_COLOR: '1' },
});
await new Promise((r) => allow.on('close', r));

const retry = spawn('claude', claudeArgs, {
  cwd: sandbox,
  env: { ...process.env, SUREX_API_URL: registryUrl, CLAUDE_PLUGIN_DATA: dataDir },
  shell: process.platform === 'win32',
  stdio: ['pipe', 'pipe', 'pipe'],
});
retry.stdin.end(PROMPT);
let retryRaw = '';
retry.stdout.on('data', (d) => (retryRaw += d));
await new Promise((r) => retry.on('close', r));
const retryRan = retryRaw.includes('surex-fixture') || /notes|onboarding/i.test(retryRaw);
const retryBlocked = retryRaw.includes('SureX blocked this call');
step('after `surex allow`, the same call proceeds', retryRan && !retryBlocked,
  retryBlocked ? 'still blocked — the override was not honoured' : 'the escape hatch works');

// ── the gate's own record of what it did ────────────────────────────────────
const logPath = join(dataDir, 'gate.log');
if (existsSync(logPath)) {
  const entries = readFileSync(logPath, 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter(Boolean);
  console.log(`\n  ${dim('the gate logged, locally:')}`);
  for (const e of entries.slice(-6)) {
    console.log(`    ${dim(JSON.stringify({ decision: e.decision, state: e.state, from: e.from, asked: e.asked, count: e.count, unanswered: e.unanswered, flagged: e.flagged }))}`);
  }
}

// ── report ──────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
console.log(`\n  ${bold(`${results.length - failed.length}/${results.length} checks passed`)}`);
console.log(`  ${dim(`stream: ${streamPath}`)}`);
if (stderr.trim()) console.log(`  ${dim(`stderr: ${stderr.trim().slice(0, 300)}`)}`);
if (failed.length) {
  console.log(`\n  ${red('failed:')}`);
  for (const f of failed) console.log(`    - ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  process.exit(1);
}
console.log(`\n  ${green('The chain holds.')} Arkiv decided; Walrus proved, and the proof was checked.\n`);
