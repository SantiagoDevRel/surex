// The deterministic capability scan. NOT the model: import matching and call-site
// matching over source text, with no network and no configuration the reviewed code
// can influence, so the same bytes always give the same answer and a judge can
// re-run it. Shown on `clean` verdicts too.
//
// Five categories, fixed by the contract: network, filesystem, exec, env,
// credentials. Each answers `{present, evidence}` where every evidence string is
// a real `path:line label`. What it cannot see is in README.md.

export const CATEGORIES = Object.freeze(['network', 'filesystem', 'exec', 'env', 'credentials']);

/** Keeps one enormous vendored file from filling the Arkiv payload. */
export const MAX_EVIDENCE_PER_CATEGORY = 12;

/** A line longer than this is minified or a lockfile; matching it is noise. */
const MAX_LINE_LENGTH = 1000;

/** Module specifier → capability. */
const MODULES = Object.freeze({
  network: [
    'http', 'https', 'http2', 'net', 'tls', 'dgram',
    'axios', 'node-fetch', 'undici', 'got', 'ws', 'superagent', 'socket.io-client',
    'requests', 'httpx', 'aiohttp', 'urllib', 'urllib3', 'urllib.request', 'socket',
    'websockets', 'http.client', 'requests_html',
  ],
  filesystem: [
    'fs', 'fs/promises', 'graceful-fs', 'fs-extra',
    'pathlib', 'shutil', 'glob', 'tempfile', 'os.path', 'fileinput',
  ],
  exec: [
    'child_process', 'execa', 'shelljs', 'cross-spawn', 'vm',
    'subprocess', 'pty', 'commands',
  ],
  env: ['dotenv', 'python-dotenv'],
  credentials: ['keytar', 'node-keytar', 'keyring', 'browser-cookie3', 'pycookiecheat'],
});

/** `node:fs/promises` → `fs/promises`; `fs/promises` stays. */
function normaliseSpecifier(spec) {
  return spec.replace(/^node:/, '').trim();
}

const MODULE_LOOKUP = (() => {
  const map = new Map();
  for (const [category, specs] of Object.entries(MODULES)) {
    for (const spec of specs) map.set(spec, category);
  }
  return map;
})();

/**
 * Each rule is `{re, label}`; the label lands in the evidence string, so it reads
 * as the thing found: `src/api.ts:12 fetch()`. `js` rules run on
 * .js/.mjs/.cjs/.ts/.tsx/.jsx, `py` rules on .py, `any` rules on everything.
 */
const CALL_RULES = Object.freeze({
  js: [
    { category: 'network', re: /(?<![.\w$])fetch\s*\(/, label: 'fetch()' },
    /**
     * A REFERENCE to fetch, not a call through it. The pattern above needs the
     * literal token `fetch(`, so `const send = globalThis.fetch` is invisible to
     * it — and taking the reference IS the capability. Deliberately also matches a
     * polyfill guard like `if (!globalThis.fetch)`: this surface is shown, never
     * used to block, so over-reporting beats a category silently absent.
     */
    { category: 'network', re: /(?:globalThis|global|window|self)\s*\.\s*fetch\b(?!\s*\()/, label: 'fetch reference' },
    /**
     * The same alias, destructured: `const { fetch: send } = globalThis`. The
     * right-hand side is pinned to a global so this does not fire on every object
     * with a `fetch` method — `const { fetch } = myHttpClient` is somebody's API,
     * not evidence of the platform primitive.
     */
    { category: 'network', re: /\{[^}]*\bfetch\b[^}]*\}\s*=\s*(?:globalThis|global|window|self)\b/, label: 'fetch reference' },
    { category: 'network', re: /new\s+WebSocket\s*\(/, label: 'new WebSocket()' },
    { category: 'network', re: /new\s+XMLHttpRequest\s*\(/, label: 'new XMLHttpRequest()' },
    { category: 'network', re: /\bhttps?\.(request|get)\s*\(/, label: 'http.request()' },
    { category: 'network', re: /\baxios(?:\.(get|post|put|patch|delete|request|head))?\s*\(/, label: 'axios()' },
    { category: 'network', re: /\bnet\.(connect|createConnection)\s*\(/, label: 'net.connect()' },
    { category: 'network', re: /\bdgram\.createSocket\s*\(/, label: 'dgram.createSocket()' },
    { category: 'network', re: /\bgot\s*\(|\bgot\.(get|post|put|delete)\s*\(/, label: 'got()' },
    { category: 'network', re: /\bnavigator\.sendBeacon\s*\(/, label: 'navigator.sendBeacon()' },

    // filesystem — distinctive identifiers need no receiver
    {
      category: 'filesystem',
      re: /\b(readFileSync|writeFileSync|appendFileSync|readdirSync|unlinkSync|mkdirSync|rmSync|rmdirSync|copyFileSync|renameSync|existsSync|statSync|lstatSync|realpathSync|readlinkSync|createReadStream|createWriteStream|readFile|writeFile|appendFile|readdir|opendir)\s*\(/,
      label: null, // label = the matched identifier + ()
    },
    { category: 'filesystem', re: /\b(?:fs|fsp|fsPromises|promises)\.\w+\s*\(/, label: null },
    { category: 'filesystem', re: /\bglob(?:Sync)?\s*\(/, label: 'glob()' },

    // exec — `exec(`/`spawn(` only when not a property access, so `re.exec(s)` is out
    { category: 'exec', re: /(?<![.\w$])(execSync|execFileSync|spawnSync|execFile|exec|spawn)\s*\(/, label: null },
    { category: 'exec', re: /\bchild_process\.\w+\s*\(/, label: null },
    { category: 'exec', re: /(?<![.\w$])eval\s*\(/, label: 'eval()' },
    { category: 'exec', re: /new\s+Function\s*\(/, label: 'new Function()' },
    { category: 'exec', re: /\bvm\.run\w*\s*\(/, label: null },
    { category: 'exec', re: /\bexeca\s*\(|\bexeca\.\w+\s*\(/, label: 'execa()' },

    { category: 'env', re: /\bprocess\.env\b/, label: 'process.env' },
    { category: 'env', re: /\bimport\.meta\.env\b/, label: 'import.meta.env' },
    { category: 'env', re: /\bDeno\.env\b/, label: 'Deno.env' },
  ],

  py: [
    { category: 'network', re: /\brequests\.(get|post|put|delete|patch|head|request|Session)\s*\(/, label: null },
    { category: 'network', re: /\burlopen\s*\(/, label: 'urlopen()' },
    { category: 'network', re: /\bhttpx\.\w+\s*\(/, label: null },
    { category: 'network', re: /\baiohttp\.\w+\s*\(/, label: null },
    { category: 'network', re: /\bsocket\.socket\s*\(/, label: 'socket.socket()' },

    { category: 'filesystem', re: /(?<![.\w])open\s*\(/, label: 'open()' },
    { category: 'filesystem', re: /\bPath\s*\(/, label: 'Path()' },
    { category: 'filesystem', re: /\bos\.(remove|rename|listdir|walk|makedirs|mkdir|unlink|rmdir|scandir)\s*\(/, label: null },
    { category: 'filesystem', re: /\bshutil\.\w+\s*\(/, label: null },
    { category: 'filesystem', re: /\bglob\.(glob|iglob)\s*\(/, label: null },

    { category: 'exec', re: /\bsubprocess\.(run|Popen|call|check_output|check_call|getoutput)\s*\(/, label: null },
    { category: 'exec', re: /\bos\.(system|popen|exec\w*|spawn\w*)\s*\(/, label: null },
    { category: 'exec', re: /(?<![.\w])(eval|exec|compile|__import__)\s*\(/, label: null },

    { category: 'env', re: /\bos\.environ\b/, label: 'os.environ' },
    { category: 'env', re: /\bos\.getenv\s*\(/, label: 'os.getenv()' },
  ],

  any: [
    // A path or secret-shaped name in the source is the evidence: reach, not intent.
    {
      category: 'credentials',
      re: /(?:\.ssh[/\\]|\bid_rsa\b|\bid_ed25519\b|\bid_ecdsa\b|\bid_dsa\b|\bauthorized_keys\b|\bknown_hosts\b)/,
      label: 'ssh key material',
    },
    { category: 'credentials', re: /\.aws[/\\]credentials|\bAWS_SECRET_ACCESS_KEY\b|\bAWS_ACCESS_KEY_ID\b/, label: 'aws credentials' },
    { category: 'credentials', re: /\.netrc\b|\.git-credentials\b|\.npmrc\b|\.pypirc\b/, label: 'stored credential file' },
    { category: 'credentials', re: /\.docker[/\\]config\.json|\.kube[/\\]config|\.config[/\\]gcloud/, label: 'cloud credential file' },
    { category: 'credentials', re: /-----BEGIN [A-Z ]*PRIVATE KEY/, label: 'inline private key' },
    { category: 'credentials', re: /\bkeytar\b|\bkeychain\b|\bsecurity\s+find-generic-password\b|\bkeyring\.\w+\s*\(/i, label: 'os credential store' },
    { category: 'credentials', re: /\bcookies\.sqlite\b|\bLogin\s+Data\b|\bwallet\.dat\b|\bmnemonic\b|\bseed\s+phrase\b/i, label: 'browser or wallet secret store' },
    {
      category: 'credentials',
      re: /\b(?:[A-Z][A-Z0-9]*_)?(?:SECRET|API_KEY|APIKEY|ACCESS_TOKEN|PRIVATE_KEY|AUTH_TOKEN|PASSWORD)\b|\b[A-Z][A-Z0-9_]*_(?:SECRET|TOKEN|API_KEY|PASSWORD|PRIVATE_KEY)\b/,
      label: 'credential-shaped variable',
    },
  ],
});

const JS_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.tsx', '.jsx']);
const PY_EXT = new Set(['.py', '.pyi']);

function languageOf(path) {
  const dot = String(path).lastIndexOf('.');
  const ext = dot === -1 ? '' : String(path).slice(dot).toLowerCase();
  if (JS_EXT.has(ext)) return 'js';
  if (PY_EXT.has(ext)) return 'py';
  return 'other';
}

/**
 * Blank out comments while keeping every newline, so a match's line number is
 * still the line number in the file the reader will open.
 *
 * A capability mentioned only in a comment is not a capability of the code, so
 * comments are excluded here — but NOT from the injection scan in `prompt.mjs`,
 * where a comment is exactly where planted instructions live. String literals are
 * kept: a credential path in a string is what we are looking for.
 */
export function stripComments(text, language) {
  if (language === 'py') {
    return text
      .split('\n')
      .map((line) => {
        let inS = false;
        let inD = false;
        for (let i = 0; i < line.length; i += 1) {
          const ch = line[i];
          if (ch === '\\') { i += 1; continue; }
          if (ch === "'" && !inD) inS = !inS;
          else if (ch === '"' && !inS) inD = !inD;
          else if (ch === '#' && !inS && !inD) return line.slice(0, i);
        }
        return line;
      })
      .join('\n');
  }
  if (language !== 'js') return text;

  let out = '';
  let i = 0;
  let state = 'code'; // code | line | block | single | double | template
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (state === 'code') {
      if (ch === '/' && next === '/') { state = 'line'; i += 2; continue; }
      if (ch === '/' && next === '*') { state = 'block'; out += '  '; i += 2; continue; }
      if (ch === "'") state = 'single';
      else if (ch === '"') state = 'double';
      else if (ch === '`') state = 'template';
      out += ch;
      i += 1;
      continue;
    }
    if (state === 'line') {
      if (ch === '\n') { state = 'code'; out += '\n'; }
      i += 1;
      continue;
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') { state = 'code'; out += '  '; i += 2; continue; }
      out += ch === '\n' ? '\n' : ' ';
      i += 1;
      continue;
    }
    // inside a string: copy verbatim, honour escapes
    if (ch === '\\') { out += ch + (next ?? ''); i += 2; continue; }
    if ((state === 'single' && ch === "'") || (state === 'double' && ch === '"') || (state === 'template' && ch === '`')) {
      state = 'code';
    }
    out += ch;
    i += 1;
  }
  return out;
}

function importSpecifiers(line, language) {
  const specs = [];
  if (language === 'py') {
    const from = line.match(/^\s*from\s+([\w.]+)\s+import\b/);
    if (from) specs.push(from[1]);
    const plain = line.match(/^\s*import\s+([\w.,\s]+)$/);
    if (plain) {
      for (const part of plain[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name) specs.push(name);
      }
    }
    return specs;
  }
  // js/ts and anything else that looks like it
  const re = /(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)['"]([^'"\n]+)['"]/g;
  let m;
  while ((m = re.exec(line)) !== null) specs.push(m[1]);
  return specs;
}

/**
 * @typedef {Object} Site
 * @property {string} category
 * @property {string} path
 * @property {number} line    1-based, as the reader's editor counts
 * @property {string} label
 */

/**
 * Scan one file.
 *
 * @returns {Site[]}
 */
export function scanFile(path, text) {
  if (typeof text !== 'string' || !text) return [];
  const language = languageOf(path);
  const rules = [...(CALL_RULES[language] ?? []), ...CALL_RULES.any];
  const code = stripComments(text, language);
  const rawLines = code.split(/\r?\n/);
  const sites = [];
  const seen = new Set();

  rawLines.forEach((line, index) => {
    if (!line || line.length > MAX_LINE_LENGTH) return;
    const lineNo = index + 1;

    for (const spec of importSpecifiers(line, language)) {
      const category = MODULE_LOOKUP.get(normaliseSpecifier(spec));
      if (!category) continue;
      push(sites, seen, { category, path, line: lineNo, label: `import '${spec}'` });
    }

    for (const rule of rules) {
      const m = line.match(rule.re);
      if (!m) continue;
      // `label: null` means "use what was matched": `requests.get(` reads as
      // `requests.get()`, not as the bare capture group `get()`.
      const label = rule.label ?? `${m[0].replace(/\s*\($/, '').trim()}()`;
      push(sites, seen, { category: rule.category, path, line: lineNo, label });
    }
  });

  return sites;
}

function push(sites, seen, site) {
  const key = `${site.category}|${site.path}|${site.line}|${site.label}`;
  if (seen.has(key)) return;
  seen.add(key);
  sites.push(site);
}

/** `src/api.ts:12 fetch()` — the evidence format the contract shows. */
export function formatEvidence(site) {
  return `${site.path}:${site.line} ${site.label}`;
}

/**
 * Scan a source tree.
 *
 * @param {{path:string, text:string}[]} files
 * @returns {{capabilities:object, sites:Site[], meta:object}}
 */
export function scanFiles(files) {
  const list = Array.isArray(files) ? files : [];
  const sites = [];
  const skipped = [];

  for (const file of list) {
    if (!file || typeof file.path !== 'string') continue;
    if (typeof file.text !== 'string') { skipped.push({ path: file.path, why: 'no text' }); continue; }
    if (file.text.includes('\u0000')) { skipped.push({ path: file.path, why: 'binary' }); continue; }
    sites.push(...scanFile(file.path, file.text));
  }

  const capabilities = {};
  for (const category of CATEGORIES) {
    const matches = sites.filter((s) => s.category === category);
    capabilities[category] = {
      present: matches.length > 0,
      evidence: matches.slice(0, MAX_EVIDENCE_PER_CATEGORY).map(formatEvidence),
      // `evidence.length < evidenceTotal` means the list was truncated.
      evidenceTotal: matches.length,
    };
  }

  return {
    capabilities,
    sites,
    meta: {
      filesScanned: list.length - skipped.length,
      filesSkipped: skipped,
      scanner: 'surex-capability-scan/1',
    },
  };
}

/** The contract-shaped answer on its own. */
export function scanCapabilities(files) {
  return scanFiles(files).capabilities;
}

/** An all-absent surface, for the case where there is no source to scan at all. */
export function emptyCapabilities() {
  const out = {};
  for (const category of CATEGORIES) out[category] = { present: false, evidence: [], evidenceTotal: 0 };
  return out;
}
