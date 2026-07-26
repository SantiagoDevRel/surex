// The official MCP Registry crawler, and the resolution of an entry to something
// SXF-1 can fingerprint.
//
// The endpoint, as measured:
//   GET https://registry.modelcontextprotocol.io/v0/servers?version=latest&limit=100[&cursor=…]
//   → { servers: [ { server: {...}, _meta: { "io.modelcontextprotocol.registry/official": {...} } } ],
//       metadata: { nextCursor, count } }
// `version=latest` collapses a server's many published versions to one row; without
// it the first page is three revisions of the same server. Paging is by opaque
// `nextCursor`, not offset.
//
// WHICH CONFIG WE FINGERPRINT. Under SXF-1 pinned and unpinned are different
// fingerprints on purpose, and the gate fingerprints what is in the USER's config —
// almost always the unpinned `npx -y @scope/pkg` a README told them to paste. So the
// seeded entry is the UNPINNED form; seeding the registry's pinned form gives a
// registry that looks full and matches nothing. The pinned fingerprint is recorded
// alongside as an alias, labelled not-yet-seeded. Unpinned ⇒ Tier C, expected.

import { canonicalise, fingerprintOf, tierOf } from '@surex/core';

export const REGISTRY_BASE = process.env.SUREX_MCP_REGISTRY || 'https://registry.modelcontextprotocol.io';
export const REGISTRY_API = `${REGISTRY_BASE.replace(/\/+$/, '')}/v0/servers`;
const OFFICIAL_META = 'io.modelcontextprotocol.registry/official';
const UA = 'surex-worker/0.1 (ETHGlobal Lisbon 2026; registry seed)';

/** Runners we can build a config for. `mcpb` is a bundle format, not a runner. */
const RUNNER_FOR = { npm: 'npx', pypi: 'uvx', oci: 'docker' };

async function getJson(url, { timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'user-agent': UA } });
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Walk the cursor until `want` active servers are collected or pages run out. */
export async function crawlRegistry({ want = 400, pageSize = 100, maxPages = 20, log = () => {} } = {}) {
  const rows = [];
  let cursor = null;
  let pages = 0;
  while (rows.length < want && pages < maxPages) {
    const url = new URL(REGISTRY_API);
    url.searchParams.set('version', 'latest');
    url.searchParams.set('limit', String(pageSize));
    if (cursor) url.searchParams.set('cursor', cursor);
    const body = await getJson(url.toString());
    const batch = body.servers ?? [];
    pages += 1;
    for (const row of batch) {
      const meta = row._meta?.[OFFICIAL_META] ?? {};
      if (meta.status && meta.status !== 'active') continue;
      rows.push({ server: row.server, meta });
    }
    log(`  registry page ${pages}: +${batch.length} rows (${rows.length} active so far)`);
    cursor = body.metadata?.nextCursor ?? null;
    if (!cursor) break;
  }
  return { rows, pages, exhausted: !cursor };
}

/**
 * Named/positional argument descriptors → a flat arg list.
 *
 * With `onlyNamed`, only NAMED runtime arguments (flags) may precede the package
 * spec; a POSITIONAL one is deferred and placed after it. Publishers misfile
 * package arguments under `runtimeArguments` — a CLI subcommand, an endpoint URL —
 * and composing those in the documented order yields `npx -y mcp marketintell`,
 * making the fingerprint's package name `mcp` (or an https URL): an entry no real
 * config can ever match.
 */
function argValues(list, { onlyNamed = false } = {}) {
  const out = [];
  const deferred = [];
  for (const a of list ?? []) {
    // Only arguments with a concrete value are identity-bearing; a placeholder the
    // user fills in says nothing about which server this is.
    if (a.type === 'named' && a.name) {
      out.push(a.name);
      if (a.value !== undefined && a.value !== null && a.value !== '') out.push(String(a.value));
    } else if (a.value !== undefined && a.value !== null && a.value !== '') {
      (onlyNamed ? deferred : out).push(String(a.value));
    }
  }
  return onlyNamed ? { before: out, after: deferred } : out;
}

/**
 * One registry package → the two MCP client config blocks a user could have.
 * `unpinned` is the one we seed; `pinned` is recorded as an alias.
 */
export function configsForPackage(pkg) {
  const runner = RUNNER_FOR[pkg.registryType];
  if (!runner) return null;
  if (pkg.transport?.type && pkg.transport.type !== 'stdio') return null;

  const runtime = argValues(pkg.runtimeArguments, { onlyNamed: true });
  const pkgArgs = [...runtime.after, ...argValues(pkg.packageArguments)];

  if (runner === 'docker') {
    const base = ['run', '-i', '--rm', ...runtime.before];
    return {
      unpinned: { command: 'docker', args: [...base, pkg.identifier, ...pkgArgs] },
      pinned: pkg.version
        ? { command: 'docker', args: [...base, `${pkg.identifier}:${pkg.version}`, ...pkgArgs] }
        : null,
    };
  }

  const ceremony = runner === 'npx' ? ['-y'] : [];
  return {
    unpinned: { command: runner, args: [...ceremony, ...runtime.before, pkg.identifier, ...pkgArgs] },
    pinned: pkg.version
      ? {
          command: runner,
          args: [...ceremony, ...runtime.before, `${pkg.identifier}@${pkg.version}`, ...pkgArgs],
        }
      : null,
  };
}

/**
 * A registry row → a seed candidate, or null when we cannot fingerprint it
 * honestly. Fingerprints come from @surex/core (`canonicalise` + `fingerprintOf`);
 * this file never reimplements SXF-1.
 */
export function toCandidate(row) {
  const s = row.server;
  const packages = (s.packages ?? []).filter((p) => RUNNER_FOR[p.registryType]);
  if (!packages.length) return null;

  // One entry per server, not per package: prefer npm (the runner most configs
  // use and the only one with an integrity digest for Tier A), then pypi, then oci.
  const order = ['npm', 'pypi', 'oci'];
  packages.sort((a, b) => order.indexOf(a.registryType) - order.indexOf(b.registryType));
  const pkg = packages[0];

  const configs = configsForPackage(pkg);
  if (!configs?.unpinned) return null;

  const canonical = canonicalise(configs.unpinned);
  if (!canonical.package?.name) return null;

  // The canonical package name must be the package the registry named. When it is
  // not, the command was composed wrong (see argValues) and the fingerprint is one
  // no real config can produce — a dead entry that inflates the registry.
  const identifierStem = String(pkg.identifier).split(':')[0];
  if (!identifierStem.includes(canonical.package.name) && !canonical.package.name.includes(identifierStem)) {
    return null;
  }

  const fingerprint = fingerprintOf(canonical);
  const tier = tierOf(canonical);

  let pinned = null;
  if (configs.pinned) {
    const pinnedCanonical = canonicalise(configs.pinned);
    pinned = {
      fingerprint: fingerprintOf(pinnedCanonical),
      canonical: pinnedCanonical,
      tier: tierOf(pinnedCanonical),
      seeded: false, // recorded as an alias only — no entity exists for it yet
    };
  }

  return {
    fingerprint,
    // The runnable identity, which is what a user recognises in a block message —
    // not the registry's reverse-DNS server name.
    name: canonical.package.version === 'unpinned'
      ? canonical.package.name
      : `${canonical.package.name}@${canonical.package.version}`,
    registryName: s.name,
    title: s.title ?? null,
    // The server's OWN words, quoted verbatim. Not SureX copy — see entities.mjs.
    description: s.description ?? null,
    websiteUrl: s.websiteUrl ?? null,
    version: s.version ?? null,
    tier,
    canonical,
    canonicalConfig: configs.unpinned,
    pinned,
    pkg: {
      registryType: pkg.registryType,
      identifier: pkg.identifier,
      version: pkg.version ?? null,
      transport: pkg.transport?.type ?? 'stdio',
    },
    repo: s.repository ? { url: s.repository.url, source: s.repository.source ?? null } : null,
    publishedAt: row.meta?.publishedAt ?? null,
    updatedAt: row.meta?.updatedAt ?? null,
    seedSource: 'mcp-registry:v0/servers?version=latest',
  };
}

/** The reverse-DNS namespace a server was published under, e.g. `ai.acme`. */
export function publisherOf(candidate) {
  const name = String(candidate.registryName ?? '');
  const at = name.indexOf('/');
  return at === -1 ? name : name.slice(0, at);
}

/**
 * Crawl → candidates, deduplicated by fingerprint.
 *
 * `requireRepo` defaults true: the licence gate's fallback path needs a repository,
 * and an entry with no licence signal can only ever be written `unreviewable`.
 *
 * `maxPerPublisher` caps namespace skew — the registry is ordered alphabetically,
 * and one publisher's bulk-published near-identical servers took 18 of 50 rows on a
 * first pass. The raw skew is reported in `stats` rather than smuggled into the data.
 */
export async function collectCandidates({
  target = 50,
  requireRepo = true,
  maxPerPublisher = 3,
  log = () => {},
} = {}) {
  const { rows, pages, exhausted } = await crawlRegistry({
    want: Math.max(target * 14, 400),
    maxPages: 30,
    log,
  });
  const seen = new Set();
  const perPublisher = new Map();
  const candidates = [];
  const overflow = [];
  let skippedNoPackage = 0;
  let skippedNoRepo = 0;
  let skippedPublisherCap = 0;

  for (const row of rows) {
    const candidate = toCandidate(row);
    if (!candidate) {
      skippedNoPackage += 1;
      continue;
    }
    if (requireRepo && !candidate.repo?.url) {
      skippedNoRepo += 1;
      continue;
    }
    if (seen.has(candidate.fingerprint)) continue;
    seen.add(candidate.fingerprint);

    const publisher = publisherOf(candidate);
    const count = perPublisher.get(publisher) ?? 0;
    if (count >= maxPerPublisher) {
      skippedPublisherCap += 1;
      // Kept aside rather than discarded: if the crawl cannot reach `target`
      // otherwise, a lopsided seed still beats a short one.
      overflow.push(candidate);
      continue;
    }
    perPublisher.set(publisher, count + 1);
    candidates.push(candidate);
    if (candidates.length >= target) break;
  }

  let backfilled = 0;
  while (candidates.length < target && overflow.length) {
    candidates.push(overflow.shift());
    backfilled += 1;
  }

  return {
    candidates,
    stats: {
      rowsSeen: rows.length,
      pages,
      exhausted,
      skippedNoPackage,
      skippedNoRepo,
      skippedPublisherCap,
      backfilledFromCap: backfilled,
      publishers: perPublisher.size,
    },
  };
}
