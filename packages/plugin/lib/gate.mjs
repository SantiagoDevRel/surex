// The gate. Runs on every MCP tool call in a PreToolUse hook and resolves one of
// three outcomes:
//
//   allow  — reviewed, no mismatch. Exit 0, no stdout, no trace.
//   warn   — unknown, stale, unreviewable, or the registry is unreachable.
//            a systemMessage and no permissionDecision: a hook returning
//            "allow" grants the call outright (FRICTION-LOG C2), which would
//            auto-approve exactly the servers nobody has reviewed. No decision
//            leaves Claude Code's own permission flow in charge.
//   stop   — flagged or disputed at severity >= 3. `permissionDecision: 'ask'`,
//            whole case in permissionDecisionReason — the only string that
//            reaches both the user's terminal and the model. The call does not
//            run until a person answers.
//
// Every path warns and proceeds on unexpected failure.

import {
  canonicalise, decide, fingerprintOf, isUnidentifiable, loadEvidence, offlineMessage,
  parseServerFromToolName, tierOf, verificationLine, warnMessage, blockMessage,
} from './core/index.mjs';
import { findServer } from './config.mjs';
import { localEntryResolver } from './localentry.mjs';
import { overrideCommand, whyCommand } from './selfpath.mjs';
import { findLocalIntegrity } from './integrity.mjs';
import { fetchVerdict, fetchVerdictBatch, ttlFor } from './registry.mjs';
import { cacheGet, cachePut, cachePutMany, isOverridden, logDecision } from './store.mjs';

// Must resolve: every block message prints an evidence link and a dispute link.
const WEB_BASE = () => (process.env.SUREX_WEB_URL || 'https://arkiv-surex.vercel.app').replace(/\/+$/, '');

/** Fetching the evidence must never be what makes the gate miss its budget. */
const EVIDENCE_BUDGET_MS = 3000;

function emit(payload) {
  if (payload) process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

/** Warn: a notice, and no decision. See the note at the top of this file. */
function warn(message) {
  emit({ systemMessage: message });
}

/**
 * Stop the call and hand the decision to the human. `ask`, not `deny`: both stop
 * the call — nothing runs until a person approves it — and `ask` puts the case in
 * front of them rather than ending it for them.
 *
 * Valid values are allow/deny/ask/defer. `allow` is unusable here: it grants the
 * call outright, bypassing the normal prompt (FRICTION-LOG C2).
 */
function ask(reason) {
  emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: reason,
    },
  });
}

/** Allow silently. Exit 0 with no stdout leaves the normal flow untouched. */
function allowSilently() {
  emit(null);
}

/**
 * Resolve a tool call to a fingerprint, using configuration on disk only.
 * The gate never runs or connects to an MCP server to identify it.
 */
export function identify(toolName, cwd, opts = {}) {
  const parsed = parseServerFromToolName(toolName);
  if (!parsed) return { reason: 'not-an-mcp-tool' };

  const { server } = findServer(parsed.server, cwd, opts);
  if (!server) {
    return { reason: parsed.plugin ? 'plugin-provided' : 'config-not-found', parsed };
  }

  try {
    // Without the resolver every `node server.js` on earth is one fingerprint.
    const canonical = canonicalise(server.def, { hashLocalEntry: localEntryResolver(cwd) });
    if (isUnidentifiable(canonical)) {
      // A local script we could not read — the entry we would find is another server's.
      return { reason: 'local-entry-unreadable', parsed, server, canonical };
    }
    return {
      parsed,
      server,
      canonical,
      fingerprint: fingerprintOf(canonical),
      displayName: displayNameFor(canonical, parsed.server),
    };
  } catch (err) {
    return { reason: 'canonicalisation-failed', parsed, error: err.message };
  }
}

function displayNameFor(canonical, fallback) {
  if (canonical.transport !== 'stdio') return `${canonical.host}${canonical.path}`;
  const { name, version } = canonical.package ?? {};
  if (!name) return fallback;
  /**
   * A local script's package "name" is a filename and its version `local:<16 hex>`,
   * so `server.mjs@local:f09503fa7a5173ff` names nothing a developer can look up.
   * Use the configured name; the hash is still printed as the fingerprint.
   */
  if (String(version).startsWith('local:')) return fallback;
  return version && version !== 'unpinned' ? `${name}@${version}` : `${name} (unpinned)`;
}

/**
 * Upgrade the tier by comparing the installed bytes' digest to the one recorded at
 * review time — the one part of a verdict that speaks about the user's own machine.
 */
export function resolveTier(canonical, head, cwd) {
  if (canonical.transport !== 'stdio') return { tier: 'C', local: null };
  const { name, version } = canonical.package ?? {};
  if (!version || version === 'unpinned') return { tier: 'C', local: null };
  // Tier C on purpose: the hash covers the entry file, not the module graph behind
  // it, so the reviewed bytes are not provably the bytes that will run.
  if (String(version).startsWith('local:')) return { tier: 'C', local: null };
  const local = findLocalIntegrity(name, version, { cwd });
  return {
    tier: tierOf(canonical, { recordedIntegrity: head?.integrity, localIntegrity: local.integrity }),
    local,
  };
}

/** The PreToolUse path. */
export async function runGate(input) {
  const cwd = input.cwd || process.cwd();
  const id = identify(input.tool_name, cwd);

  if (id.reason === 'not-an-mcp-tool') allowSilently();

  if (!id.fingerprint) {
    // A miss warns: it must never look like an approval, nor like a review.
    logDecision({ decision: 'warn', why: id.reason, tool: input.tool_name, session: input.session_id });
    warn(
      `⚠ SureX: could not identify ${id.parsed?.server ?? 'this MCP server'} from its configuration ` +
        `(${id.reason}). It was not looked up. Proceeding unreviewed.`,
    );
  }

  const { fingerprint, canonical, displayName } = id;

  // 1. A local override wins over everything, and is reported nowhere.
  const override = isOverridden(fingerprint, input.session_id);
  if (override) {
    logDecision({ decision: 'override', scope: override.scope, fingerprint, session: input.session_id });
    allowSilently();
  }

  // 2. Cache, then network. A fresh cache hit skips the network entirely.
  let head = null;
  let from = null;
  const cached = cacheGet(fingerprint);
  if (cached && !cached.stale) {
    head = cached.head;
    from = 'cache';
  } else {
    try {
      const res = await fetchVerdict(fingerprint);
      head = res.head;
      from = res.malformed ? 'network (malformed → unknown)' : 'network';
      cachePut(fingerprint, head, ttlFor(head));
    } catch (err) {
      // 3. Offline. A cached flag still blocks: a network blip must not un-flag it.
      if (cached?.head && (cached.head.state === 'flagged' || cached.head.state === 'disputed')) {
        head = cached.head;
        from = 'cache (registry unreachable)';
      } else {
        logDecision({ decision: 'warn', why: 'registry-unreachable', fingerprint, error: err.message });
        warn(offlineMessage(displayName, err.message));
      }
    }
  }

  // 4. Tier, from the local install.
  const { tier, local } = resolveTier(canonical, head, cwd);
  // Ordering matters: `head.name` is set only when a registry entry exists, and the
  // merge below overwrites it — "is it listed at all" must be answered first.
  const listed = Boolean(head?.name);
  /**
   * The published name wins when there is one, with the local one alongside. The
   * published name is what the registry, the evidence page and the ENS record all
   * call this server; the local name is which of the user's own servers it is.
   */
  const shown =
    head?.name && head.name !== displayName ? `${head.name} (${displayName})` : displayName;
  const resolved = { ...head, tier, name: shown, fingerprint, listed };

  const decision = decide(resolved);
  logDecision({
    decision, state: resolved.state, severity: resolved.severity, tier,
    fingerprint, from, integrityLayout: local?.layout ?? null, session: input.session_id,
  });

  if (decision === 'allow') allowSilently();

  if (decision === 'warn') {
    // A MISMATCH is a downgrade and a warning, never a block (FR-19) — far more
    // often a registry quirk or a local rebuild than an attack.
    if (tier === 'MISMATCH') {
      warn(
        `⚠ SureX: the published artifact for ${displayName} changed after it was reviewed. ` +
          `Treating the review as stale. Proceeding unreviewed.`,
      );
    }
    // `shown`, not `displayName`: warnMessage takes ctx.name over head.name.
    // The submit URL is passed unconditionally — warnMessage decides whether to
    // render it, keeping that branch where the copy law lives (verdict.mjs).
    warn(warnMessage(resolved, { name: shown, submitUrl: `${WEB_BASE()}/submit` }));
  }

  // 5. Blocking. The one moment the evidence is fetched — a human is about to read
  //    it, so a few hundred milliseconds is invisible.
  let evidenceLine = null;
  if (resolved.evidence?.blobId) {
    const loaded = await loadEvidence(resolved.evidence, { timeoutMs: EVIDENCE_BUDGET_MS });
    if (loaded.ok) {
      evidenceLine = `Evidence fetched from Walrus and checked: ${verificationLine(loaded.verification)}`;
      const failed = loaded.verification.checks.filter((c) => c.status === 'failed');
      if (failed.length) {
        evidenceLine =
          `⚠ Evidence did NOT match the record: ${failed.map((c) => c.detail).join('; ')}`;
      }
      // Prefer the finding in the certified blob over the annotation summary —
      // the blob is the thing that was actually judged.
      if (loaded.body?.findings?.length && !resolved.topFinding) {
        resolved.topFinding = [...loaded.body.findings].sort((a, b) => b.severity - a.severity)[0];
      }
    } else {
      evidenceLine = `Evidence could not be fetched from Walrus (${loaded.error}). The block stands.`;
    }
  }

  const reason = blockMessage(resolved, {
    evidenceUrl: `${WEB_BASE()}/r/${fingerprint}`,
    disputeUrl: `${WEB_BASE()}/d/${fingerprint}`,
    // Resolved against how this plugin was installed, so the command exists here.
    overrideCommand: overrideCommand(fingerprint),
  });

  ask(evidenceLine ? `${reason}\n\n${evidenceLine}` : reason);
}

/**
 * The SessionStart path. Fingerprints every configured server and warms the cache
 * in one batched request before the first tool call. It must not query the servers
 * themselves — SessionStart fires before MCP connections exist.
 */
export async function runPrefetch(input) {
  const cwd = input?.cwd || process.cwd();
  const { discoverServers } = await import('./config.mjs');
  const { servers } = discoverServers(cwd);

  const resolver = localEntryResolver(cwd);
  const fps = [];
  for (const server of servers) {
    try {
      const canonical = canonicalise(server.def, { hashLocalEntry: resolver });
      // Skip what the hot path will also refuse to look up, so the two agree.
      if (isUnidentifiable(canonical)) continue;
      fps.push(fingerprintOf(canonical));
    } catch {
      // A server we cannot canonicalise is a miss at call time, not here.
    }
  }
  if (!fps.length) process.exit(0);

  try {
    const unique = [...new Set(fps)];
    const { answered, unanswered } = await fetchVerdictBatch(unique);
    // Only what the registry answered for is cached — caching an unmentioned
    // fingerprint as `unknown` would let a broken batch endpoint suppress a flag
    // for the whole negative TTL.
    for (const head of answered) cachePut(head.fingerprint, head, ttlFor(head));
    const heads = answered;
    const flagged = heads.filter((h) => h.state === 'flagged' || h.state === 'disputed');
    logDecision({
      decision: 'prefetch', asked: unique.length, count: heads.length,
      unanswered: unanswered.length, flagged: flagged.length, session: input?.session_id,
    });
    if (flagged.length) {
      emit({
        systemMessage:
          `⚠ SureX: ${flagged.length} of ${heads.length} configured MCP server(s) are flagged and will be ` +
          `blocked when called. Run \`surex list\` to see them.`,
      });
    }
  } catch {
    // A failed prefetch is not worth a message; the per-call path will say so.
  }
  process.exit(0);
}

/** Read the hook payload off stdin. */
export async function readInput() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
