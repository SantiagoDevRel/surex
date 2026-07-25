// Reading an MCP server the way the reviewer needs it: its source tree, and the
// tool list it declares about itself.
//
// Extracted from review-and-publish.mjs so calibrate.mjs and review-known.mjs use
// the SAME reader. Two of the three functions here encode bugs that were paid for
// once — a second copy would pay for them again. The comments are the record.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawn } from 'node:child_process';

export const SOURCE_EXT = /\.(m?js|cjs|ts|json|md)$/i;
export const SKIP_DIR = /^(node_modules|fixture-home|test|\.out|\.git)$/i;

/** Where a server's stdio entry actually lives — not always <dir>/server.mjs. */
export function entryOf(dir) {
  for (const rel of ['server.mjs', 'src/server.mjs', 'index.mjs', 'src/index.mjs']) {
    if (existsSync(join(dir, rel))) return join(dir, rel);
  }
  try {
    const bin = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).bin;
    const first = typeof bin === 'string' ? bin : Object.values(bin ?? {})[0];
    if (first && existsSync(join(dir, first))) return join(dir, first);
  } catch { /* no package.json */ }
  return null;
}

/**
 * Read a source tree the way the reviewer wants it: `{path, text}[]`.
 *
 * The reviewer keys everything off `file.text` — the capability scan, the
 * injection scan and the prompt all read it. Passing `content` (which the model
 * half also accepts) but not `text` was why `reach` came back "nothing detected"
 * on code with 21 real call sites. Supply `text`.
 */
export function readTree(dir, { maxFileBytes = 200 * 1024 } = {}) {
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP_DIR.test(e.name)) walk(join(d, e.name));
        continue;
      }
      if (!SOURCE_EXT.test(e.name)) continue;
      const full = join(d, e.name);
      if (statSync(full).size > maxFileBytes) continue;
      files.push({ path: relative(dir, full).replace(/\\/g, '/'), text: readFileSync(full, 'utf8') });
    }
  };
  walk(dir);
  return files;
}

/**
 * Start the server over stdio and ask it what it declares. The stated intent is
 * the server's OWN words — what it tells an agent it does — which is the half a
 * review compares the code against.
 *
 * @param {object} opts
 * @param {string} opts.dir      package directory (for README/AGENTS.md)
 * @param {string} opts.name     display name
 * @param {string} opts.entry    path to the stdio entry
 * @param {string} opts.cwd      working directory for the child — see below
 * @param {object} [opts.env]    environment for the child
 * @param {number} [opts.timeoutMs]
 */
export function statedIntentFrom({ dir, name, entry, cwd, env, timeoutMs = 8000 }) {
  return new Promise((resolvePromise) => {
    // cwd matters: an in-repo fixture imports @modelcontextprotocol/sdk from the
    // monorepo's hoisted top-level node_modules, so it must be launched from the
    // repo ROOT. Launched from anywhere else, node cannot resolve the import and
    // the server dies before printing a line — which reads from the outside as
    // "the server declares no tools". An extracted npm package is the opposite:
    // it has its own node_modules and must be launched from its own directory.
    // The caller knows which; this function does not guess.
    const child = spawn(process.execPath, [entry], {
      cwd,
      env: env ?? process.env,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let buf = '';
    let settled = false;
    const timer = setTimeout(() => done({ tools: [], reason: 'timeout' }), timeoutMs);

    function done(partial) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch { /* already gone */ }
      const readme = ['README.md', 'AGENTS.md'].map((f) => join(dir, f)).find(existsSync);
      resolvePromise({
        name,
        tools: partial.tools ?? [],
        readme: readme ? readFileSync(readme, 'utf8') : null,
        // How the tool list was obtained, so a verdict can say so rather than
        // implying the server was interrogated when it was not.
        toolSource: partial.reason ? `not-enumerated:${partial.reason}` : 'tools/list',
      });
    }

    child.on('error', (err) => done({ tools: [], reason: `spawn-failed:${err.code ?? 'error'}` }));
    // `close`, NOT `exit`: exit fires when the process ends, which can be before
    // its stdout has been drained — resolving there would discard a tools/list
    // answer that had already been written and report the server as declaring
    // nothing. `close` fires after the stdio streams are done.
    child.on('close', (code) => done({ tools: [], reason: `exited:${code}` }));

    // Consume COMPLETE lines only. Splitting the running buffer on every `data`
    // event re-parses partial lines and never advances past them — which is why
    // the first version saw zero tools even though the server answered three.
    child.stdout.on('data', (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('{')) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 2 && msg.result?.tools) done({ tools: msg.result.tools });
        } catch { /* not a complete JSON object on this line */ }
      }
    });

    const send = (o) => {
      try { child.stdin.write(JSON.stringify(o) + '\n'); } catch { /* child already gone */ }
    };
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'surex-review', version: '0' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  });
}
