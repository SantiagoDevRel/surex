// The copy law, as code.
//
// AGENTS.md §4: never write *trusted*, *verified* or *secure* about a reviewed
// server. The word is **reviewed**. (*safe* was on that list until 2026-07-26 —
// see the note on `BANNED`.) And never say *reputation* about
// anything agent-shaped — SureX reviews servers, not agents, and the World
// track excludes agent reputation explicitly.
//
// A rule that only lives in a document drifts. This makes it testable, so a
// banned word in a block message or a page fails the build instead of shipping.

/**
 * Each entry: the pattern, what to say instead, and optionally the context that
 * makes the word a term of art rather than a claim.
 *
 * `unless` is checked against the SENTENCE containing the match, not the whole
 * text — otherwise one legitimate mention of Walrus at the top of a page would
 * license every unearned claim below it.
 */
export const BANNED = Object.freeze([
  // *safe* is deliberately absent — dropped 2026-07-26 so the site could use it.
  // Nothing checks the word now, including `recordsFor` before it signs an ENS
  // record; *trusted*, *verified* and *secure* still cover that path.
  { re: /\btrust(?:ed|worthy|less)\b/i, word: 'trusted', instead: 'reviewed' },
  {
    re: /\bverif(?:ied|iable|y|ication|ying)\b/i,
    word: 'verified',
    instead: 'reviewed',
    // Checking bytes against a digest really is verification; a server is never
    // "verified".
    unless: /\b(bytes|blob|digest|integrity|sha256|signature|nullifier|proof|orb|world\s*id)\b/i,
  },
  { re: /\bunverified\b/i, word: 'unverified', instead: 'unreviewed' },
  { re: /\bsecure(?:d|ly)?\b/i, word: 'secure', instead: 'reviewed' },
  { re: /\breputation(?:al)?\b/i, word: 'reputation', instead: 'review — SureX reviews servers, not agents' },
  {
    re: /\bcertif(?:ied|y|ies|ication)\b/i,
    word: 'certified',
    instead: 'reviewed (Walrus blobs are certified; servers are not)',
    // "certify" is the name of the second Walrus transaction. It is a fact about
    // storage, not a claim about code.
    unless: /\b(blob|walrus|sui|quilt|storage node|epoch)\b/i,
  },
  { re: /\bguarantee(?:d|s)?\b/i, word: 'guarantee', instead: 'nothing — do not promise an outcome' },
]);

/**
 * Narrow, deliberate exemptions. Each one is a place where the word is a
 * technical term of art rather than a claim about a server, so banning it would
 * make the product less precise instead of more honest.
 */
export const ALLOWED_PHRASES = Object.freeze([
  'certified blob',          // Walrus: a real on-chain state, not a claim about code
  'certify',                 // the Walrus transaction name
  'BlobCertified',           // the Walrus event name
  'alreadyCertified',        // the Walrus SDK response
  'verify the bytes',        // the blob-ID check the gate performs
  'bytes verify',
  'Orb-verified',            // World's own term for a credential level
  'World ID verification',   // ditto
  'verification_level',      // an IDKit parameter name
  // 'safe to remove' lived here to keep engineering prose out of the linter's
  // way. The rule it was exempting no longer exists, so the exemption does not
  // either.
]);

function stripAllowed(text) {
  let out = text;
  for (const phrase of ALLOWED_PHRASES) {
    out = out.split(phrase).join(' ');
    out = out.split(phrase.toLowerCase()).join(' ');
  }
  return out;
}

/** Sentences, roughly. Line breaks count as boundaries — copy is full of them. */
function sentences(text) {
  return text
    .split(/(?<=[.!?:;])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {string} text  user-facing copy
 * @returns {{word:string, instead:string, context:string}[]}
 */
export function copyViolations(text) {
  if (typeof text !== 'string' || !text) return [];
  const found = [];
  const seen = new Set();
  for (const sentence of sentences(stripAllowed(text))) {
    for (const rule of BANNED) {
      if (seen.has(rule.word)) continue;
      const m = sentence.match(rule.re);
      if (!m) continue;
      if (rule.unless && rule.unless.test(sentence)) continue;
      seen.add(rule.word);
      found.push({
        word: rule.word,
        instead: rule.instead,
        context: sentence.replace(/\s+/g, ' ').trim().slice(0, 120),
      });
    }
  }
  // Report in the order the rules are declared, so output is stable.
  return found.sort((a, b) => BANNED.findIndex((r) => r.word === a.word) - BANNED.findIndex((r) => r.word === b.word));
}

/** Throws on the first violation. For use in tests and at build time. */
export function assertCopy(text, where = 'copy') {
  const violations = copyViolations(text);
  if (!violations.length) return;
  const detail = violations
    .map((v) => `  "${v.word}" → use ${v.instead}\n    …${v.context}…`)
    .join('\n');
  throw new Error(`Copy law violated in ${where}:\n${detail}`);
}

/**
 * The sentence that must appear wherever a verdict is presented in full. It is
 * the whole disclosure obligation in one line, so it cannot be forgotten in one
 * surface and remembered in another.
 */
export const NO_HUMAN_AUDIT = 'No human audited this.';

/** What `clean` actually means. Stated in full on any page that renders one. */
export const CLEAN_MEANS =
  'This submitted version, read statically, showed no model-detectable mismatch between its stated ' +
  'purpose and its code, at that time. It does not cover dependencies, and it does not mean the copy ' +
  'installed on your machine is the copy that was reviewed.';
