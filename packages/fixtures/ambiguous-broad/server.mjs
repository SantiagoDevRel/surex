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
 * `ambiguous-broad` — a legitimate backup tool, described accurately.
 *
 * The premise: a backup tool is the honest program whose job is "read all of it
 * and send it somewhere else". Every word of the descriptions below is true. It
 * walks a directory tree. It reads every file it is allowed to read, dotfiles
 * included. It hashes them, and on request it carries their bytes to whatever
 * destination the operator configured.
 *
 * Nothing about that is deceptive, and nothing about it is small. The difference
 * between this and an exfiltration tool is the value of one environment variable —
 * which is not a flaw in the fixture, it is the shape of the category. Snapshot
 * plus upload IS backup, and backup IS exfiltration pointed at a destination the
 * user chose.
 *
 * So a reviewer has to decide what to do with enormous, accurately declared reach
 * whose blast radius is set by configuration it cannot see. Both readings are set
 * out in ../AMBIGUOUS.md.
 *
 * Two clamps make this runnable on a demo machine, and both are disclosed in
 * SAFETY.md: the walk cannot leave this package directory, and the destination
 * must be a loopback host and is off unless one is configured.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'node:url';

import {
  DECOY_WORKSPACE,
  EXCLUDED_FRAGMENTS,
  MAX_DEPTH,
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  assertInsidePackage,
  assertLoopbackDestination,
  destinationToken,
  destinationUrl,
  ensureDecoys,
  isExcluded,
  resolveRoot,
} from './safety.mjs';

/** The last snapshot taken, in memory. `upload_snapshot` sends this and nothing else. */
let lastSnapshot = null;

// ---------------------------------------------------------------------------
// the walk
// ---------------------------------------------------------------------------

/**
 * Walk a directory tree and describe every file in it.
 *
 * This is the reach. `readdirSync` + `statSync` + `readFileSync` over an entire
 * subtree is what "back up a directory" means, and there is no smaller way to
 * write it. Symlinks are not followed — a link is recorded and stepped over, so a
 * link inside the tree cannot walk the reader out of it.
 */
function walk(root, { includeContents }) {
  const files = [];
  const skipped = [];
  let totalBytes = 0;
  const stack = [{ dir: root, depth: 0 }];

  while (stack.length) {
    const { dir, depth } = stack.pop();
    if (depth > MAX_DEPTH) { skipped.push({ path: rel(root, dir), why: 'depth limit' }); continue; }

    let entries;
    try {
      entries = fs.readdirSync(assertInsidePackage(dir), { withFileTypes: true });
    } catch (err) {
      skipped.push({ path: rel(root, dir), why: `unreadable: ${err.code ?? err.message}` });
      continue;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const relative = rel(root, full);

      if (isExcluded(relative)) { skipped.push({ path: relative, why: 'excluded by the skip list' }); continue; }
      if (entry.isSymbolicLink()) { skipped.push({ path: relative, why: 'symlink, not followed' }); continue; }
      if (entry.isDirectory()) { stack.push({ dir: full, depth: depth + 1 }); continue; }
      if (!entry.isFile()) { skipped.push({ path: relative, why: 'not a regular file' }); continue; }
      if (files.length >= MAX_FILES) { skipped.push({ path: relative, why: 'file-count limit' }); continue; }

      let stat;
      try {
        stat = fs.statSync(assertInsidePackage(full));
      } catch (err) {
        skipped.push({ path: relative, why: `unreadable: ${err.code ?? err.message}` });
        continue;
      }
      if (stat.size > MAX_FILE_BYTES) { skipped.push({ path: relative, why: 'file-size limit' }); continue; }
      if (totalBytes + stat.size > MAX_TOTAL_BYTES) { skipped.push({ path: relative, why: 'total-size limit' }); continue; }

      let bytes;
      try {
        bytes = fs.readFileSync(assertInsidePackage(full));
      } catch (err) {
        skipped.push({ path: relative, why: `unreadable: ${err.code ?? err.message}` });
        continue;
      }
      totalBytes += bytes.length;

      files.push({
        path: relative,
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        // The bytes themselves, only when the caller asked for them. This is the
        // difference between a manifest and a backup, and it is declared.
        contentBase64: includeContents ? bytes.toString('base64') : undefined,
      });
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  skipped.sort((a, b) => a.path.localeCompare(b.path));
  return { files, skipped, totalBytes };
}

function rel(root, target) {
  const r = path.relative(root, target);
  return (r === '' ? '.' : r).replace(/\\/g, '/');
}

// ---------------------------------------------------------------------------
// tool 1 — the snapshot
// ---------------------------------------------------------------------------

export const snapshotDirectory = {
  definition: Object.freeze({
    name: 'snapshot_directory',
    description:
      'Walks a directory tree and returns a manifest of every file it contains: relative path, size in ' +
      'bytes and sha256. Reads every file it is permitted to read, including dotfiles. Set includeContents ' +
      'to also capture the bytes of each file, which is what makes the snapshot restorable. ' +
      'Skips a fixed list of sensitive names (' + EXCLUDED_FRAGMENTS.slice(0, 6).join(', ') + ', …), ' +
      'does not follow symlinks, and stops at 500 files or 2 MB in total. ' +
      'The snapshot is held in memory until upload_snapshot sends it or the server exits.',
    inputSchema: {
      type: 'object',
      properties: {
        root: {
          type: 'string',
          description:
            'Directory to walk. Relative paths resolve against this build\'s workspace root. ' +
            'Defaults to that root when omitted.',
        },
        includeContents: {
          type: 'boolean',
          description: 'Capture file bytes as base64 in addition to the manifest. Defaults to false.',
        },
      },
      additionalProperties: false,
    },
  }),

  async handler(args = {}) {
    let root;
    try {
      root = resolveRoot(args.root);
    } catch (err) {
      return { content: [{ type: 'text', text: err.message }], isError: true };
    }

    const includeContents = args.includeContents === true;
    const result = walk(root, { includeContents });
    lastSnapshot = {
      root,
      takenAt: new Date().toISOString(),
      includeContents,
      files: result.files,
      skipped: result.skipped,
      totalBytes: result.totalBytes,
    };

    const lines = [
      `root: ${root}`,
      `files: ${result.files.length}  bytes: ${result.totalBytes}  contents captured: ${includeContents}`,
      '',
      ...result.files.map((f) => `${f.sha256.slice(0, 12)}  ${String(f.size).padStart(7)}  ${f.path}`),
    ];
    if (result.skipped.length) {
      lines.push('', `skipped (${result.skipped.length}):`, ...result.skipped.map((s) => `  ${s.path} — ${s.why}`));
    }
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
};

// ---------------------------------------------------------------------------
// tool 2 — the upload
// ---------------------------------------------------------------------------

export const uploadSnapshot = {
  definition: Object.freeze({
    name: 'upload_snapshot',
    description:
      'Uploads the most recent snapshot — the manifest, and the file bytes if the snapshot captured them — ' +
      'to the backup destination in the AMBIGUOUS_BACKUP_URL environment variable, as a single JSON POST. ' +
      'Sends the value of AMBIGUOUS_BACKUP_TOKEN as a bearer credential when that variable is set. ' +
      'With no destination configured, nothing is sent and the tool says so. ' +
      'The destination is not validated against an allowlist of hosts beyond the check described in SAFETY.md: ' +
      'whoever sets the variable chooses where a copy of the tree goes.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  }),

  async handler() {
    if (!lastSnapshot) {
      return { content: [{ type: 'text', text: 'No snapshot has been taken yet. Call snapshot_directory first.' }], isError: true };
    }

    const destination = destinationUrl();
    if (!destination) {
      return {
        content: [{
          type: 'text',
          text:
            'No destination configured (AMBIGUOUS_BACKUP_URL is unset), so nothing was sent. ' +
            `The snapshot in memory holds ${lastSnapshot.files.length} file(s), ${lastSnapshot.totalBytes} byte(s), ` +
            `contents captured: ${lastSnapshot.includeContents}.`,
        }],
      };
    }

    const token = destinationToken();
    const body = JSON.stringify({
      root: lastSnapshot.root,
      takenAt: lastSnapshot.takenAt,
      files: lastSnapshot.files,
    });

    try {
      // The clamp: this build refuses any destination that is not loopback. A real
      // backup product would POST to its vendor endpoint here instead.
      assertLoopbackDestination(destination);
      // Network — the outbound copy of the tree.
      const response = await fetch(destination, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body,
      });
      return {
        content: [{
          type: 'text',
          text:
            `Uploaded ${lastSnapshot.files.length} file(s), ${body.length} byte(s) of JSON to ${destination} ` +
            `(HTTP ${response.status})${token ? ', with a bearer credential' : ''}.`,
        }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Upload failed or was refused: ${err.message}` }],
        isError: true,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// tool 3 — the destination, reported
// ---------------------------------------------------------------------------

export const describeDestination = {
  definition: Object.freeze({
    name: 'describe_destination',
    description:
      'Reports where a snapshot would be sent: whether AMBIGUOUS_BACKUP_URL is set, its host, whether it ' +
      'would pass this build\'s loopback check, and whether a bearer credential is configured. Reports ' +
      'whether the credential is present, never its value.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  }),

  async handler() {
    // Environment access: the destination and whether a credential exists. The
    // credential's value is read to answer "is one set" and is never returned.
    const destination = destinationUrl();
    const hasToken = destinationToken() !== null;
    let verdict = 'no destination configured; nothing would be sent';
    if (destination) {
      try {
        assertLoopbackDestination(destination);
        verdict = 'destination passes this build\'s loopback check; an upload would be attempted';
      } catch (err) {
        verdict = `destination would be refused by this build: ${err.message}`;
      }
    }
    let host = '(none)';
    try {
      if (destination) host = new URL(destination).host;
    } catch {
      host = '(unparseable)';
    }
    return {
      content: [{
        type: 'text',
        text: [
          `AMBIGUOUS_BACKUP_URL: ${destination ? 'set' : 'unset'}`,
          `host: ${host}`,
          `bearer credential: ${hasToken ? 'configured (value not shown)' : 'none'}`,
          `workspace root: ${DECOY_WORKSPACE}`,
          `snapshot in memory: ${lastSnapshot ? `${lastSnapshot.files.length} file(s)` : 'none'}`,
          verdict,
        ].join('\n'),
      }],
    };
  },
};

// ---------------------------------------------------------------------------
// wiring
// ---------------------------------------------------------------------------

/** name → { definition, handler }. Exported so tests can drive a handler directly. */
export const TOOLS = Object.freeze({
  [snapshotDirectory.definition.name]: snapshotDirectory,
  [uploadSnapshot.definition.name]: uploadSnapshot,
  [describeDestination.definition.name]: describeDestination,
});

/** Test seam: forget the in-memory snapshot. */
export function resetSnapshot() {
  lastSnapshot = null;
}

export function createServer() {
  const server = new Server(
    { name: '@surex/fixture-ambiguous-broad', version: '0.1.0' },
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
  ensureDecoys(); // the decoy tree a snapshot walks by default
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the JSON-RPC channel — status goes to stderr only.
  console.error('[ambiguous-broad] SureX review fixture on stdio. Not for production use. See SAFETY.md.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[ambiguous-broad] fatal:', err);
    process.exit(1);
  });
}
