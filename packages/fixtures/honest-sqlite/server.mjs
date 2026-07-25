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
 * A real, runnable MCP server over stdio. It reads ONE SQLite file — the exact
 * path is `fixture-home/library.db`, beside this source file — and it is read-only
 * in the strong sense: every tool opens the database with `readOnly: true`, which
 * makes SQLite itself reject a write ("attempt to write a readonly database"), and
 * the only statements in this file are SELECTs.
 *
 * There is one write in the whole server, and it is not in a tool: on startup, if
 * `fixture-home/library.db` is missing, the server creates it and inserts the
 * sample rows. That is stated in the tool descriptions rather than left for a
 * reader to discover.
 *
 * Note for anyone comparing this against the capability scan: the SQLite reads
 * themselves are invisible to that scan, because `node:sqlite` is not one of the
 * module specifiers it matches. Filesystem still shows as present, and honestly
 * so, via the `node:fs` calls that check for and create the database file. That
 * blind spot is written down in packages/fixtures/README.md instead of being left
 * to make the surface look smaller than it is.
 *
 * `node:sqlite` prints an ExperimentalWarning on import. It goes to stderr, which
 * is not the JSON-RPC channel, so it does not corrupt the protocol.
 *
 * The path guard mirrors `assertInsidePackage` in packages/fixture-mcp/src/safety.mjs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export const SERVER_NAME = '@surex/honest-sqlite';
export const SERVER_VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// the sandbox
// ---------------------------------------------------------------------------

/** The directory holding this file — the outer boundary nothing here may cross. */
export const PACKAGE_ROOT = path.dirname(fileURLToPath(import.meta.url));

/** Everything this server touches on disk lives under here. Gitignored. */
export const FIXTURE_HOME = path.join(PACKAGE_ROOT, 'fixture-home');

/** The one database file. Named in every tool description. */
export const DB_PATH = path.join(FIXTURE_HOME, 'library.db');

/** Where the seed is assembled, so an interrupted seed cannot leave a half database. */
const DB_PARTIAL_PATH = path.join(FIXTURE_HOME, 'library.db.partial');

/** The largest number of rows `query_rows` will return, whatever it is asked for. */
export const MAX_ROWS = 100;

/**
 * Guard: throw unless `p` resolves inside PACKAGE_ROOT. Every path this server
 * opens — with `node:fs` or with `node:sqlite` — passes through here first.
 */
export function assertInsidePackage(p) {
  const resolved = path.resolve(p);
  const root = PACKAGE_ROOT.endsWith(path.sep) ? PACKAGE_ROOT : PACKAGE_ROOT + path.sep;
  if (resolved !== PACKAGE_ROOT && !resolved.startsWith(root)) {
    throw new Error(`fixture safety: refused a path outside the package: ${resolved}`);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// the seed — the only write in this server, and it runs at startup
// ---------------------------------------------------------------------------

const SCHEMA = [
  'CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL, year INTEGER)',
  'CREATE TABLE loans (id INTEGER PRIMARY KEY, book_id INTEGER NOT NULL, borrower TEXT NOT NULL, due_on TEXT NOT NULL)',
];

const BOOK_ROWS = Object.freeze([
  [1, 'The Design of Everyday Things', 'Donald Norman', 1988],
  [2, 'Thinking in Systems', 'Donella Meadows', 2008],
  [3, 'A Pattern Language', 'Christopher Alexander', 1977],
  [4, 'Seeing Like a State', 'James C. Scott', 1998],
]);

const LOAN_ROWS = Object.freeze([
  [1, 1, 'ana', '2026-08-01'],
  [2, 3, 'bruno', '2026-08-14'],
]);

/**
 * Create `fixture-home/library.db` with the sample rows if it is missing.
 * Idempotent. The database is built at a `.partial` path and renamed into place,
 * so a run that is killed mid-seed does not leave a file that later looks seeded.
 */
export function ensureDatabase() {
  fs.mkdirSync(assertInsidePackage(FIXTURE_HOME), { recursive: true });
  if (fs.existsSync(assertInsidePackage(DB_PATH))) return;

  const partial = assertInsidePackage(DB_PARTIAL_PATH);
  if (fs.existsSync(partial)) fs.rmSync(partial);

  const db = new DatabaseSync(partial); // read-write, and the only such open in this file
  try {
    for (const statement of SCHEMA) db.exec(statement);
    const insertBook = db.prepare('INSERT INTO books (id, title, author, year) VALUES (?, ?, ?, ?)');
    for (const row of BOOK_ROWS) insertBook.run(...row);
    const insertLoan = db.prepare('INSERT INTO loans (id, book_id, borrower, due_on) VALUES (?, ?, ?, ?)');
    for (const row of LOAN_ROWS) insertLoan.run(...row);
  } finally {
    db.close();
  }
  fs.renameSync(partial, assertInsidePackage(DB_PATH));
}

// ---------------------------------------------------------------------------
// reading
// ---------------------------------------------------------------------------

/**
 * Open the database read-only, run `fn`, and always close. `readOnly: true` is
 * what makes the read-only claim enforced by SQLite rather than by convention: a
 * write attempted through this handle fails inside the engine.
 */
function withReadOnlyDb(fn) {
  const db = new DatabaseSync(assertInsidePackage(DB_PATH), { readOnly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/** The tables the database actually contains, in name order. */
export function tableNames(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => String(row.name));
}

/**
 * A table name is only ever used after it is found in the list above — a
 * membership check against what the file really holds, not a pattern match on
 * caller text. The shape check is a second line of defence for the one place a
 * name has to be spliced into SQL, because a table identifier cannot be a bound
 * parameter in SQLite.
 */
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function assertKnownTable(db, name) {
  const known = tableNames(db);
  if (!known.includes(name)) {
    throw new Error(`no table named "${name}" in this database. Tables: ${known.join(', ')}.`);
  }
  if (!SAFE_IDENTIFIER.test(name)) {
    throw new Error(`refused a table name that is not a plain identifier: ${name}`);
  }
  return name;
}

/** Render a value for text output without letting a BigInt throw on the way out. */
function cell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return `<${value.length} bytes>`;
  return String(value);
}

// ---------------------------------------------------------------------------
// the declared tools
// ---------------------------------------------------------------------------

const DB_SENTENCE =
  'The database is one file, `fixture-home/library.db`, resolved relative to the directory holding this ' +
  'server\'s source, and the path is checked to resolve inside that directory before it is opened. It is ' +
  'opened with SQLite\'s readOnly flag, so a write through that handle is rejected by SQLite itself, and ' +
  'the only statements in this server are SELECTs — there is no tool that runs caller-supplied SQL. The ' +
  'one write anywhere in the server happens at startup, not in a tool: if that file is missing, the ' +
  'server creates it and inserts four rows of sample books and two sample loans. It reads no other file, ' +
  'makes no network request, reads no environment variable, starts no subprocess and loads no code at ' +
  'runtime.';

export const TOOLS = Object.freeze({
  list_tables: {
    definition: Object.freeze({
      name: 'list_tables',
      description:
        'List the tables in the sample database, with the number of rows in each. Internal SQLite tables ' +
        'are left out. ' +
        DB_SENTENCE,
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    }),
    handler: async () => {
      try {
        const lines = withReadOnlyDb((db) =>
          tableNames(db).map((name) => {
            assertKnownTable(db, name);
            const row = db.prepare(`SELECT count(*) AS n FROM "${name}"`).get();
            return `${name}\t${cell(row?.n)} rows`;
          }),
        );
        const text = lines.length ? lines.join('\n') : 'The database contains no tables.';
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Could not read the database: ${err.message}` }], isError: true };
      }
    },
  },

  describe_table: {
    definition: Object.freeze({
      name: 'describe_table',
      description:
        'Return the CREATE TABLE statement recorded in the database for one table, which is its column ' +
        'list and constraints as SQLite stored them. The table name is read back from the database\'s own ' +
        'catalogue with a bound parameter, so the name never becomes part of the statement text. ' +
        DB_SENTENCE,
      inputSchema: {
        type: 'object',
        properties: {
          table: { type: 'string', description: 'Table name, e.g. "books". Use list_tables to see them.' },
        },
        required: ['table'],
        additionalProperties: false,
      },
    }),
    handler: async (args = {}) => {
      const name = String(args.table ?? '');
      try {
        const sql = withReadOnlyDb((db) => {
          assertKnownTable(db, name);
          const row = db
            .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
            .get(name);
          return row?.sql ?? null;
        });
        if (!sql) {
          return { content: [{ type: 'text', text: `No stored definition for "${name}".` }], isError: true };
        }
        return { content: [{ type: 'text', text: String(sql) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: err.message }], isError: true };
      }
    },
  },

  query_rows: {
    definition: Object.freeze({
      name: 'query_rows',
      description:
        `Return rows from one table of the sample database, at most ${MAX_ROWS} of them, as a header line ` +
        'and tab-separated values. The only inputs are a table name and a row limit: the name must match a ' +
        'table the database actually contains before it is used, and the limit is a bound parameter ' +
        `clamped to 1-${MAX_ROWS}. There is no way to pass SQL through this tool. ` +
        DB_SENTENCE,
      inputSchema: {
        type: 'object',
        properties: {
          table: { type: 'string', description: 'Table name, e.g. "books".' },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: MAX_ROWS,
            description: `How many rows to return, 1-${MAX_ROWS}. Defaults to 20.`,
          },
        },
        required: ['table'],
        additionalProperties: false,
      },
    }),
    handler: async (args = {}) => {
      const name = String(args.table ?? '');
      const asked = Number(args.limit ?? 20);
      const limit = Number.isFinite(asked) ? Math.min(Math.max(Math.trunc(asked), 1), MAX_ROWS) : 20;

      try {
        const rows = withReadOnlyDb((db) => {
          assertKnownTable(db, name);
          return db.prepare(`SELECT * FROM "${name}" LIMIT ?`).all(limit);
        });
        if (!rows.length) {
          return { content: [{ type: 'text', text: `"${name}" has no rows.` }] };
        }
        const columns = Object.keys(rows[0]);
        const lines = [columns.join('\t'), ...rows.map((row) => columns.map((c) => cell(row[c])).join('\t'))];
        lines.push('', `${rows.length} row(s), limit ${limit}, table "${name}", read-only.`);
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (err) {
        return { content: [{ type: 'text', text: err.message }], isError: true };
      }
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
  ensureDatabase(); // create the sample database if it is missing — the only write
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the JSON-RPC channel — anything human-readable goes to stderr only.
  console.error(
    `[surex honest-sqlite] review FIXTURE running on stdio, read-only over ${DB_PATH}. ` +
      'Not for production use. See packages/fixtures/SAFETY.md.',
  );
}

// Run only when invoked as the binary, not when imported by a test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[surex honest-sqlite] fatal:', err);
    process.exit(1);
  });
}
