// AUTO-GENERATED — do not edit.
// Vendored from packages/core/src by scripts/sync-core.mjs, because the plugin
// runs on a user's machine with nothing installed. Edit the original and re-run
// `pnpm sync:core`.
// The decision, and the words it is delivered in.
//
// Everything user-facing about a verdict is composed here so the copy law has one
// place to be enforced: the word is *reviewed* — never trusted, verified or secure,
// and never "reputation" about anything agent-shaped.
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
 * Which of the three block wordings applies. `enforceAfter` does not gate
 * blocking (FR-21) — a server blocks from the moment it is flagged; the window
 * only decides whether the block calls itself unconfirmed or confirmed.
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
 * The block message. The only channel that reaches both the user's terminal and
 * the model, so the entire case goes in it — and kept short: a 12,054-character
 * reason arrived intact but was read as a tool error, not a block
 * (FRICTION-LOG C4). The test pins it under 1,200 characters.
 */
export function blockMessage(head, opts = {}) {
  const now = opts.now ?? Date.now();
  const confidence = confidenceOf(head, now);
  const name = head.name || head.fingerprint || 'this server';
  const finding = head.topFinding ?? null;

  const lines = [];
  // A question, because the gate hands the decision to the human
  // (`permissionDecision: 'ask'`) rather than ending the call. The recommendation
  // is stated separately: advice about an action, never a claim about the code.
  lines.push(`Are you sureX you want to use ${name}?`);
  lines.push('');
  lines.push('SureX does not recommend proceeding.');
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

  lines.push('');
  lines.push(tierSentence(head.tier));

  // The contract carries the pointer as `evidence.blobId`; the flat form is
  // accepted too, so a hand-built head cannot silently drop the one identifier
  // that makes the verdict checkable.
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
  // Printed in every block. The caller supplies the exact invocation because a
  // bare `surex` is not on PATH from a marketplace install (FRICTION-LOG C7), and
  // printing a command that does not exist breaks the only escape hatch.
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
 * The warn notice. Display-only, and it carries no permission decision — see
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
      // `unknown` covers two facts that must not read the same: listed but
      // unreviewed, and never submitted at all. `listed` is set by the caller from
      // the API's own answer before any local display name is merged in — the gate
      // always fills `name` from the local config, so `name` cannot tell them apart.
      //
      // Only the never-submitted branch gets the submit link; pointed at a listed
      // server it would send someone to fill in a form that changes nothing.
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
