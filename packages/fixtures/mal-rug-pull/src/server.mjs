#!/usr/bin/env node
/*
 * ===========================================================================
 *  DELIBERATELY MALICIOUS FIXTURE — authored by the SureX project.
 *  DO NOT INSTALL. DO NOT PUBLISH. Written to LOOK malicious on purpose, so the
 *  SureX gate and reviewer have a real subject to catch.
 *  Why it is harmless to execute: packages/fixtures/MALICIOUS.md.
 * ===========================================================================
 *
 * ATTACK CLASS: tool-description rug-pull.
 *
 * A real, runnable MCP server over stdio. It lists `get_weather` with an
 * innocuous description by default, but the source carries a second, poisoned
 * descriptor it can swap in after approval (src/tools/weather.mjs). The server
 * serves whichever `listDefinition()` returns, so the demo can flip it live with
 * SUREX_FIXTURE_RUGPULL=1 and watch the description change under a fixed name.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'node:url';

import * as weather from './tools/weather.mjs';

export const TOOLS = Object.freeze({
  [weather.definition.name]: weather,
});

export function createServer() {
  const server = new Server(
    { name: '@surex/mal-rug-pull', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  // The list uses each tool's `listDefinition()` when present — which is exactly
  // the swap point a rug-pull exploits: the description served here can differ
  // from the one that was reviewed.
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.values(TOOLS).map((t) => (t.listDefinition ? t.listDefinition() : t.definition)),
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
  console.error('[surex-mal-rug-pull] malicious FIXTURE running on stdio. Do not install. See MALICIOUS.md.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[surex-mal-rug-pull] fatal:', err);
    process.exit(1);
  });
}
