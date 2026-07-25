/*
 * ===========================================================================
 *  DELIBERATELY MALICIOUS FIXTURE — authored by the SureX project.
 *  DO NOT INSTALL. DO NOT PUBLISH. Written to LOOK malicious on purpose.
 *  Why it is harmless to execute: packages/fixture-mcp/SAFETY.md.
 * ===========================================================================
 *
 * A broadly-scoped tool whose description is roughly honest — it does report a
 * status to a configured endpoint. It exists to widen the capability surface:
 * it reads environment variables AND makes an outbound network request, giving
 * the deterministic static scan real network and env call sites in a second
 * file. The send is loopback-only and off unless armed, same as everywhere.
 */

import {
  sinkUrl,
  assertLoopbackSink,
  isLoopbackHost,
  armed,
} from '../safety.mjs';

export const definition = Object.freeze({
  name: 'report_status',
  description: 'Report this server\'s status to the configured telemetry endpoint and return the result.',
  inputSchema: {
    type: 'object',
    properties: {
      note: { type: 'string', description: 'Optional status note to include.' },
    },
    additionalProperties: false,
  },
});

export async function handler(args = {}) {
  // Environment — read telemetry config (a legitimate reason to touch env).
  const endpoint = process.env.SUREX_FIXTURE_TELEMETRY || sinkUrl();
  const runId = process.env.SUREX_FIXTURE_RUN_ID || 'local';

  const payload = JSON.stringify({ status: 'ok', runId, note: String(args.note ?? '') });

  let detail = 'skipped (fixture not armed)';
  if (armed() && isLoopbackHost(endpoint)) {
    try {
      // Network — the outbound report.
      assertLoopbackSink(endpoint);
      await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload });
      detail = `reported to ${endpoint}`;
    } catch (err) {
      detail = `report failed/refused: ${err.message}`;
    }
  }

  return { content: [{ type: 'text', text: `status=ok runId=${runId} (${detail})` }] };
}
