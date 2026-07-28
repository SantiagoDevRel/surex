// Reading a running pipeline's stdout. The pipeline writes two different things to
// the same stream — progress lines as it goes, one result line at the end — and the
// whole separation rests on one field:
//
//   · the result carries `ok`   — `resultFrom()` scans backwards for it
//   · a progress line does not  — `parseProgressLine()` refuses any line that has it
//
// A progress line mistaken for a result puts a verdict URL in front of a maintainer
// for a review that is still running, so both readers sit here where one test can
// hold them to the rule.
//
// Pure functions: ingest.mjs holds the carry string between chunks, nothing here
// holds state. Node stdlib only, same as the rest of this directory.

/** The discriminator. A line without it is not progress, whatever else it holds. */
export const PROGRESS_KEY = 'surexProgress';

/**
 * A partial line longer than this is not one of ours — a progress line is a few
 * hundred bytes. Unbounded, a child printing megabytes with no newline would grow
 * the carry string until the service ran out of memory.
 */
export const MAX_CARRY_BYTES = 64 * 1024;

/** And a complete line longer than this is not one either. Bounds what ends up on the
 *  job, in the state file, and in the API's answer to the browser. */
export const MAX_PROGRESS_LINE_BYTES = 8 * 1024;

/**
 * Split what has arrived so far into complete lines, and carry the remainder.
 *
 * stdout arrives in arbitrary chunks: a single 200-byte JSON object routinely lands
 * as two `data` events, so parsing per chunk drops progress silently and at random.
 * Only the text before the last newline is returned as lines; everything after it is
 * carried into the next call. `\r\n` is trimmed to `\n`.
 *
 * @param {string} carry what was left over from the previous chunk
 * @param {string|Buffer} chunk whatever just arrived
 * @returns {{lines: string[], carry: string}}
 */
export function drainLines(carry, chunk, { maxCarry = MAX_CARRY_BYTES } = {}) {
  const buffered = `${carry ?? ''}${chunk ?? ''}`;
  const parts = buffered.split('\n');
  // `split` always leaves the trailing fragment last — '' when the chunk ended on
  // a newline, which is the common case and carries nothing.
  let rest = parts.pop() ?? '';
  const lines = parts.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  if (rest.length > maxCarry) {
    // Dropped rather than truncated: a truncated fragment could still parse into
    // something half-true, where the orphaned tail is simply rejected as a line.
    rest = '';
  }
  return { lines, carry: rest };
}

/**
 * One progress line, or null — for log noise, a bare `}`, half an object, an array,
 * or a line that parses but carries no stage. Never a throw: one malformed line must
 * not take down the queue other jobs are waiting in.
 *
 * The `ok` refusal is defence in depth, not the defence: `resultFrom` reads the raw
 * stdout, so a progress line carrying `ok` is still a candidate result there. The
 * invariant is only enforceable at the emitter, in scripts/ingest-submission.mjs.
 *
 * @returns {{stage:string,label:string|null,done:number|undefined,total:number|undefined,detail:object}|null}
 */
export function parseProgressLine(line, { maxBytes = MAX_PROGRESS_LINE_BYTES } = {}) {
  const text = String(line ?? '').trim();
  if (!text.startsWith('{')) return null;
  if (text.length > maxBytes) return null;

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null; // not a progress line; it may not be a line of ours at all
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (parsed[PROGRESS_KEY] !== 1) return null;
  if ('ok' in parsed) return null;

  const stage = typeof parsed.stage === 'string' ? parsed.stage.trim() : '';
  if (!stage) return null; // a progress line with no stage says nothing

  // Narrowed to the agreed fields, so what reaches the browser has a known shape
  // rather than whatever the child happened to print.
  const out = { stage, label: typeof parsed.label === 'string' ? parsed.label : null };
  if (Number.isFinite(parsed.done)) out.done = Number(parsed.done);
  if (Number.isFinite(parsed.total)) out.total = Number(parsed.total);
  out.detail =
    parsed.detail && typeof parsed.detail === 'object' && !Array.isArray(parsed.detail) ? parsed.detail : {};
  return out;
}

/**
 * The last line of stdout that parses as a JSON object with an `ok` field.
 * Scanned from the end so a pipeline that prints progress before its result still
 * reports correctly, and `null` when there is nothing — never a fabricated success.
 */
export function resultFrom(stdout) {
  const lines = String(stdout).split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && 'ok' in parsed) return parsed;
    } catch {
      /* not the result line */
    }
  }
  return null;
}
