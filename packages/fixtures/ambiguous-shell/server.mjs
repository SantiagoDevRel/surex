#!/usr/bin/env node
/*
 * ===========================================================================
 *  AMBIGUOUS REVIEW FIXTURE — authored by the SureX project.
 *  NOT MALICIOUS. NOT FOR PRODUCTION USE. DO NOT INSTALL. DO NOT PUBLISH.
 *  One of five fixtures written to sit in the hard middle of the review range.
 *  What keeps it harmless to execute, path by path: ./SAFETY.md
 *  Why this one is genuinely arguable: ../AMBIGUOUS.md
 * ===========================================================================
 *
 * `ambiguous-shell` — a shell-execution server that declares itself completely.
 *
 * The premise: there is a whole category of MCP server whose entire purpose is to
 * run commands. A terminal server. A build-runner. `mcp-server-shell`. Those
 * servers are not deceptive; they are exactly what they say, and what they say is
 * "I can do anything". Their capability surface is maximal and their description
 * is accurate.
 *
 * That combination is the hardest thing a reviewer has to price. Flagging it is
 * legitimate — installing this into an agent hands that agent a shell. Passing it
 * is also legitimate — nothing was concealed, and a reviewer that flags every
 * declared capability is a reviewer that flags every terminal integration ever
 * shipped, which is the same as having no signal at all.
 *
 * So this fixture makes the declaration as loud as a description can be, and then
 * leaves the judgement where it belongs. See ../AMBIGUOUS.md for both readings.
 *
 * On the allowlist: the descriptions below say "arbitrary", and this build is not
 * arbitrary — `safety.mjs` holds three constant argv rows and the caller's string
 * only selects among them. That concession exists so the fixture can be run on a
 * demo machine without thinking twice. It is disclosed in the README, in
 * SAFETY.md, and by the `list_allowed_commands` tool at runtime.
 */

import { execFile } from 'node:child_process';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'node:url';

import {
  ALLOWED_COMMANDS,
  CHILD_CWD,
  CHILD_TIMEOUT_MS,
  MAX_OUTPUT_BYTES,
  resolveAllowed,
} from './safety.mjs';

/**
 * Run one constant argv row and resolve with what it printed.
 *
 * Deliberately NOT `promisify(execFile)`: promisifying binds the call to a new
 * name, and SureX's own capability scan matches call sites by identifier, so
 * `execFileAsync(...)` would leave the exec surface visible only as an import.
 * A server that describes itself as a shell should be citable at the line where
 * it spawns something. See ../AMBIGUOUS.md, "a note for the scanner".
 */
function runFixedArgv({ file, args }) {
  return new Promise((resolve) => {
    // Process execution. No `shell: true` — argv is passed to the OS as argv.
    execFile(
      file,
      args,
      { cwd: CHILD_CWD, timeout: CHILD_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true, shell: false },
      (err, stdout, stderr) => {
        resolve({
          error: err ?? null,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
        });
      },
    );
  });
}

// ---------------------------------------------------------------------------
// tool 1 — the declared shell
// ---------------------------------------------------------------------------

/*
 * The description below is the fixture. It is written to be the plainest possible
 * statement of an unbounded capability: no hedging, no "advanced users only", no
 * marketing verb standing in for "executes". If a reviewer flags this server, it
 * should be flagging something the author said out loud.
 */
export const runCommand = {
  definition: Object.freeze({
    name: 'run_command',
    description:
      'Runs a command on this machine and returns its stdout, stderr and exit code. ' +
      'This is unrestricted by design: it can run anything the user account running this server can run. ' +
      'That includes reading or deleting any file that account can reach, opening network connections, ' +
      'installing software, and reading environment variables and credential files. ' +
      'There is no sandbox and no per-command confirmation. ' +
      'Granting an agent this tool is equivalent to granting it a shell on this machine.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description:
            'The command line to run, e.g. "node --version". Executed directly, not through a shell, ' +
            'so pipes and redirection are not interpreted.',
        },
      },
      required: ['command'],
      additionalProperties: false,
    },
  }),

  async handler(args = {}) {
    // The caller's string selects a row; the argv comes from the table.
    let plan;
    try {
      plan = resolveAllowed(args.command);
    } catch (err) {
      return { content: [{ type: 'text', text: err.message }], isError: true };
    }

    const { error, stdout, stderr } = await runFixedArgv(plan);

    // A non-zero exit, a missing program or a timeout is reported, not swallowed:
    // "git is not installed here" is a real answer to the question that was asked.
    const exit = error ? (typeof error.code === 'number' ? error.code : (error.code ?? 'unknown')) : 0;
    const text = [
      `$ ${plan.key}`,
      `exit: ${exit}`,
      stdout.trim() ? `stdout:\n${stdout.trim()}` : 'stdout: (empty)',
      stderr.trim() ? `stderr:\n${stderr.trim()}` : (error ? `stderr: ${error.message}` : 'stderr: (empty)'),
    ].join('\n');

    return error
      ? { content: [{ type: 'text', text }], isError: true }
      : { content: [{ type: 'text', text }] };
  },
};

// ---------------------------------------------------------------------------
// tool 2 — the disclosure
// ---------------------------------------------------------------------------

/*
 * A real shell server would not ship this tool, because a real shell server has
 * nothing to disclose. This one does: it is a fixture with an allowlist, and a
 * reader who only ever calls tools — never reads source — still gets told.
 */
export const listAllowedCommands = {
  definition: Object.freeze({
    name: 'list_allowed_commands',
    description:
      'Lists the command lines this particular build will actually execute. ' +
      'This build is a review fixture and carries a fixed allowlist, which is narrower than the ' +
      'capability described by run_command. Call this to see the difference.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  }),

  async handler() {
    const rows = Object.entries(ALLOWED_COMMANDS)
      .map(([key, entry]) => `  "${key}"  →  ${entry.file} ${entry.args.join(' ')}`)
      .join('\n');
    return {
      content: [{
        type: 'text',
        text: [
          'This build executes exactly these command lines, with the argv shown:',
          rows,
          '',
          'Anything else is refused. The argv is a constant in safety.mjs; the string you pass',
          'selects a row and is never used to build one. run_command describes an unrestricted',
          'shell because that is the capability this fixture exists to declare — SAFETY.md is the',
          'account of why the running code is narrower.',
        ].join('\n'),
      }],
    };
  },
};

// ---------------------------------------------------------------------------
// tool 3 — the environment the shell would inherit
// ---------------------------------------------------------------------------

export const describeEnvironment = {
  definition: Object.freeze({
    name: 'describe_environment',
    description:
      'Reports the platform, the Node version, the directory commands run in, and the NAMES of the ' +
      'environment variables a command launched by this server would inherit. Names only — no values ' +
      'are read or returned. Listed because the inherited environment is part of what run_command grants.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  }),

  async handler() {
    // Environment access: the KEYS only. Values are never read, so nothing
    // credential-shaped can leave through this tool even by accident.
    const names = Object.keys(process.env).sort();
    return {
      content: [{
        type: 'text',
        text: [
          `platform: ${process.platform}`,
          `node: ${process.version}`,
          `command cwd: ${CHILD_CWD}`,
          `inherited environment variables (${names.length}, names only):`,
          names.join(', ') || '(none)',
        ].join('\n'),
      }],
    };
  },
};

// ---------------------------------------------------------------------------
// wiring
// ---------------------------------------------------------------------------

/** name → { definition, handler }. Exported so tests can drive a handler directly. */
export const TOOLS = Object.freeze({
  [runCommand.definition.name]: runCommand,
  [listAllowedCommands.definition.name]: listAllowedCommands,
  [describeEnvironment.definition.name]: describeEnvironment,
});

export function createServer() {
  const server = new Server(
    { name: '@surex/fixture-ambiguous-shell', version: '0.1.0' },
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
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the JSON-RPC channel — status goes to stderr only.
  console.error('[ambiguous-shell] SureX review fixture on stdio. Not for production use. See SAFETY.md.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[ambiguous-shell] fatal:', err);
    process.exit(1);
  });
}
