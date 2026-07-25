// The gate. This is the product.
//
// It runs on every MCP tool call, in a PreToolUse hook, and resolves one of
// three outcomes:
//
//   allow  — reviewed, no mismatch found. Exit 0, no stdout, no trace. The user
//            never notices, which is the only way a thing like this survives.
//   warn   — unknown, stale, unreviewable, or the registry is unreachable.
//            systemMessage ONLY, and deliberately no permissionDecision: a hook
//            returning "allow" GRANTS the call outright (FRICTION-LOG C2), so
//            emitting it here would auto-approve exactly the servers we know
//            nothing about. Returning no decision leaves Claude Code's own
//            permission flow in charge, which is the correct posture — SureX
//            has an opinion, not authority, on everything except a flag.
//   block  — flagged or disputed at severity >= 3. Deny, with the whole case in
//            permissionDecisionReason, because that string is the only channel
//            that reaches both the user's terminal and the model.
//
// Every path is wrapped so that an unexpected failure warns and proceeds. A
// SureX outage must never become a total agent outage.

import {
  canonicalise, decide, fingerprintOf, loadEvidence, offlineMessage,
  parseServerFromToolName, tierOf, verificationLine, warnMessage, blockMessage,
} from './core/index.mjs';
import { findServer } from './config.mjs';
import { findLocalIntegrity } from './integrity.mjs';
import { fetchVerdict, fetchVerdictBatch, ttlFor } from './registry.mjs';
import { cacheGet, cachePut, cachePutMany, isOverridden, logDecision } from './store.mjs';

const WEB_BASE = () => (process.env.SUREX_WEB_URL || 'https://surex.dev').replace(/\/+$/, '');

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

function deny(reason) {
  emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
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

  // A plugin-provided server's definition lives inside that plugin, not in any
  // config scope we can read. We can name it but not fingerprint it, and
  // saying so beats guessing — a wrong fingerprint reads as `unknown`, which
  // is indistinguishable from a server nobody has reviewed.
  const { server } = findServer(parsed.server, cwd, opts);
  if (!server) {
    return { reason: parsed.plugin ? 'plugin-provided' : 'config-not-found', parsed };
  }

  try {
    const canonical = canonicalise(server.def);
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
  return version && version !== 'unpinned' ? `${name}@${version}` : `${name} (unpinned)`;
}

/**
 * Upgrade the tier by comparing the installed bytes' digest to the one recorded
 * at review time. This is the whole Tier A story, and it is the one part of a
 * verdict that speaks about the user's actual machine.
 */
export function resolveTier(canonical, head, cwd) {
  if (canonical.transport !== 'stdio') return { tier: 'C', local: null };
  const { name, version } = canonical.package ?? {};
  if (!version || version === 'unpinned') return { tier: 'C', local: null };
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
    // We could not identify it. That is a miss, and a miss warns — it must
    // never look like an approval, and it must never look like a review.
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
      // 3. Offline. A cached flag still blocks — a network blip must not
      //    un-flag a server we already know is bad.
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
  const resolved = { ...head, tier, name: displayName, fingerprint };

  const decision = decide(resolved);
  logDecision({
    decision, state: resolved.state, severity: resolved.severity, tier,
    fingerprint, from, integrityLayout: local?.layout ?? null, session: input.session_id,
  });

  if (decision === 'allow') allowSilently();

  if (decision === 'warn') {
    // A MISMATCH is a downgrade and a warning, never a block (FR-19): it is far
    // more often a registry quirk or a local rebuild than an attack.
    if (tier === 'MISMATCH') {
      warn(
        `⚠ SureX: the published artifact for ${displayName} changed after it was reviewed. ` +
          `Treating the review as stale. Proceeding unreviewed.`,
      );
    }
    warn(warnMessage(resolved, { name: displayName }));
  }

  // 5. Blocking. This is the one moment the evidence is fetched: a human is
  //    about to read it, so a few hundred milliseconds is invisible — and if
  //    nobody ever reads the blob, "the verdict points at the exact bytes it
  //    judged" is a claim rather than a property.
  let evidenceLine = null;
  if (resolved.evidence?.blobId) {
    const loaded = await loadEvidence(resolved.evidence, { timeoutMs: EVIDENCE_BUDGET_MS });
    if (loaded.ok) {
      evidenceLine = `Evidence fetched from Walrus and checked: ${verificationLine(loaded.verification)}`;
      const failed = loaded.verification.checks.filter((c) => c.status === 'failed');
      if (failed.length) {
        // The bytes an aggregator served are not the bytes the record was
        // written against. That is a bigger story than the finding itself.
        evidenceLine =
          `⚠ Evidence did NOT match the record: ${failed.map((c) => c.detail).join('; ')}`;
      }
      // Prefer the finding recorded in the certified blob over the annotation
      // summary — the blob is the thing that was actually judged.
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
  });

  deny(evidenceLine ? `${reason}\n\n${evidenceLine}` : reason);
}

/**
 * The SessionStart path. Reads every config scope directly, fingerprints all of
 * them, and warms the cache in one batched request before the first tool call.
 *
 * It must not query the MCP servers themselves — SessionStart hooks fire before
 * MCP connections are established. Fingerprinting is config-only, so this is a
 * non-issue by construction rather than by discipline.
 */
export async function runPrefetch(input) {
  const cwd = input?.cwd || process.cwd();
  const { discoverServers } = await import('./config.mjs');
  const { servers } = discoverServers(cwd);

  const fps = [];
  for (const server of servers) {
    try {
      fps.push(fingerprintOf(canonicalise(server.def)));
    } catch {
      // A server we cannot canonicalise is a miss at call time, not here.
    }
  }
  if (!fps.length) process.exit(0);

  try {
    const heads = await fetchVerdictBatch([...new Set(fps)]);
    for (const head of heads) cachePut(head.fingerprint, head, ttlFor(head));
    const flagged = heads.filter((h) => h.state === 'flagged' || h.state === 'disputed');
    logDecision({ decision: 'prefetch', count: heads.length, flagged: flagged.length, session: input?.session_id });
    if (flagged.length) {
      // Told once, at the start, rather than as a surprise mid-task.
      emit({
        systemMessage:
          `⚠ SureX: ${flagged.length} of ${heads.length} configured MCP server(s) are flagged and will be ` +
          `blocked when called. Run \`surex list\` to see them.`,
      });
    }
  } catch {
    // A failed prefetch is not worth a message. The per-call path will say so
    // if the registry is still unreachable when it matters.
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
