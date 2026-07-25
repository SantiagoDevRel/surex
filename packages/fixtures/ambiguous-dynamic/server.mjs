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
 * `ambiguous-dynamic` — a server whose tool list is not in its source.
 *
 * The premise: SureX's review reads source and stated intent. This server's stated
 * intent — the tool names, the descriptions, the input schemas an agent sees on
 * every turn — is assembled at startup from `tools.config.json`. Read every line
 * of this file and you still cannot say what this server will offer.
 *
 * That is the "runtime-loaded payload" blind spot the tech spec names in §6, in the
 * form it actually takes on a developer's machine. Not a fetch-then-eval: a
 * config-driven plugin host, which is an ordinary and defensible way to build one
 * of these. Every "add your own tools in YAML" MCP server has this shape.
 *
 * Two facts make it more than a curiosity:
 *
 *   1. Tool DESCRIPTIONS are the surface of the Invariant Labs description-poisoning
 *      class, and here they live in data. A poisoned description would never appear
 *      in a reviewed file.
 *   2. `SXF-1` fingerprints the install config — runner, package, version, residual
 *      args — and excludes `env` entirely (tech-spec §2.1–2.2). A JSON file sitting
 *      next to the server is not in the fingerprint at all. Editing it changes what
 *      this server offers without changing one reviewed byte, and the gate resolves
 *      the same fingerprint to the same verdict afterwards.
 *
 * What keeps it harmless: the config supplies DATA, not BEHAVIOUR. Each entry picks
 * a `kind` from a closed set of three implemented below, all confined to this
 * package. No `eval`, no `new Function`, no dynamic import. An entry naming an
 * unknown kind is refused at load and never registered. SAFETY.md is the account.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'node:url';

import {
  CONFIG_PATH,
  KINDS,
  MAX_TOOLS,
  ensureFiles,
  listNotes,
  loadToolConfig,
  readNote,
} from './safety.mjs';

// ---------------------------------------------------------------------------
// the three behaviours a config entry may select
// ---------------------------------------------------------------------------

/**
 * The closed vocabulary. A config entry names one of these keys; it cannot supply
 * one. Every handler here is confined to this package directory.
 */
const BEHAVIOURS = Object.freeze({
  'static-text': {
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run(entry) {
      return { content: [{ type: 'text', text: entry.text ?? '' }] };
    },
  },

  'list-notes': {
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run() {
      const notes = listNotes();
      return {
        content: [{
          type: 'text',
          text: notes.length
            ? notes.map((n) => `${String(n.size).padStart(6)}  ${n.name}`).join('\n')
            : 'No notes.',
        }],
      };
    },
  },

  'count-lines': {
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Note file name, e.g. "onboarding.md".' } },
      required: ['name'],
      additionalProperties: false,
    },
    async run(entry, args) {
      try {
        const text = readNote(args.name);
        const lines = text.split(/\r?\n/).length;
        return { content: [{ type: 'text', text: `${args.name}: ${lines} line(s)` }] };
      } catch {
        return { content: [{ type: 'text', text: `No note named "${args.name}".` }], isError: true };
      }
    },
  },
});

// ---------------------------------------------------------------------------
// the one tool that IS in the source
// ---------------------------------------------------------------------------

/**
 * The disclosure. A server built this way does not have to ship one; this fixture
 * does, so that a reader who only ever calls tools still learns where its tool list
 * came from and what it would take to change it.
 */
function describeToolSource(loaded) {
  return {
    definition: Object.freeze({
      name: 'describe_tool_source',
      description:
        'Reports where this server\'s tool list came from: the config file path, how many entries it '
        + 'registered, which entries it refused and why. The other tools on this server are declared in '
        + 'that file, not in the server source; editing it and restarting changes what this server offers.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    }),
    async handler() {
      return {
        content: [{
          type: 'text',
          text: [
            `tool list source: ${loaded.source}`,
            `loaded at: ${loaded.loadedAt}`,
            `registered from config: ${loaded.entries.length} of a maximum ${MAX_TOOLS}`,
            `allowed kinds (closed set, implemented in server.mjs): ${KINDS.join(', ')}`,
            '',
            ...loaded.entries.map((e) => `  ${e.name}  [${e.kind}]  ${e.description}`),
            ...(loaded.rejected.length
              ? ['', `refused ${loaded.rejected.length} entr(ies):`, ...loaded.rejected.map((r) => `  ${r.why}`)]
              : []),
            '',
            'This tool is the only one declared in the source. The rest are configuration.',
          ].join('\n'),
        }],
      };
    },
  };
}

// ---------------------------------------------------------------------------
// wiring
// ---------------------------------------------------------------------------

/**
 * Build the tool registry from the config on disk.
 *
 * Exported and parameterised so a test can point it at a different config and
 * assert that the exposed surface really does change with no change to this file —
 * which is the claim the fixture makes.
 */
export function buildTools(configPath = CONFIG_PATH) {
  const config = loadToolConfig(configPath);
  const loaded = { ...config, loadedAt: new Date().toISOString() };

  const tools = {};
  for (const entry of config.entries) {
    const behaviour = BEHAVIOURS[entry.kind];
    // Unreachable via loadToolConfig, which refuses unknown kinds. Kept because a
    // closed vocabulary that is only closed in one place is not closed.
    if (!behaviour) continue;
    tools[entry.name] = {
      definition: Object.freeze({
        name: entry.name,
        description: entry.description,
        inputSchema: behaviour.inputSchema,
      }),
      handler: (args = {}) => behaviour.run(entry, args),
    };
  }

  const disclosure = describeToolSource(loaded);
  tools[disclosure.definition.name] = disclosure;
  return { tools: Object.freeze(tools), loaded };
}

export function createServer(configPath = CONFIG_PATH) {
  const { tools, loaded } = buildTools(configPath);

  const server = new Server(
    { name: '@surex/fixture-ambiguous-dynamic', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.values(tools).map((t) => t.definition),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = tools[req.params.name];
    if (!tool) {
      return { content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }], isError: true };
    }
    return tool.handler(req.params.arguments ?? {});
  });

  return { server, tools, loaded };
}

async function main() {
  ensureFiles(); // the config and the notes this fixture owns
  const { server, loaded } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the JSON-RPC channel — status goes to stderr only.
  console.error(
    `[ambiguous-dynamic] SureX review fixture on stdio. Not for production use. `
    + `${loaded.entries.length} tool(s) loaded from ${loaded.source}`
    + `${loaded.rejected.length ? `, ${loaded.rejected.length} refused` : ''}. See SAFETY.md.`,
  );
  for (const r of loaded.rejected) console.error(`[ambiguous-dynamic] refused a config entry: ${r.why}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[ambiguous-dynamic] fatal:', err);
    process.exit(1);
  });
}
