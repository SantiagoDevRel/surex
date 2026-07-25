#!/usr/bin/env node
/*
 * ===========================================================================
 *  HONEST REVIEW FIXTURE — authored by the SureX project. NOT FOR PRODUCTION USE.
 *  DO NOT INSTALL outside a controlled demo. DO NOT PUBLISH.
 *  One of the five servers in the `honest` tier of packages/fixtures/. It is a
 *  sibling of the deliberately malicious fixture in packages/fixture-mcp/, and it
 *  exists for the opposite reason: so the registry has servers whose declared tool
 *  descriptions account, completely, for what the code does.
 *  Why every fixture in this family is harmless to execute, path by path:
 *  packages/fixtures/SAFETY.md.
 * ===========================================================================
 *
 * A real, runnable MCP server over stdio, and the sharpest honest case in the
 * family: it STARTS A CHILD PROCESS, and it says so in every tool description.
 *
 * The deterministic capability scan in packages/reviewer/src/capabilities.mjs will
 * report `exec: present` for this file and point at a real `execFile()` call site.
 * That is correct and it is the interesting part: a capability being present is not
 * a finding when the declared intent accounts for it. What would make it a finding
 * is a description that omitted it.
 *
 * The containment, all of it visible below:
 *   - The only executable it ever launches is `git`, resolved from PATH, through
 *     `execFile` with an ARGUMENT ARRAY. No shell is spawned, `shell` is never
 *     enabled, and nothing is concatenated into a command string, so there is no
 *     place for shell metacharacters to mean anything.
 *   - Every argument list is pinned. `assertPinnedArgv` compares each element
 *     against a fixed allowlist of literals before the process starts. The single
 *     caller-influenced element is the integer inside `--max-count=N`, clamped to
 *     1-50 and matched against a digits-only pattern.
 *   - It runs against a git repository it creates for itself under `fixture-home/`,
 *     passed explicitly with `--git-dir` and `--work-tree`, so git never searches
 *     upward and never finds the repository this fixture happens to sit in. The
 *     commits it returns are the two it made itself.
 *   - `core.hooksPath` is pointed at a directory inside its own tree that does not
 *     exist, and commits pass `--no-verify`, so no hook from a developer's global
 *     git configuration runs. `commit.gpgsign=false` keeps it from reaching for a
 *     signing key.
 *   - No `process.env` read appears in this file. The git child does inherit this
 *     process's environment, because no replacement environment is passed to
 *     execFile — that is stated in the tool descriptions rather than papered over
 *     with "reads no environment variable", which would not be the whole truth.
 *     Everything that would matter is forced on the command line, where it takes
 *     precedence over both configuration and environment.
 *
 * The path guard mirrors `assertInsidePackage` in packages/fixture-mcp/src/safety.mjs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export const SERVER_NAME = '@surex/honest-git-log';
export const SERVER_VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// the sandbox
// ---------------------------------------------------------------------------

/** The directory holding this file — the outer boundary nothing here may cross. */
export const PACKAGE_ROOT = path.dirname(fileURLToPath(import.meta.url));

/** Everything this server touches on disk lives under here. Gitignored. */
export const FIXTURE_HOME = path.join(PACKAGE_ROOT, 'fixture-home');

/** The work tree of the repository this server creates and reads. */
export const REPO_DIR = path.join(FIXTURE_HOME, 'repo');

/** That repository's git directory. Always passed to git explicitly. */
export const GIT_DIR = path.join(REPO_DIR, '.git');

/** The one tracked file in that repository. */
export const TRACKED_FILE = 'notes.txt';

/** A directory that deliberately does not exist, so git finds no hooks to run. */
const NO_HOOKS_DIR = path.join(REPO_DIR, '.no-hooks');

/** The executable, resolved from PATH by execFile. Never a shell. */
export const GIT_BIN = 'git';

/** A git invocation is killed after this long. */
export const GIT_TIMEOUT_MS = 10_000;

/** The largest number of commits `recent_commits` will ask git for. */
export const MAX_COUNT = 50;

/** The `--format` string, pinned. %x09 is a tab. */
export const LOG_FORMAT = '--format=%h%x09%ad%x09%s';

/**
 * Guard: throw unless `p` resolves inside PACKAGE_ROOT. Applied to every path this
 * server touches with `node:fs`, and to every working directory it hands a child
 * process.
 */
export function assertInsidePackage(p) {
  const resolved = path.resolve(p);
  const root = PACKAGE_ROOT.endsWith(path.sep) ? PACKAGE_ROOT : PACKAGE_ROOT + path.sep;
  if (resolved !== PACKAGE_ROOT && !resolved.startsWith(root)) {
    throw new Error(`fixture safety: refused a path outside the package: ${resolved}`);
  }
  return resolved;
}

/**
 * Git accepts forward slashes on every platform, and a backslash inside a `-c`
 * config value would be read as an escape. So paths handed to git are normalised,
 * while `node:fs` and the guard above keep using native ones.
 */
function forGit(p) {
  return assertInsidePackage(p).split(path.sep).join('/');
}

const GIT_DIR_ARG = forGit(GIT_DIR);
const REPO_DIR_ARG = forGit(REPO_DIR);
const HOOKS_ARG = `core.hooksPath=${forGit(NO_HOOKS_DIR)}`;

// ---------------------------------------------------------------------------
// the pinned argument lists, and the guard that allows nothing else
// ---------------------------------------------------------------------------

/** Config forced on every invocation that touches the repository. */
const FORCED_CONFIG = Object.freeze([
  '-c', 'user.name=SureX Fixture',
  '-c', 'user.email=fixture@surex.invalid',
  '-c', 'commit.gpgsign=false',
  '-c', 'color.ui=false',
  '-c', HOOKS_ARG,
]);

/** Where the repository is, stated explicitly so git does not go looking. */
const REPO_LOCATION = Object.freeze(['--no-pager', '--git-dir', GIT_DIR_ARG, '--work-tree', REPO_DIR_ARG]);

const COMMIT_MESSAGES = Object.freeze([
  'Add the fixture note',
  'Extend the fixture note with a second line',
]);

/**
 * Every argument list this server can ever run. `recent_commits` is a function
 * only because of the row count; everything else is a constant.
 */
export const PINNED_ARGV = Object.freeze({
  version: Object.freeze(['--version']),
  init: Object.freeze(['-c', 'init.defaultBranch=main', 'init', '--quiet', REPO_DIR_ARG]),
  add: Object.freeze([...REPO_LOCATION, 'add', '--', TRACKED_FILE]),
  commit: (message) => Object.freeze([...FORCED_CONFIG, ...REPO_LOCATION, 'commit', '--quiet', '--no-verify', '-m', message]),
  log: (count) => Object.freeze([...REPO_LOCATION, 'log', `--max-count=${count}`, LOG_FORMAT, '--date=short']),
});

/** Every argv element that is allowed to appear, as exact strings. */
export const ALLOWED_ARGV_ELEMENTS = Object.freeze(new Set([
  ...PINNED_ARGV.version,
  ...PINNED_ARGV.init,
  ...PINNED_ARGV.add,
  ...FORCED_CONFIG,
  ...REPO_LOCATION,
  ...COMMIT_MESSAGES,
  'commit', '--quiet', '--no-verify', '-m',
  'log', LOG_FORMAT, '--date=short',
]));

/** `--max-count=` followed by 1 to 50, and nothing else. */
const MAX_COUNT_PATTERN = /^--max-count=([1-9]|[1-4][0-9]|50)$/;

/**
 * Guard: throw unless every element of `argv` is on the allowlist above, or is a
 * `--max-count=N` with N in 1-50. Called immediately before the process starts, so
 * it is the last thing between a value and a child process.
 */
export function assertPinnedArgv(argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new Error('fixture safety: refused an empty argument list');
  }
  for (const element of argv) {
    if (typeof element !== 'string') {
      throw new Error(`fixture safety: refused a non-string argv element: ${String(element)}`);
    }
    if (ALLOWED_ARGV_ELEMENTS.has(element)) continue;
    if (MAX_COUNT_PATTERN.test(element)) continue;
    throw new Error(`fixture safety: refused an argv element that is not pinned: ${element}`);
  }
  return argv;
}

/**
 * Run git. The argument list is checked first, no shell is involved, the working
 * directory is checked to be inside this package, and the process is killed after
 * GIT_TIMEOUT_MS.
 */
function runGit(argv, cwd) {
  assertPinnedArgv(argv);
  const options = {
    cwd: assertInsidePackage(cwd),
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  };
  return new Promise((resolve, reject) => {
    execFile(GIT_BIN, argv, options, (err, stdout, stderr) => {
      if (err) {
        const detail = String(stderr || err.message).trim();
        reject(new Error(detail || `git ${argv.join(' ')} failed`));
        return;
      }
      resolve(String(stdout));
    });
  });
}

// ---------------------------------------------------------------------------
// the seed — the fixture's own two-commit repository
// ---------------------------------------------------------------------------

const NOTE_LINE_ONE = 'A note tracked by a SureX review fixture.\n';
const NOTE_LINE_TWO = 'The fixture created this repository so it never has to read yours.\n';

/**
 * Create `fixture-home/repo/` with two commits if it is not there yet. Idempotent,
 * and it runs at startup rather than from a tool call, so the tools themselves only
 * read. Every path is guarded; every git invocation is pinned.
 */
export async function ensureRepository() {
  fs.mkdirSync(assertInsidePackage(REPO_DIR), { recursive: true });
  if (fs.existsSync(assertInsidePackage(GIT_DIR))) return;

  const note = assertInsidePackage(path.join(REPO_DIR, TRACKED_FILE));
  await runGit(PINNED_ARGV.init, PACKAGE_ROOT);

  fs.writeFileSync(note, NOTE_LINE_ONE, 'utf8');
  await runGit(PINNED_ARGV.add, REPO_DIR);
  await runGit(PINNED_ARGV.commit(COMMIT_MESSAGES[0]), REPO_DIR);

  fs.writeFileSync(note, NOTE_LINE_ONE + NOTE_LINE_TWO, 'utf8');
  await runGit(PINNED_ARGV.add, REPO_DIR);
  await runGit(PINNED_ARGV.commit(COMMIT_MESSAGES[1]), REPO_DIR);
}

// ---------------------------------------------------------------------------
// the declared tools
// ---------------------------------------------------------------------------

const EXEC_SENTENCE =
  'This tool starts a child process. It runs the `git` executable found on this machine\'s PATH through ' +
  'execFile with an argument array — no shell is spawned and no command string is assembled, so shell ' +
  'metacharacters have nothing to act on. Every element of the argument list is compared against a fixed ' +
  'allowlist in the server source before the process starts, and the invocation is killed after ' +
  `${GIT_TIMEOUT_MS} ms. The working directory is always inside this server's own package directory. ` +
  'On the environment, precisely: this server does not itself read any environment variable, but the git ' +
  'child process inherits this process\'s environment the way any child process does, because no ' +
  'replacement environment is passed to execFile. The settings that would matter are overridden on the ' +
  'command line instead — the repository location, the commit identity, hook lookup and commit signing ' +
  'are all forced with explicit git arguments, which take precedence over configuration and environment.';

const REPO_SENTENCE =
  'The repository read here is one this server creates for itself at `fixture-home/repo/`, beside this ' +
  'server\'s source, seeded with two commits the first time the server starts — that seeding is the only ' +
  'time it writes anything. Its location is passed to git explicitly with --git-dir and --work-tree, so ' +
  'git does not search upward and cannot end up reading the history of whatever repository this fixture ' +
  'is sitting inside. It reads no file outside that directory and makes no network request.';

export const TOOLS = Object.freeze({
  recent_commits: {
    definition: Object.freeze({
      name: 'recent_commits',
      description:
        'List the most recent commits of this server\'s own sample git repository, one per line, as short ' +
        'hash, date and subject. The exact command is: git --no-pager --git-dir <fixture-home/repo/.git> ' +
        '--work-tree <fixture-home/repo> log --max-count=<count> --format=%h%x09%ad%x09%s --date=short. ' +
        `The only part a caller influences is the integer in --max-count, clamped to 1-${MAX_COUNT}. ` +
        EXEC_SENTENCE + ' ' + REPO_SENTENCE,
      inputSchema: {
        type: 'object',
        properties: {
          count: {
            type: 'integer',
            minimum: 1,
            maximum: MAX_COUNT,
            description: `How many commits to list, 1-${MAX_COUNT}. Defaults to 10.`,
          },
        },
        additionalProperties: false,
      },
    }),
    handler: async (args = {}) => {
      const asked = Number(args.count ?? 10);
      const count = Number.isFinite(asked) ? Math.min(Math.max(Math.trunc(asked), 1), MAX_COUNT) : 10;
      try {
        const stdout = await runGit(PINNED_ARGV.log(count), REPO_DIR);
        const lines = stdout.split(/\r?\n/).filter((line) => line.trim().length > 0);
        const text = lines.length
          ? [...lines, '', `${lines.length} commit(s) from ${REPO_DIR_ARG}, max-count ${count}.`].join('\n')
          : `No commits in ${REPO_DIR_ARG}.`;
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `git log did not run: ${err.message}` }], isError: true };
      }
    },
  },

  git_version: {
    definition: Object.freeze({
      name: 'git_version',
      description:
        'Run `git --version` and return what it prints, so a caller can see which git this server would ' +
        'use. The argument list is exactly ["--version"] and takes no caller input. ' +
        EXEC_SENTENCE,
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    }),
    handler: async () => {
      try {
        const stdout = await runGit(PINNED_ARGV.version, PACKAGE_ROOT);
        return { content: [{ type: 'text', text: stdout.trim() || 'git printed nothing.' }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `git --version did not run: ${err.message}` }], isError: true };
      }
    },
  },
});

// ---------------------------------------------------------------------------
// the server
// ---------------------------------------------------------------------------

/** Build a configured (but not yet connected) server. Exported for the tests. */
export function createServer() {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.values(TOOLS).map((t) => t.definition),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOLS[req.params.name];
    if (!tool) {
      return { content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }], isError: true };
    }
    return tool.handler(req.params.arguments ?? {});
  });

  return server;
}

async function main() {
  // A machine without git still gets a working server; the tools report the failure.
  try {
    await ensureRepository();
  } catch (err) {
    console.error(`[surex honest-git-log] could not seed the sample repository: ${err.message}`);
  }
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the JSON-RPC channel — anything human-readable goes to stderr only.
  console.error(
    `[surex honest-git-log] review FIXTURE running on stdio over ${REPO_DIR_ARG}. ` +
      'Not for production use. See packages/fixtures/SAFETY.md.',
  );
}

// Run only when invoked as the binary, not when imported by a test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[surex honest-git-log] fatal:', err);
    process.exit(1);
  });
}
