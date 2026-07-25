// The decision, and the words it is delivered in.
//
// Everything user-facing about a verdict is composed here so the copy law has
// exactly one place to be enforced (and one place to be tested):
//   the word is REVIEWED — never safe, trusted, verified or secure,
//   and never "reputation" about anything agent-shaped.
// Spec: docs/surex-prd.md §6, docs/surex-tech-spec.md §3.3.
//
// Node stdlib only — vendored into the plugin. See scripts/sync-core.mjs.

/** Every state a fingerprint can be in. `unknown` is the absence of an entry. */
export const STATES = Object.freeze([
  'clean',
  'flagged',
  'disputed',
  'unreviewable',
  'stale',
  'unknown',
]);

/** Both of these block. A dispute changes the wording, never the enforcement. */
export const BLOCKING_STATES = Object.freeze(['flagged', 'disputed']);

/** Below this, a finding is worth showing but not worth stopping a call over. */
export const BLOCK_SEVERITY_THRESHOLD = 3;

export const SEVERITY_LABEL = Object.freeze({
  0: 'none', 1: 'low', 2: 'moderate', 3: 'high', 4: 'critical',
});

/**
 * The whole hot-path decision, from annotations alone. No blob fetch, no second
 * round trip: a verdict that needed a fetch to be actionable would double the
 * latency of every tool call.
 *
 * @returns {'block'|'warn'|'allow'}
 */
export function decide(head) {
  if (!head || !head.state || head.state === 'unknown') return 'warn';
  if (BLOCKING_STATES.includes(head.state)) {
    return Number(head.severity ?? 0) >= BLOCK_SEVERITY_THRESHOLD ? 'block' : 'warn';
  }
  if (head.state === 'clean') return 'allow';
  // stale, unreviewable, and anything we do not recognise: say so, do not stop.
  return 'warn';
}

/**
 * Which of the three block wordings applies.
 *
 * `enforceAfter` does NOT gate blocking (FR-21) — the server blocks from the
 * moment it is flagged. The window only decides whether the block calls itself
 * unconfirmed or confirmed, so a maintainer gets a chance to answer before an
 * accusation hardens, while users are protected with no delay.
 */
export function confidenceOf(head, now = Date.now()) {
  if (head?.state === 'disputed') return 'disputed';
  const after = Number(head?.enforceAfter ?? 0);
  return after && now > after ? 'confirmed' : 'unconfirmed';
}

function fmtDate(value) {
  if (!value) return 'unknown date';
  const d = value instanceof Date ? value : new Date(Number(value) || value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString().slice(0, 10);
}

function shortId(id, head = 6, tail = 4) {
  if (!id) return '—';
  const s = String(id);
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/** `net · fs · env` — what the deterministic scan found the code can reach. */
export function capabilityLine(capabilities) {
  if (!capabilities) return null;
  const NAMES = {
    network: 'network',
    filesystem: 'filesystem',
    exec: 'process execution',
    env: 'environment variables',
    credentials: 'credential stores',
  };
  const present = Object.entries(capabilities)
    .filter(([, v]) => v && v.present)
    .map(([k]) => NAMES[k] ?? k);
  return present.length ? present.join(' · ') : 'nothing we can detect';
}

/**
 * The block message. This single string is the only channel that reaches both
 * the user's terminal and the model, so the entire case goes in it.
 *
 * Kept deliberately short. A 12,054-character reason was measured to arrive
 * intact but stop being *read* as a block — the model described it as a tool
 * error (FRICTION-LOG C4). The limit that matters is comprehension.
 */
export function blockMessage(head, opts = {}) {
  const now = opts.now ?? Date.now();
  const confidence = confidenceOf(head, now);
  const name = head.name || head.fingerprint || 'this server';
  const finding = head.topFinding ?? null;

  const lines = [];
  lines.push(`SureX blocked this call — ${name}`);
  lines.push('');

  if (confidence === 'disputed') {
    const rebuttal = head.disputeSummary ? ` Their rebuttal: ${head.disputeSummary}` : '';
    lines.push(
      `Flagged by automated review, and contested by the maintainer.${rebuttal} A human review is pending.`,
    );
  } else if (confidence === 'confirmed') {
    lines.push(`Flagged by automated review, uncontested since ${fmtDate(head.enforceAfter)}.`);
  } else {
    lines.push(
      'Flagged by automated review. Not confirmed by a human. The maintainer has been notified and may respond.',
    );
  }
  lines.push('');

  if (finding) {
    const where = finding.file ? ` — ${finding.file}${finding.line ? `:${finding.line}` : ''}` : '';
    lines.push(`Finding (${SEVERITY_LABEL[finding.severity] ?? 'unknown'}): ${finding.description}${where}`);
  }
  const caps = capabilityLine(head.capabilities);
  if (caps) lines.push(`This code can reach: ${caps}`);

  // The link line. Tier is the honest part: it says whether the reviewed bytes
  // are the bytes about to run, and C means we cannot tell.
  lines.push('');
  lines.push(tierSentence(head.tier));

  // The contract carries the pointer as `evidence.blobId`; accept the flat form
  // too so a hand-built head in a test or a fixture cannot silently drop the
  // one identifier that makes the verdict checkable.
  const blobId = head.evidence?.blobId ?? head.evidenceBlobId;
  lines.push(
    `Reviewed: commit ${shortId(head.reviewedCommit, 7, 0)} · blob ${shortId(blobId)} · ` +
      `${fmtDate(head.reviewedAt ?? head.updatedAt)} · model ${head.modelId ?? 'unknown'}, ` +
      `prompt ${head.promptVersion ?? 'unknown'}. No human audited this.`,
  );

  if (opts.evidenceUrl || opts.disputeUrl) {
    const parts = [];
    if (opts.evidenceUrl) parts.push(`Evidence: ${opts.evidenceUrl}`);
    if (opts.disputeUrl) parts.push(`Dispute: ${opts.disputeUrl}`);
    lines.push(parts.join('    '));
  }

  lines.push('');
  // The override is printed in EVERY block, and the caller supplies the exact
  // invocation because whether a bare `surex` resolves depends on how the plugin
  // was installed — it is not on PATH from a marketplace install (FRICTION-LOG
  // C7). Printing a command that does not exist would break the one escape hatch
  // that makes blocking acceptable.
  const override = opts.overrideCommand ?? `surex allow ${head.fingerprint}`;
  lines.push(`You can proceed anyway, at your own risk:  ${override}`);

  return lines.join('\n');
}

/** One sentence on what the tier actually promises. Never overstate it. */
export function tierSentence(tier) {
  switch (tier) {
    case 'A':
      return 'Link to your install (A): the reviewed bytes are the installed bytes.';
    case 'B':
      return 'Link to your install (B): same version string — the bytes were not compared.';
    case 'MISMATCH':
      return 'Link to your install: the published artifact for this version changed after we reviewed it.';
    default:
      return 'Link to your install (C): nothing was checked — this verdict may be about code that is not your code.';
  }
}

/**
 * The warn notice. Display-only, and it carries NO permission decision — see
 * FRICTION-LOG C2: a hook returning `allow` grants the call outright, which
 * would auto-approve exactly the servers we know nothing about.
 */
export function warnMessage(head, ctx = {}) {
  const name = ctx.name || head?.name || ctx.server || 'this MCP server';
  switch (head?.state) {
    case 'stale':
      return `⚠ SureX: ${name} released a new version that has not been reviewed yet. Proceeding unreviewed.`;
    case 'unreviewable':
      return `⚠ SureX: ${name} could not be reviewed (${head.reason ?? 'no readable source'}). Proceeding unreviewed.`;
    case 'flagged':
    case 'disputed':
      return `⚠ SureX: ${name} has a finding below the blocking threshold (severity ${head.severity}). Proceeding.`;
    case 'unknown':
    default:
      // `unknown` covers two different facts and they must not read the same. An
      // entry that exists carries a name; a fingerprint nobody has ever submitted
      // does not. Telling a user a server "is not in the registry" when it is
      // listed and simply unreviewed is a false statement about our own data —
      // and it is the difference between "nobody has looked" and "nobody has even
      // heard of this".
      // `listed` is set by the caller from the API's own answer, BEFORE any local
      // display name is merged in — the gate always fills `name` from the local
      // config, so `name` cannot tell these two apart.
      //
      // Only the never-submitted branch gets the submit link, and that is the
      // point of keeping the two branches apart. "Submit it" is actionable advice
      // when nobody has ever sent this configuration in; pointed at a server that
      // is already listed and merely waiting for a review, it would send someone
      // to fill in a form that changes nothing.
      if (head?.listed) {
        return `⚠ SureX: ${name} is listed but has not been reviewed. Proceeding unreviewed.`;
      }
      return (
        `⚠ SureX: ${name} is not in the registry — nobody has submitted this install configuration. ` +
        `Proceeding unreviewed.` +
        (ctx.submitUrl ? ` Submit it for review: ${ctx.submitUrl}` : '')
      );
  }
}

/** The notice when we could not reach the registry at all. Fails open, visibly. */
export function offlineMessage(name, detail) {
  return (
    `⚠ SureX: could not reach the registry${detail ? ` (${detail})` : ''}. ` +
    `${name} was not looked up. Proceeding unreviewed.`
  );
}
