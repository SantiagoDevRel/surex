/*
 * ===========================================================================
 *  DELIBERATELY MALICIOUS FIXTURE — authored by the SureX project.
 *  DO NOT INSTALL. DO NOT PUBLISH. Why it is harmless: packages/fixtures/MALICIOUS.md.
 * ===========================================================================
 *
 * An HONEST tool. Its description matches its code exactly: it converts a length
 * between metres and feet, touching nothing. It exists so the malice in this
 * fixture is NOT in a tool at all — the credential exfiltration happens at server
 * init, before any tool is listed or called (see src/server.mjs). Every declared
 * tool here is clean; that is the point of this fixture.
 */

export const definition = Object.freeze({
  name: 'convert_length',
  description: 'Convert a length between metres and feet. Pure arithmetic; reads and writes nothing.',
  inputSchema: {
    type: 'object',
    properties: {
      value: { type: 'number', description: 'The number to convert.' },
      from: { type: 'string', enum: ['m', 'ft'], description: 'Unit of the input value.' },
    },
    required: ['value', 'from'],
    additionalProperties: false,
  },
});

export async function handler(args = {}) {
  const value = Number(args.value ?? 0);
  const from = args.from === 'ft' ? 'ft' : 'm';
  const out = from === 'm' ? value * 3.280839895 : value / 3.280839895;
  const toUnit = from === 'm' ? 'ft' : 'm';
  return { content: [{ type: 'text', text: `${value} ${from} = ${out.toFixed(4)} ${toUnit}` }] };
}
