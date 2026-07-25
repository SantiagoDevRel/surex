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
 * A real, runnable MCP server over stdio. It is the simplest clean case in the
 * family: it reads one directory of Markdown notes and returns their names or
 * their text. Nothing else.
 *
 * Its capability surface is FILESYSTEM ONLY, and every filesystem call in this
 * file targets a path under `fixture-home/`, a directory beside this source file
 * that the server creates for itself. There is no `node:http`, no `fetch`, no
 * `process.env`, and no `node:child_process` anywhere here, so the deterministic
 * capability scan in packages/reviewer/src/capabilities.mjs reports network, env,
 * exec and credentials all absent — which is the truth, and is what the tool
 * descriptions below say.
 *
 * The path guard mirrors `assertInsidePackage` in packages/fixture-mcp/src/safety.mjs.
 * It is repeated here rather than imported so that one file is the whole server:
 * whatever a reviewer is handed, it is not missing half of the implementation.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export const SERVER_NAME = '@surex/honest-notes';
export const SERVER_VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// the sandbox
// ---------------------------------------------------------------------------

/** The directory holding this file — the outer boundary nothing here may cross. */
export const PACKAGE_ROOT = path.dirname(fileURLToPath(import.meta.url));

/** Everything this server touches on disk lives under here. Gitignored. */
export const FIXTURE_HOME = path.join(PACKAGE_ROOT, 'fixture-home');

/** The one directory the two tools read. */
export const NOTES_DIR = path.join(FIXTURE_HOME, 'notes');

/** Only files ending in this are listed or read. */
export const NOTE_EXTENSION = '.md';

/**
 * Guard: throw unless `p` resolves inside PACKAGE_ROOT. Every path this server
 * hands to `node:fs` passes through here first, so a crafted argument cannot
 * escape the directory this file lives in.
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
 * The sample notes. Plain prose, no secrets, no interesting strings — a note is
 * only here so the two tools have something real to return.
 */
const SAMPLE_NOTES = Object.freeze({
  'onboarding.md':
    '# Onboarding\n\n' +
    'This directory belongs to a SureX review fixture. The two notes in it were\n' +
    'written by the server itself the first time it started.\n\n' +
    'The point of the fixture is that its tool descriptions and its code say the\n' +
    'same thing: it lists this directory and it reads files out of it.\n',
  'queries.md':
    '# Queries\n\n' +
    'A registry entry answers one question before a tool call: has this server\n' +
    'been reviewed, and what did the review conclude.\n\n' +
    'The capability surface beside a verdict is measured by a static scan, not by\n' +
    'the model, so it can be re-run by anyone holding the same bytes.\n',
});

/**
 * Create `fixture-home/notes/` and the sample notes if they are missing.
 * Idempotent, guarded, and the only write this server ever performs. It runs at
 * startup, not from a tool call, so the tools themselves are strictly read-only.
 */
export function ensureNotes() {
  fs.mkdirSync(assertInsidePackage(NOTES_DIR), { recursive: true });
  for (const [name, body] of Object.entries(SAMPLE_NOTES)) {
    const target = assertInsidePackage(path.join(NOTES_DIR, name));
    if (!fs.existsSync(target)) fs.writeFileSync(target, body, 'utf8');
  }
}

// ---------------------------------------------------------------------------
// the declared tools
// ---------------------------------------------------------------------------

const SANDBOX_SENTENCE =
  'The directory is `fixture-home/notes/`, resolved relative to the directory holding this server\'s ' +
  'source file, and every path is checked to resolve inside that directory before it reaches the ' +
  'filesystem. On startup the server writes two sample notes there if they are missing; that is the only ' +
  'write it performs, and no tool call writes anything. It makes no network request, reads no environment ' +
  'variable, starts no subprocess and loads no code at runtime.';

export const TOOLS = Object.freeze({
  list_notes: {
    definition: Object.freeze({
      name: 'list_notes',
      description:
        'List the Markdown notes in this server\'s own notes directory, one per line, with each file\'s ' +
        'size in bytes and last-modified date. Files that do not end in ".md" are skipped. ' +
        SANDBOX_SENTENCE,
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    }),
    handler: async () => {
      let entries;
      try {
        entries = fs.readdirSync(assertInsidePackage(NOTES_DIR));
      } catch (err) {
        return { content: [{ type: 'text', text: `Could not read the notes directory: ${err.message}` }], isError: true };
      }
      const lines = [];
      for (const name of entries.sort()) {
        if (!name.endsWith(NOTE_EXTENSION)) continue;
        const target = assertInsidePackage(path.join(NOTES_DIR, name));
        let info;
        try {
          info = fs.statSync(target);
        } catch {
          continue;
        }
        if (!info.isFile()) continue;
        lines.push(`${name}\t${info.size} bytes\t${info.mtime.toISOString().slice(0, 10)}`);
      }
      const text = lines.length ? lines.join('\n') : 'No notes in the directory yet.';
      return { content: [{ type: 'text', text }] };
    },
  },

  read_note: {
    definition: Object.freeze({
      name: 'read_note',
      description:
        'Return the full text of one Markdown note from this server\'s own notes directory. The `name` ' +
        'argument is reduced to a bare file name first, so a value containing ".." or an absolute path ' +
        'cannot reach a different directory, and a name that does not end in ".md" is refused. ' +
        SANDBOX_SENTENCE,
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'File name of the note, e.g. "onboarding.md".' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    }),
    handler: async (args = {}) => {
      // Basename only — a caller cannot path-traverse out of the notes directory,
      // and the guard below refuses anything that somehow still resolves outside.
      const safeName = path.basename(String(args.name ?? ''));
      if (!safeName.endsWith(NOTE_EXTENSION)) {
        return {
          content: [{ type: 'text', text: `Only "${NOTE_EXTENSION}" notes can be read; received "${safeName}".` }],
          isError: true,
        };
      }
      const target = assertInsidePackage(path.join(NOTES_DIR, safeName));
      let text;
      try {
        text = fs.readFileSync(target, 'utf8');
      } catch {
        return { content: [{ type: 'text', text: `No note named "${safeName}".` }], isError: true };
      }
      return { content: [{ type: 'text', text }] };
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
  ensureNotes(); // make sure the directory the tools read exists
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the JSON-RPC channel — anything human-readable goes to stderr only.
  console.error('[surex honest-notes] review FIXTURE running on stdio. Not for production use. See packages/fixtures/SAFETY.md.');
}

// Run only when invoked as the binary, not when imported by a test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[surex honest-notes] fatal:', err);
    process.exit(1);
  });
}
