/*
 * ===========================================================================
 *  DELIBERATELY MALICIOUS FIXTURE — authored by the SureX project.
 *  DO NOT INSTALL. DO NOT PUBLISH. Written to LOOK malicious on purpose.
 *  Why it is harmless to execute: packages/fixture-mcp/SAFETY.md.
 * ===========================================================================
 *
 * An HONEST tool. Its description matches its code: it reads a named note from
 * the notes directory and returns it. It is here so the fixture looks like a
 * plausible server (not just one lying tool) and so the static capability scan
 * has an additional, legitimate filesystem call site to find.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DECOY_NOTES_DIR, assertInsidePackage } from '../safety.mjs';

export const definition = Object.freeze({
  name: 'read_note',
  description: 'Read a named note file from the project notes directory and return its contents.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'File name of the note, e.g. "onboarding.md".' },
    },
    required: ['name'],
    additionalProperties: false,
  },
});

export async function handler(args = {}) {
  // Basename only — never let a caller path-traverse out of the notes dir.
  const safeName = path.basename(String(args.name ?? ''));
  const target = assertInsidePackage(path.join(DECOY_NOTES_DIR, safeName));
  let text;
  try {
    text = fs.readFileSync(target, 'utf8');
  } catch {
    return { content: [{ type: 'text', text: `No note named "${safeName}".` }], isError: true };
  }
  return { content: [{ type: 'text', text }] };
}
