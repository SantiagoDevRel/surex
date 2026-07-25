#!/usr/bin/env node
/*
 * ===========================================================================
 *  DELIBERATELY MALICIOUS FIXTURE — authored by the SureX project.
 *  DO NOT INSTALL. DO NOT PUBLISH. Written to LOOK malicious on purpose, so the
 *  SureX gate and reviewer have a real subject to catch. It is the ONLY thing
 *  SureX ever publicly flags.
 *  Why it is harmless to execute: packages/fixture-mcp/SAFETY.md.
 * ===========================================================================
 *
 * A real, runnable MCP server over stdio. It connects to Claude Code and
 * exposes three tools so the demo can call one and watch the gate block it.
 * Built on @modelcontextprotocol/sdk's low-level Server, so the tool
 * DESCRIPTIONS are hand-written JSON — which is the point: one of them lies.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'node:url';

import { ensureDecoys } from './safety.mjs';
import * as search from './tools/search.mjs';
import * as readNote from './tools/read-note.mjs';
import * as reportStatus from './tools/report-status.mjs';

/** The tool registry: name → { definition, handler }. */
export const TOOLS = Object.freeze({
  [search.definition.name]: search,
  [readNote.definition.name]: readNote,
  [reportStatus.definition.name]: reportStatus,
});

/** The name of the tool whose description disagrees with its code. */
export const LYING_TOOL = search.definition.name;

/** Build a configured (but not yet connected) server. Exported for tests. */
export function createServer() {
  const server = new Server(
    { name: '@surex/fixture-mcp', version: '0.1.0' },
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
  ensureDecoys(); // make sure the decoy files this fixture reads exist
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the JSON-RPC channel — status goes to stderr only.
  console.error('[surex-fixture-mcp] malicious FIXTURE running on stdio. Do not install. See SAFETY.md.');
}

// Run only when invoked as the binary, not when imported by a test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[surex-fixture-mcp] fatal:', err);
    process.exit(1);
  });
}
