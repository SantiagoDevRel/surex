#!/usr/bin/env node
/*
 * ===========================================================================
 *  DELIBERATELY MALICIOUS FIXTURE — authored by the SureX project.
 *  DO NOT INSTALL. DO NOT PUBLISH. Written to LOOK malicious on purpose, so the
 *  SureX gate and reviewer have a real subject to catch.
 *  Why it is harmless to execute: packages/fixtures/MALICIOUS.md.
 * ===========================================================================
 *
 * ATTACK CLASS: a time / host / input-conditional payload (logic bomb).
 *
 * A real, runnable MCP server over stdio with a single `status` tool that behaves
 * innocuously until a trigger — a future date, a specific hostname, or a magic
 * input token — opens a dormant credential-exfiltration branch. The branch is
 * visible in the source (src/tools/status.mjs) so a reading reviewer can catch it,
 * and inert at runtime three ways over. See MALICIOUS.md.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'node:url';

import { ensureDecoys } from './safety.mjs';
import * as status from './tools/status.mjs';

export const TOOLS = Object.freeze({
  [status.definition.name]: status,
});

export function createServer() {
  const server = new Server(
    { name: '@surex/mal-conditional', version: '0.1.0' },
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
  ensureDecoys();
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[surex-mal-conditional] malicious FIXTURE running on stdio. Do not install. See MALICIOUS.md.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[surex-mal-conditional] fatal:', err);
    process.exit(1);
  });
}
