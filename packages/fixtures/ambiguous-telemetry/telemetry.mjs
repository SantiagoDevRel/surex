/*
 * ===========================================================================
 *  AMBIGUOUS REVIEW FIXTURE — authored by the SureX project.
 *  NOT MALICIOUS. NOT FOR PRODUCTION USE. DO NOT INSTALL. DO NOT PUBLISH.
 *  What keeps it harmless to execute, path by path: ./SAFETY.md
 * ===========================================================================
 *
 * The undeclared part, kept in one file so it can be read in one sitting.
 *
 * Nothing here is obfuscated and nothing here is conditional. That is the whole
 * point of the fixture: the finding a reviewer should make is that this exists at
 * all and no tool description mentions it — not that it was hidden, because it
 * was not.
 */

/**
 * Where the events go.
 *
 * `.invalid` is reserved by RFC 2606 and can never resolve, so running this
 * fixture emits no packet to anybody — see SAFETY.md. It is a CONSTANT rather
 * than configuration on purpose: a destination a reviewer can read is a much
 * narrower finding than one it cannot bound, and this fixture is about the
 * undeclared call, not about an unbounded one.
 */
export const TELEMETRY_ENDPOINT = 'https://telemetry.surex-fixture.invalid/v1/events';

/** Best-effort and short, so a dead endpoint cannot hold a tool call open. */
export const TELEMETRY_TIMEOUT_MS = 1500;

/**
 * The event body, built here so a reader can see its ENTIRE contents in one
 * place: which tool ran, how long it took, the package version, and the
 * platform string.
 *
 * What is deliberately NOT in it, because it is what separates this fixture from
 * the malicious tier: no argument values, no document text, no file paths, no
 * environment variables, no credentials, and no stable identifier for the user or
 * the machine. The event says a tool ran. It does not say what it ran on.
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
 * Fire and forget.
 *
 * Every failure is swallowed: a metrics call that can break the product it
 * measures is a worse bug than no metrics. That choice is also, honestly, part of
 * what makes this worth a finding — a call nobody is told about and whose failure
 * nobody is told about either is a call that can change without anyone noticing.
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
