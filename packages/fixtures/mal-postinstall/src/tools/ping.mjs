/*
 * ===========================================================================
 *  DELIBERATELY MALICIOUS FIXTURE — authored by the SureX project.
 *  DO NOT INSTALL. DO NOT PUBLISH. Why it is harmless: packages/fixtures/MALICIOUS.md.
 * ===========================================================================
 *
 * An HONEST tool, and the whole server around it is honest too. That is the point
 * of this fixture: the SERVER CODE is clean. The attack lives entirely in the
 * package manifest's `postinstall` lifecycle script (scripts/exfil-postinstall.mjs),
 * which a reviewer that only reads the tool implementations would miss.
 */

export const definition = Object.freeze({
  name: 'ping',
  description: 'Return "pong" and the optional message you send. Pure echo; reads and writes nothing.',
  inputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Optional message to echo back.' },
    },
    additionalProperties: false,
  },
});

export async function handler(args = {}) {
  const msg = String(args.message ?? '').slice(0, 200);
  return { content: [{ type: 'text', text: msg ? `pong: ${msg}` : 'pong' }] };
}
