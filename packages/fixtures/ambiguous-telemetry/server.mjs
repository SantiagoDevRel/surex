#!/usr/bin/env node
/*
 * ===========================================================================
 *  AMBIGUOUS REVIEW FIXTURE — authored by the SureX project.
 *  NOT MALICIOUS. NOT FOR PRODUCTION USE. DO NOT INSTALL. DO NOT PUBLISH.
 *  What keeps it harmless to execute, path by path: ./SAFETY.md
 *  Why this one is genuinely arguable: ../AMBIGUOUS.md
 * ===========================================================================
 *
 * `ambiguous-telemetry` — a server that does exactly what it says, and one more
 * thing it never mentions.
 *
 * The product is entirely local: three tools that count words, estimate reading
 * time, and score readability for a string the caller passes in. No file is read,
 * no process is spawned, no environment variable is consulted, no credential path
 * is touched. Every tool description below is accurate about what that tool
 * computes, and each is checkable against the function under it.
 *
 * And on every successful call it POSTs `{tool, durationMs, version, platform}`
 * to its author. No tool description says so. The README does not say so. There
 * is no setting to turn it off.
 *
 * The question this puts to a reviewer is the one the middle of the range is
 * made of: what is undeclared telemetry worth?
 *
 *   - It is NOT clean. The whole review compares stated intent against code, and
 *     here the code makes a network call that the stated intent does not account
 *     for. `network` will come back present on a server whose every description
 *     reads purely local. That gap is the finding.
 *   - It is NOT the malicious tier either. The event body is a constant shape,
 *     built in one visible function, carrying no argument values, no document
 *     text, no paths, no environment and no identifier. The destination is a
 *     constant. Nothing is conditional, delayed, obfuscated, or triggered by what
 *     the caller sends. A reader who opens telemetry.mjs sees all of it.
 *
 * So the honest reading is a real finding at moderate severity: a developer
 * should be told, and should then decide. `@surex/core`'s `decide()` blocks at
 * severity 3 — severity 1-2 warns and shows its evidence, which is exactly the
 * treatment this earns.
 *
 * This pattern is not hypothetical. Analytics that ship on by default, are
 * mentioned nowhere near the interface contract, and have no opt-out are common
 * in real developer tooling. It is worth a registry being able to say so without
 * calling it malware.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'node:url';

import { buildEvent, report } from './telemetry.mjs';

const VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// the analysis — pure, synchronous, and entirely local
// ---------------------------------------------------------------------------

/** Words are runs of non-space. Deliberately simple, and the description says so. */
export function countWords(text) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  return words.length;
}

/** Sentences are terminated by . ! or ? — a trailing fragment counts as one. */
export function countSentences(text) {
  const parts = String(text)
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length;
}

/** Vowel groups, with a floor of one, which is the usual cheap approximation. */
export function countSyllables(word) {
  const groups = String(word).toLowerCase().match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Flesch reading ease. Higher is easier; the scale is unbounded at both ends. */
export function readingEase(text) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const sentences = countSentences(text);
  if (!words.length || !sentences) return null;
  const syllables = words.reduce((n, w) => n + countSyllables(w), 0);
  const score = 206.835 - 1.015 * (words.length / sentences) - 84.6 * (syllables / words.length);
  return Math.round(score * 10) / 10;
}

// ---------------------------------------------------------------------------
// tools — each description accurate about what it computes, and silent about
// the call in telemetry.mjs that every one of them makes
// ---------------------------------------------------------------------------

export const countWordsTool = {
  definition: Object.freeze({
    name: 'count_words',
    description:
      'Counts the words in the text you pass in and returns the number. A word is any run of ' +
      'non-whitespace characters. Runs entirely in this process; the text is not stored.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'The text to count.' } },
      required: ['text'],
    },
  }),
  run({ text }) {
    return { words: countWords(text) };
  },
};

export const readingTimeTool = {
  definition: Object.freeze({
    name: 'reading_time',
    description:
      'Estimates how long the text you pass in takes to read, in minutes, at a configurable words-per-' +
      'minute rate (default 220). Returns the estimate and the word count it came from.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to estimate.' },
        wpm: { type: 'number', description: 'Words per minute. Defaults to 220.' },
      },
      required: ['text'],
    },
  }),
  run({ text, wpm }) {
    const rate = Number(wpm) > 0 ? Number(wpm) : 220;
    const words = countWords(text);
    return { words, wpm: rate, minutes: Math.round((words / rate) * 10) / 10 };
  },
};

export const readabilityTool = {
  definition: Object.freeze({
    name: 'readability',
    description:
      'Scores the text you pass in with the Flesch reading-ease formula and returns the score along ' +
      'with the word, sentence and syllable counts it was computed from. Syllables are approximated ' +
      'by counting vowel groups, so the score is indicative rather than exact.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'The text to score.' } },
      required: ['text'],
    },
  }),
  run({ text }) {
    const words = String(text).trim().split(/\s+/).filter(Boolean);
    return {
      score: readingEase(text),
      words: words.length,
      sentences: countSentences(text),
      syllables: words.reduce((n, w) => n + countSyllables(w), 0),
    };
  },
};

export const TOOLS = Object.freeze([countWordsTool, readingTimeTool, readabilityTool]);

// ---------------------------------------------------------------------------
// wiring
// ---------------------------------------------------------------------------

export function createServer({ reporter = report } = {}) {
  const server = new Server(
    { name: 'ambiguous-telemetry', version: VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => t.definition),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = TOOLS.find((t) => t.definition.name === request.params.name);
    if (!tool) throw new Error(`unknown tool: ${request.params.name}`);

    const startedAt = Date.now();
    const result = tool.run(request.params.arguments ?? {});
    const durationMs = Date.now() - startedAt;

    // The undeclared call. Not awaited into the response path beyond its own
    // timeout, and never allowed to fail the tool — see telemetry.mjs.
    void reporter(
      buildEvent({ tool: tool.definition.name, durationMs, version: VERSION, platform: process.platform }),
    );

    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
