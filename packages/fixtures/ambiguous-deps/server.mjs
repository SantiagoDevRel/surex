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
 * `ambiguous-deps` — a spotless file over a dependency the review does not read.
 *
 * The premise: SureX reviews the files it is handed and nothing they import. The
 * tech spec says so first among the things review cannot see, and calls it "the
 * actual npm and PyPI attack pattern" (§6): the top-level source can be spotless
 * while what it imports is not.
 *
 * So this file is spotless. Deliberately, completely, and in a way you can measure:
 * run SureX's own deterministic capability scan over this file alone and all five
 * categories come back absent. No filesystem import, no network, no child process,
 * no `process.env`, no credential path. It imports the MCP SDK and one dependency,
 * declares three tools, calls four functions, and formats what they return.
 *
 * Every capability is in `vendor/workspace-toolkit/index.mjs` — filesystem reads and
 * writes, a directory listing, and an environment variable. Hand that file to the
 * scan as well and the surface appears. A test asserts both halves of that, which
 * is the fixture's whole contribution: the blind spot, demonstrated with the
 * project's own tooling rather than described.
 *
 * The dependency is harmless — it is clamped inside this fixture's `fixture-home/`
 * and has no network or exec path at all. A fixture is not an attack. But the
 * *visibility* is identical to one, and that is the part a reviewer has to price.
 *
 * On `vendor/` rather than `node_modules/`: the repo gitignores `node_modules/`, and
 * a dependency that has to survive a clone cannot live there. Nothing about the
 * blind spot changes — this is a dependency of this file, and a review of this file
 * does not read it.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'node:url';

import { about, list, read, writeNote } from '#workspace-toolkit';

// ---------------------------------------------------------------------------
// the tools
// ---------------------------------------------------------------------------

export const listWorkspace = {
  definition: Object.freeze({
    name: 'list_workspace',
    description:
      'Lists the files in the workspace directory: name, size in bytes, and a short content digest.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  }),

  async handler() {
    try {
      const files = list();
      return {
        content: [{
          type: 'text',
          text: files.length
            ? files.map((f) => `${f.digest}  ${String(f.size).padStart(6)}  ${f.name}`).join('\n')
            : 'The workspace is empty.',
        }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: err.message }], isError: true };
    }
  },
};

export const readWorkspaceFile = {
  definition: Object.freeze({
    name: 'read_workspace_file',
    description: 'Reads one file from the workspace directory by name and returns its text.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'File name, e.g. "notes.md".' } },
      required: ['name'],
      additionalProperties: false,
    },
  }),

  async handler(args = {}) {
    try {
      return { content: [{ type: 'text', text: read(args.name) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: err.message }], isError: true };
    }
  },
};

export const writeWorkspaceNote = {
  definition: Object.freeze({
    name: 'write_workspace_note',
    description:
      'Writes a note into the workspace directory. The name is used as a file name with a .md extension.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Note name, e.g. "todo".' },
        body: { type: 'string', description: 'The note text.' },
      },
      required: ['name', 'body'],
      additionalProperties: false,
    },
  }),

  async handler(args = {}) {
    try {
      const written = writeNote(args.name, args.body);
      return { content: [{ type: 'text', text: `Wrote ${written.name} (${written.bytes} bytes).` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: err.message }], isError: true };
    }
  },
};

/**
 * The disclosure. A server built this way does not have to ship one; this fixture
 * does, so a reader who only ever calls tools still learns that the work — and the
 * whole capability surface — happens in a dependency.
 */
export const describeImplementation = {
  definition: Object.freeze({
    name: 'describe_implementation',
    description:
      'Reports which dependency implements the other tools on this server, and which capabilities that '
      + 'dependency uses. This server file contains no filesystem, network, process or environment access '
      + 'of its own; all of it is in the dependency named here.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  }),

  async handler() {
    return {
      content: [{
        type: 'text',
        text: [
          `implemented by: ${about.name}@${about.version}`,
          `entry point: ${about.entry}`,
          `capabilities used there: ${about.capabilities.join('; ')}`,
          `clamped to: ${about.clampedTo}`,
          '',
          'A review of this server\'s own source finds no capability at all. The reach is one import away.',
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
  [listWorkspace.definition.name]: listWorkspace,
  [readWorkspaceFile.definition.name]: readWorkspaceFile,
  [writeWorkspaceNote.definition.name]: writeWorkspaceNote,
  [describeImplementation.definition.name]: describeImplementation,
});

export function createServer() {
  const server = new Server(
    { name: '@surex/fixture-ambiguous-deps', version: '0.1.0' },
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
  console.error(
    `[ambiguous-deps] SureX review fixture on stdio. Not for production use. `
    + `Work done by ${about.name}@${about.version} (${about.entry}). See SAFETY.md.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[ambiguous-deps] fatal:', err);
    process.exit(1);
  });
}
