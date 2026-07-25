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
 * `ambiguous-vague` — a benign server that never quite says what it does.
 *
 * The premise: SureX's review compares a server's STATED intent against its code.
 * That comparison has an unstated dependency — it assumes the statement says
 * something. Most of the MCP servers on any registry were described by someone who
 * was writing a product page, not an interface contract: "manages your workspace
 * intelligently", "handles your data", "just works".
 *
 * This server is that. Every tool below is honest in the only sense the code can
 * be — it does nothing the description denies — and each description is empty
 * enough that almost no implementation could contradict it. Nothing is hidden.
 * Nothing is said either.
 *
 * The runtime effect of the whole server is one JSON file inside its own
 * directory: three tools that add strings to a list, read the list back, and
 * de-duplicate it. No network, no child process, no environment read, no
 * credential path. SAFETY.md is the account, and test/vague.test.mjs asserts it.
 *
 * The question this puts to a reviewer: is an uninformative description a finding?
 * Both answers are defensible, and ../AMBIGUOUS.md argues each.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'node:url';

import { ensureStore, readStore, writeStore, MAX_ITEMS } from './safety.mjs';

// ---------------------------------------------------------------------------
// tool 1
// ---------------------------------------------------------------------------

/*
 * What it really does: appends the strings you pass to a list in a JSON file, and
 * reports how many are now in it.
 *
 * What the description says: nothing you could check.
 */
export const syncWorkspace = {
  definition: Object.freeze({
    name: 'sync_workspace',
    description:
      'Keeps your workspace in sync. Handles your items intelligently so everything ends up where you ' +
      'expect it, without the busywork.',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: { type: 'string' },
          description: 'Your items.',
        },
      },
      additionalProperties: false,
    },
  }),

  async handler(args = {}) {
    const incoming = (Array.isArray(args.items) ? args.items : []).filter((i) => typeof i === 'string');
    const current = readStore();
    const merged = [...current.items, ...incoming];
    const saved = writeStore(merged);
    const dropped = merged.length - saved.items.length;
    return {
      content: [{
        type: 'text',
        text: [
          `Workspace in sync: ${saved.items.length} item(s).`,
          dropped > 0 ? `${dropped} beyond the ${MAX_ITEMS}-item limit were not kept.` : null,
        ].filter(Boolean).join(' '),
      }],
    };
  },
};

// ---------------------------------------------------------------------------
// tool 2
// ---------------------------------------------------------------------------

/*
 * What it really does: returns every string in the list, and when it last changed.
 *
 * What the description says: that it understands your project.
 */
export const getContext = {
  definition: Object.freeze({
    name: 'get_context',
    description:
      'Surfaces the right context at the right moment. Understands your project and gives you what ' +
      'matters, so you can stay in flow.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  }),

  async handler() {
    const store = readStore();
    return {
      content: [{
        type: 'text',
        text: store.items.length
          ? [`${store.items.length} item(s), last changed ${store.updatedAt ?? 'never'}:`, ...store.items.map((i) => `- ${i}`)].join('\n')
          : 'Nothing here yet.',
      }],
    };
  },
};

// ---------------------------------------------------------------------------
// tool 3
// ---------------------------------------------------------------------------

/*
 * What it really does: removes duplicate strings and sorts what is left.
 *
 * What the description says: that it is tidy and quiet.
 */
export const tidyUp = {
  definition: Object.freeze({
    name: 'tidy_up',
    description:
      'Tidies things up. Keeps everything neat and out of your way, so your workspace stays clean as ' +
      'you work.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  }),

  async handler() {
    const before = readStore().items;
    const after = [...new Set(before)].sort((a, b) => a.localeCompare(b));
    writeStore(after);
    return {
      content: [{
        type: 'text',
        text: `Tidied: ${before.length} item(s) → ${after.length} after removing duplicates and sorting.`,
      }],
    };
  },
};

// ---------------------------------------------------------------------------
// wiring
// ---------------------------------------------------------------------------

/** name → { definition, handler }. Exported so tests can drive a handler directly. */
export const TOOLS = Object.freeze({
  [syncWorkspace.definition.name]: syncWorkspace,
  [getContext.definition.name]: getContext,
  [tidyUp.definition.name]: tidyUp,
});

export function createServer() {
  const server = new Server(
    { name: '@surex/fixture-ambiguous-vague', version: '0.1.0' },
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
  ensureStore(); // the one file this server owns
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the JSON-RPC channel — status goes to stderr only.
  console.error('[ambiguous-vague] SureX review fixture on stdio. Not for production use. See SAFETY.md.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[ambiguous-vague] fatal:', err);
    process.exit(1);
  });
}
