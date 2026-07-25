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
 * A real, runnable MCP server over stdio, and the interesting honest case: it
 * makes an outbound request AND reads an API key out of the environment, and it
 * says both things in the text a caller sees.
 *
 * The malicious fixture in packages/fixture-mcp/ reaches for network, environment
 * and credential material too. The difference is not the capability surface — the
 * deterministic scan reports network, env and credentials present for BOTH — it is
 * that here the tool descriptions name the host, name the environment variable,
 * and state that the key is sent to that host. A reviewer comparing description to
 * code should find nothing unaccounted for.
 *
 * There are exactly two endpoints this file can reach, both written literally
 * below, and `assertAllowedEndpoint` refuses anything else. No environment
 * variable can supply a URL, so there is no way to redirect the request:
 *
 *   1. `http://127.0.0.1:9/weather` — the DEFAULT. 127.0.0.1 is this machine's
 *      loopback interface and port 9 is the TCP discard port, so the request
 *      cannot leave the machine and normally nothing is listening. This is what
 *      runs unless someone deliberately turns the live call on.
 *   2. `https://api.openweathermap.org/data/2.5/weather` — reached only when
 *      SUREX_FIXTURE_WEATHER_LIVE=1 is set in the environment. Unset by default.
 *
 * This server touches no file: there is no `node:fs` and no `node:child_process`
 * here, so the capability scan reports filesystem and exec absent.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'node:url';

export const SERVER_NAME = '@surex/honest-weather';
export const SERVER_VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// the two endpoints, and the guard that allows no third
// ---------------------------------------------------------------------------

/** The default: loopback interface, TCP discard port. Nothing leaves the machine. */
export const LOOPBACK_ENDPOINT = 'http://127.0.0.1:9/weather';

/** The live endpoint. Reached only when the env flag below is exactly "1". */
export const LIVE_ENDPOINT = 'https://api.openweathermap.org/data/2.5/weather';

/** The one remote hostname this server can ever contact. */
export const LIVE_HOST = 'api.openweathermap.org';

/** The env flag that switches from loopback to the live host. Off unless "1". */
export const LIVE_FLAG_VAR = 'SUREX_FIXTURE_WEATHER_LIVE';

/**
 * The env var holding the OpenWeather key. Named in both tool descriptions, and
 * its value is put in the `appid` query parameter of whichever endpoint is in
 * effect — loopback by default, so by default the key does not leave the machine.
 */
export const KEY_VAR = 'OPENWEATHER_API_KEY';

/** How long a request may take before it is aborted. */
export const REQUEST_TIMEOUT_MS = 8000;

/** True only when the live flag is exactly "1". */
export function liveEnabled() {
  return process.env[LIVE_FLAG_VAR] === '1';
}

/** The endpoint actually in effect. One of exactly two literals. */
export function endpointInEffect() {
  return liveEnabled() ? LIVE_ENDPOINT : LOOPBACK_ENDPOINT;
}

/**
 * Guard: throw unless the endpoint is one of the two literals above. There is no
 * env override for the URL, so this is a belt on top of braces — but it is the
 * check that makes "this server cannot be pointed at another host" a property of
 * the code rather than a claim in a comment.
 */
export function assertAllowedEndpoint(url) {
  if (url !== LOOPBACK_ENDPOINT && url !== LIVE_ENDPOINT) {
    throw new Error(`fixture safety: refused an endpoint that is not one of the two pinned URLs: ${url}`);
  }
  return url;
}

/** The key, or an empty string when it is unset. */
function apiKey() {
  return process.env[KEY_VAR] ?? '';
}

/**
 * Build the request URL, plus a display copy with the key replaced. Only the
 * display copy is ever returned to the caller, so the key cannot be read back out
 * of this server through its own output.
 */
export function buildRequest(city) {
  const endpoint = assertAllowedEndpoint(endpointInEffect());
  const url = new URL(endpoint);
  url.searchParams.set('q', city);
  url.searchParams.set('units', 'metric');
  url.searchParams.set('appid', apiKey());

  const display = new URL(endpoint);
  display.searchParams.set('q', city);
  display.searchParams.set('units', 'metric');
  display.searchParams.set('appid', apiKey() ? '<redacted>' : '<unset>');

  return { url: url.toString(), display: display.toString() };
}

// ---------------------------------------------------------------------------
// the declared tools
// ---------------------------------------------------------------------------

const DISCLOSURE =
  'What this sends, and where: an HTTPS GET whose query string contains exactly three values — the city ' +
  'name you pass, the fixed string "metric", and an "appid" parameter holding the value of the ' +
  `${KEY_VAR} environment variable. That key is sent to whichever of the two endpoints is in effect. ` +
  `By default the endpoint is ${LOOPBACK_ENDPOINT}, which is this machine's own loopback interface on ` +
  'the TCP discard port, so by default nothing — the city or the key — leaves the machine, and the ' +
  `request normally fails to connect. Only when the environment variable ${LIVE_FLAG_VAR} is set to "1" ` +
  `does the request instead go to ${LIVE_ENDPOINT}, and then the key IS sent over the network to ` +
  `${LIVE_HOST}, which is the point of an API key. No environment variable can change the URL: those two ` +
  'endpoints are string literals in the server source and any other URL is refused. The key is never ' +
  'echoed back in a result; the endpoint shown to you has it replaced with "<redacted>". This server ' +
  'reads no file, starts no subprocess and loads no code at runtime.';

export const TOOLS = Object.freeze({
  get_weather: {
    definition: Object.freeze({
      name: 'get_weather',
      description:
        'Look up current weather for a city name and return the response body as text. ' +
        DISCLOSURE,
      inputSchema: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name to look up, e.g. "Lisbon".' },
        },
        required: ['city'],
        additionalProperties: false,
      },
    }),
    handler: async (args = {}) => {
      const city = String(args.city ?? '').trim();
      if (!city) {
        return { content: [{ type: 'text', text: 'A non-empty city name is required.' }], isError: true };
      }

      let request;
      try {
        request = buildRequest(city);
      } catch (err) {
        return { content: [{ type: 'text', text: err.message }], isError: true };
      }

      const header = [
        `endpoint: ${request.display}`,
        `live host enabled: ${liveEnabled() ? `yes (${LIVE_HOST})` : `no (loopback only)`}`,
        `${KEY_VAR}: ${apiKey() ? 'set, and sent to the endpoint above' : 'not set, so an empty appid was sent'}`,
      ].join('\n');

      let body;
      try {
        const res = await fetch(request.url, {
          method: 'GET',
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const text = await res.text();
        body = `HTTP ${res.status}\n${text.slice(0, 4000)}`;
      } catch (err) {
        body = `the request did not complete: ${err.message}`;
      }

      return { content: [{ type: 'text', text: `${header}\n\n${body}` }] };
    },
  },

  describe_endpoint: {
    definition: Object.freeze({
      name: 'describe_endpoint',
      description:
        'Report where this server would send a lookup right now, without sending one: the endpoint in ' +
        'effect, whether the live host is enabled, and whether the API key environment variable is set. ' +
        'The key\'s value is never returned — only whether it has one. This tool makes no network ' +
        'request of its own. ' +
        DISCLOSURE,
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    }),
    handler: async () => {
      const lines = [
        `endpoint in effect: ${endpointInEffect()}`,
        `default endpoint: ${LOOPBACK_ENDPOINT} (loopback, discard port)`,
        `live endpoint: ${LIVE_ENDPOINT}`,
        `${LIVE_FLAG_VAR}: ${liveEnabled() ? '1 — the live host is enabled' : 'not set to 1 — loopback only'}`,
        `${KEY_VAR}: ${apiKey() ? 'set (value withheld)' : 'not set'}`,
        `request timeout: ${REQUEST_TIMEOUT_MS} ms`,
      ];
      return { content: [{ type: 'text', text: lines.join('\n') }] };
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
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the JSON-RPC channel — anything human-readable goes to stderr only.
  console.error(
    `[surex honest-weather] review FIXTURE running on stdio. Endpoint in effect: ${endpointInEffect()}. ` +
      'Not for production use. See packages/fixtures/SAFETY.md.',
  );
}

// Run only when invoked as the binary, not when imported by a test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[surex honest-weather] fatal:', err);
    process.exit(1);
  });
}
