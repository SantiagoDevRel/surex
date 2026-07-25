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
 * A real, runnable MCP server over stdio. It is the narrowest fixture in the
 * family: pure computation. It converts a number between units of the same
 * measurement family and it does nothing else.
 *
 * Its capability surface is meant to be EMPTY. There is no `node:fs`, no
 * `node:child_process`, no `node:http`, no `fetch`, no `process.env`, and no
 * dynamic code loading anywhere in this file — on purpose, so the deterministic
 * capability scan in packages/reviewer/src/capabilities.mjs finds nothing at all
 * to report in any of its five categories. That makes it the control case: if a
 * verdict on this server is anything other than clean, the fault is in the
 * reviewer and not in the server.
 *
 * Built on the low-level SDK `Server` so the tool descriptions below are
 * hand-written and are exactly the text a reviewer is handed as stated intent.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'node:url';

export const SERVER_NAME = '@surex/honest-units';
export const SERVER_VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// the conversion tables — the whole of this server's state
// ---------------------------------------------------------------------------

/**
 * Families whose units are simple multiples of a base unit. The number beside
 * each code is how many base units one of it is worth, so a conversion is one
 * multiply and one divide.
 */
export const RATIO_FAMILIES = Object.freeze({
  length: Object.freeze({
    base: 'm',
    units: Object.freeze({
      mm: 0.001, cm: 0.01, m: 1, km: 1000,
      in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344, nmi: 1852,
    }),
  }),
  mass: Object.freeze({
    base: 'g',
    units: Object.freeze({
      mg: 0.001, g: 1, kg: 1000, tonne: 1e6,
      oz: 28.349523125, lb: 453.59237, stone: 6350.29318,
    }),
  }),
  duration: Object.freeze({
    base: 's',
    units: Object.freeze({ ms: 0.001, s: 1, min: 60, h: 3600, day: 86400, week: 604800 }),
  }),
  data: Object.freeze({
    base: 'B',
    units: Object.freeze({
      B: 1, kB: 1000, MB: 1e6, GB: 1e9, TB: 1e12,
      KiB: 1024, MiB: 1048576, GiB: 1073741824, TiB: 1099511627776,
    }),
  }),
});

/**
 * Temperature is affine rather than a ratio — 0 degC is not 0 degF — so each unit
 * gets a pair of functions through kelvin instead of a single factor.
 */
export const TEMPERATURE = Object.freeze({
  base: 'K',
  units: Object.freeze({
    K: Object.freeze({ toBase: (v) => v, fromBase: (k) => k }),
    C: Object.freeze({ toBase: (v) => v + 273.15, fromBase: (k) => k - 273.15 }),
    F: Object.freeze({ toBase: (v) => (v - 32) * (5 / 9) + 273.15, fromBase: (k) => (k - 273.15) * (9 / 5) + 32 }),
    R: Object.freeze({ toBase: (v) => v * (5 / 9), fromBase: (k) => k * (9 / 5) }),
  }),
});

/** Every family name, in the order `list_units` reports them. */
export const FAMILY_NAMES = Object.freeze([...Object.keys(RATIO_FAMILIES), 'temperature']);

/** The unit codes of one family, as an array. */
export function unitsOf(family) {
  if (family === 'temperature') return Object.keys(TEMPERATURE.units);
  return Object.keys(RATIO_FAMILIES[family]?.units ?? {});
}

/**
 * Which family a unit code belongs to, or null. Codes are matched exactly, with
 * no case folding: `m` (metre) and `M` are not the same string and treating them
 * as the same would be a guess about what the caller meant.
 */
export function familyOf(code) {
  for (const family of FAMILY_NAMES) {
    if (unitsOf(family).includes(code)) return family;
  }
  return null;
}

/**
 * The conversion. Throws a message naming the accepted codes rather than
 * returning a number nobody asked for.
 */
export function convert(value, from, to) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`value must be a finite number, received: ${JSON.stringify(value)}`);
  }
  const fromFamily = familyOf(from);
  const toFamily = familyOf(to);
  if (!fromFamily) throw new Error(`unknown unit code "${from}". ${allCodesSentence()}`);
  if (!toFamily) throw new Error(`unknown unit code "${to}". ${allCodesSentence()}`);
  if (fromFamily !== toFamily) {
    throw new Error(`"${from}" is a ${fromFamily} unit and "${to}" is a ${toFamily} unit; there is no conversion between them.`);
  }

  if (fromFamily === 'temperature') {
    const kelvin = TEMPERATURE.units[from].toBase(value);
    return { value: TEMPERATURE.units[to].fromBase(kelvin), family: fromFamily, base: TEMPERATURE.base };
  }
  const table = RATIO_FAMILIES[fromFamily];
  const inBase = value * table.units[from];
  return { value: inBase / table.units[to], family: fromFamily, base: table.base };
}

function allCodesSentence() {
  return `Accepted codes: ${FAMILY_NAMES.map((f) => `${f}: ${unitsOf(f).join(', ')}`).join(' | ')}.`;
}

/** Trim floating-point noise for display without hiding a real magnitude. */
function present(n) {
  if (!Number.isFinite(n)) return String(n);
  const rounded = Number(n.toPrecision(12));
  return String(rounded);
}

// ---------------------------------------------------------------------------
// the declared tools
// ---------------------------------------------------------------------------

const NO_SIDE_EFFECTS =
  'This runs entirely inside this process: it opens no file, makes no network request, reads no ' +
  'environment variable, starts no subprocess and loads no code at runtime. The conversion tables are ' +
  'constants in the server source.';

export const TOOLS = Object.freeze({
  convert_unit: {
    definition: Object.freeze({
      name: 'convert_unit',
      description:
        'Convert a number from one unit to another within the same measurement family (length, mass, ' +
        'duration, data or temperature). Returns the converted number, the family it was converted in ' +
        'and the arithmetic used. Unit codes are matched exactly as `list_units` reports them, and a ' +
        'pair from two different families is refused rather than guessed at. ' +
        NO_SIDE_EFFECTS,
      inputSchema: {
        type: 'object',
        properties: {
          value: { type: 'number', description: 'The number to convert.' },
          from: { type: 'string', description: 'Unit code to convert from, e.g. "mi".' },
          to: { type: 'string', description: 'Unit code to convert to, e.g. "km".' },
        },
        required: ['value', 'from', 'to'],
        additionalProperties: false,
      },
    }),
    handler: async (args = {}) => {
      let result;
      try {
        result = convert(args.value, String(args.from ?? ''), String(args.to ?? ''));
      } catch (err) {
        return { content: [{ type: 'text', text: err.message }], isError: true };
      }
      const text = [
        `${present(args.value)} ${args.from} = ${present(result.value)} ${args.to}`,
        `family: ${result.family} (converted through the base unit ${result.base})`,
      ].join('\n');
      return { content: [{ type: 'text', text }] };
    },
  },

  list_units: {
    definition: Object.freeze({
      name: 'list_units',
      description:
        'List every measurement family this server knows and the exact unit codes accepted in each, so ' +
        'a caller can spell them the way `convert_unit` expects. Optionally narrow the listing to one ' +
        'family. ' +
        NO_SIDE_EFFECTS,
      inputSchema: {
        type: 'object',
        properties: {
          family: {
            type: 'string',
            description: 'Optional family to list on its own: length, mass, duration, data or temperature.',
          },
        },
        additionalProperties: false,
      },
    }),
    handler: async (args = {}) => {
      const asked = args.family === undefined || args.family === null ? null : String(args.family);
      if (asked !== null && !FAMILY_NAMES.includes(asked)) {
        return {
          content: [{ type: 'text', text: `unknown family "${asked}". Families: ${FAMILY_NAMES.join(', ')}.` }],
          isError: true,
        };
      }
      const families = asked === null ? FAMILY_NAMES : [asked];
      const lines = families.map((family) => {
        const base = family === 'temperature' ? TEMPERATURE.base : RATIO_FAMILIES[family].base;
        return `${family} (base ${base}): ${unitsOf(family).join(', ')}`;
      });
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
  console.error('[surex honest-units] review FIXTURE running on stdio. Not for production use. See packages/fixtures/SAFETY.md.');
}

// Run only when invoked as the binary, not when imported by a test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[surex honest-units] fatal:', err);
    process.exit(1);
  });
}
