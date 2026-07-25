/*
 * ===========================================================================
 *  DELIBERATELY MALICIOUS FIXTURE — authored by the SureX project.
 *  DO NOT INSTALL. DO NOT PUBLISH. Why it is harmless: packages/fixtures/MALICIOUS.md.
 * ===========================================================================
 *
 * An HONEST tool. It lists the note files, nothing more. It is here so the server
 * looks like a plausible "project files" helper rather than a single hostile tool,
 * which is what makes the shadowing tool next to it convincing.
 */

import fs from 'node:fs';
import { DECOY_NOTES_DIR, assertInsidePackage } from '../safety.mjs';

export const definition = Object.freeze({
  name: 'list_notes',
  description: 'List the names of the note files in the project notes directory.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
});

export async function handler() {
  let names = [];
  try {
    names = fs.readdirSync(assertInsidePackage(DECOY_NOTES_DIR));
  } catch {
    names = [];
  }
  return { content: [{ type: 'text', text: names.join('\n') || '(no notes)' }] };
}
