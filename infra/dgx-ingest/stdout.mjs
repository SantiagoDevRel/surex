// Reading a running pipeline's stdout.
//
// The pipeline writes two different things to the SAME stream: progress lines as
// it goes, and exactly one result line at the end. Everything in this file exists
// to keep those two apart, and the whole separation rests on one field:
//
//   · the RESULT carries `ok`   — `resultFrom()` scans backwards for it
//   · a PROGRESS line does NOT  — `parseProgressLine()` refuses any line that has it
//
// Get that wrong in either direction and the failure is not cosmetic: a progress
// line mistaken for a result would put a verdict URL in front of a maintainer for
// a review that was still running. So the rule is enforced on both sides here,
// where the two readers sit next to each other and one test can hold them to it.
//
// These are pure functions on purpose. They compute — which lines are complete,
// which of them are progress — and this repo has already been bitten once by a
// guard whose test passed with the logic disabled. ingest.mjs holds the carry
// string between chunks; nothing here holds state.
//
// Node stdlib only, same as the rest of this directory.

/** The discriminator. A line without it is not progress, whatever else it holds. */
export const PROGRESS_KEY = 'surexProgress';

/**
 * A partial line longer than this is not one of ours — a progress line is a few
 * hundred bytes. Without a bound, a child that prints megabytes with no newline
 * would grow the carry string until the service ran out of memory.
 */
export const MAX_CARRY_BYTES = 64 * 1024;

/**
 * And a COMPLETE line longer than this is not one either. This bounds what ends
 * up on the job, in the state file, and in the API's answer to the browser.
 */
export const MAX_PROGRESS_LINE_BYTES = 8 * 1024;

/**
 * Split what has arrived so far into complete lines, and carry the remainder.
 *
 * stdout arrives in ARBITRARY chunks. A single 200-byte JSON object routinely
 * lands as two `data` events — the split has nothing to do with line endings —
 * and `JSON.parse` on half an object throws. Parsing per chunk therefore drops
 * progress silently and at random, which is the worst possible way for this to
 * fail: the pipeline looks stalled at whichever stage happened to be whole.
 *
 * So only the text before the LAST newline is returned as lines; everything after
 * it is carried into the next call. `\r\n` is trimmed to `\n` so a line written on
 * a Windows-ish stream parses the same as any other.
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
    // Dropped rather than truncated. The orphaned tail arrives as a line that
    // parseProgressLine rejects, so the effect is that the oversized line is
    // ignored — which is what we want — and nothing downstream sees a fragment
    // of JSON that could parse into something half-true.
    rest = '';
  }
  return { lines, carry: rest };
}

/**
 * One progress line, or null.
 *
 * Null for anything that is not one: log noise, a bare `}`, half an object, an
 * array, a line that parses but carries no stage. Never a throw — this runs on
 * every line of a third-party-ish child's stdout and one malformed line must not
 * take down the queue that other jobs are waiting in.
 *
 * The `ok` refusal keeps a line that broke the rule out of the job's progress. Be
 * precise about what it does NOT do: `resultFrom` reads the raw stdout, so a
 * progress line that carried `ok` would still be a candidate result there and this
 * cannot save it. The invariant is only enforceable at the EMITTER — see the
 * progress section of scripts/ingest-submission.mjs, and the test that walks every
 * stage and fails on an `ok` in any of them. This half is defence in depth, not the
 * defence.
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

  // Narrowed to the agreed fields, so what reaches the browser has a shape the
  // reader can rely on rather than whatever the child happened to print.
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
