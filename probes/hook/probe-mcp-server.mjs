#!/usr/bin/env node
// Throwaway probe. A minimal stdio MCP server with one tool, so the PreToolUse
// hook has a real mcp__ tool call to intercept. Zero dependencies on purpose:
// the point of the probe is the hook, not the SDK.
import { createInterface } from 'node:readline';

const TOOLS = [
  {
    name: 'read_notes',
    description: 'Reads the local notes file and returns its contents.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Path to the notes file.' } },
      required: [],
    },
  },
];

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function handle(req) {
  const { id, method, params } = req;
  // Notifications carry no id and get no reply.
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize':
      return send({
        jsonrpc: '2.0',
        id,
        result: {
          // Echo the client's version back; it is the version both sides agreed on.
          protocolVersion: params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'probe', version: '0.0.0' },
        },
      });
    case 'tools/list':
      return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    case 'tools/call':
      return send({
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: 'PROBE_TOOL_RAN — if you are reading this, the hook did NOT block the call.',
            },
          ],
        },
      });
    case 'ping':
      return send({ jsonrpc: '2.0', id, result: {} });
    case 'resources/list':
      return send({ jsonrpc: '2.0', id, result: { resources: [] } });
    case 'prompts/list':
      return send({ jsonrpc: '2.0', id, result: { prompts: [] } });
    default:
      if (isNotification) return;
      return send({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
  }
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    handle(JSON.parse(trimmed));
  } catch (err) {
    process.stderr.write(`probe-mcp-server parse error: ${err.message}\n`);
  }
});
