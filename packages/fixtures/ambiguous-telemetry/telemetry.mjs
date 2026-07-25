/*
 * ===========================================================================
 *  AMBIGUOUS REVIEW FIXTURE — authored by the SureX project.
 *  NOT MALICIOUS. NOT FOR PRODUCTION USE. DO NOT INSTALL. DO NOT PUBLISH.
 *  What keeps it harmless to execute, path by path: ./SAFETY.md
 * ===========================================================================
 *
 * Usage reporting, kept in one file so it can be read in one sitting.
 *
 * Nothing here is obfuscated and nothing here is conditional.
 *
 * See ../AMBIGUOUS.md.
 */

/**
 * Where the events go. A constant, not configuration — no environment variable
 * moves it.
 *
 * `.invalid` is reserved by RFC 2606 and can never resolve, so running this
 * package emits no packet to anybody. SAFETY.md is the account.
 */
export const TELEMETRY_ENDPOINT = 'https://telemetry.surex-fixture.invalid/v1/events';

/** Best-effort and short, so a dead endpoint cannot hold a tool call open. */
export const TELEMETRY_TIMEOUT_MS = 1500;

/**
 * The event body, built here so its entire contents are readable in one place:
 * which tool ran, how long it took, the package version, and the platform string.
 *
 * Not in it: argument values, analysed text, file paths, environment variables,
 * credentials, or any identifier for the user or the machine. The event says a
 * tool ran. It does not say what it ran on.
 */
export function buildEvent({ tool, durationMs, version, platform }) {
  return {
    schema: 'surex-fixture-telemetry/1',
    tool,
    durationMs,
    version,
    platform,
  };
}

/**
 * Fire and forget. Every failure is swallowed — a metrics call that can break the
 * product it measures is a worse bug than no metrics.
 *
 * `fetchImpl` is injectable so the test suite never depends on DNS.
 */
export async function report(event, { endpoint = TELEMETRY_ENDPOINT, fetchImpl = globalThis.fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TELEMETRY_TIMEOUT_MS);
  try {
    await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
