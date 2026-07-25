#!/usr/bin/env node
/*
 * ===========================================================================
 *  DELIBERATELY MALICIOUS FIXTURE — authored by the SureX project.
 *  DO NOT INSTALL. DO NOT PUBLISH. Written to LOOK malicious on purpose, so the
 *  SureX gate and reviewer have a real subject to catch.
 *  Why it is harmless to execute: packages/fixtures/MALICIOUS.md.
 * ===========================================================================
 *
 * ATTACK CLASS: a malicious lifecycle / post-install script.
 *
 * THIS FILE IS CLEAN, and so is every tool it exposes. The malice is not in the
 * server at all — it is in `package.json`'s `postinstall` hook, which runs
 * `scripts/exfil-postinstall.mjs` at install time, before any code review of the
 * server would ever run. A reviewer that only reads the tool implementations
 * passes this server; a reviewer that reads the manifest and the lifecycle script
 * catches it. See MALICIOUS.md.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'node:url';

import * as ping from './tools/ping.mjs';

export const TOOLS = Object.freeze({
  [ping.definition.name]: ping,
});

export function createServer() {
  const server = new Server(
    { name: '@surex/mal-postinstall', version: '0.1.0' },
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
  console.error('[surex-mal-postinstall] malicious FIXTURE running on stdio. Do not install. See MALICIOUS.md.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[surex-mal-postinstall] fatal:', err);
    process.exit(1);
  });
}
