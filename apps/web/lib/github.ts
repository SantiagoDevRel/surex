/**
 * Reading a submitted repository, from the browser, read-only.
 *
 * Two jobs, and they are separate on purpose:
 *
 *  1. **Pin the bytes.** A submission names a release. A tag is a moving label —
 *     it can be deleted and repointed — so the tag alone can only ever earn
 *     Tier B ("same version string, the bytes were never compared"). The commit
 *     SHA the tag resolves to is immutable, and that is what makes a higher tier
 *     reachable at all. So both are captured, and the SHA is the one that matters.
 *
 *  2. **Refuse what is not an MCP server.** SureX reviews MCP servers against
 *     what they declare. A repository that is not one has nothing for the review
 *     to compare, and accepting it would put a verdict in the registry about a
 *     question nobody asked.
 *
 * **A failed request is never a "no".** This is the same rule the licence gate
 * had to learn the hard way (FRICTION-LOG D10): GitHub rate-limits unauthenticated
 * browsers at 60 requests an hour, and if a 403 were read as "no MCP signals
 * found", the form would tell a maintainer their MCP server is not an MCP server.
 * Every negative here is either an answer or explicitly `undetermined`.
 */

export interface RepoRef {
  owner: string;
  repo: string;
}

/**
 * Accepts what people actually paste: a full URL, with or without scheme, with or
 * without `.git`, with or without a trailing path or query, and the bare
 * `owner/repo` form.
 */
export function parseRepo(input: string): RepoRef | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;

  const withoutScheme = raw.replace(/^[a-z]+:\/\//i, '').replace(/^git@github\.com:/i, 'github.com/');
  const path = withoutScheme.startsWith('github.com/')
    ? withoutScheme.slice('github.com/'.length)
    : withoutScheme.includes('/') && !withoutScheme.includes('.')
      ? withoutScheme
      : null;
  if (!path) return null;

  const [owner, repoRaw] = path.split(/[/?#]/).filter(Boolean);
  if (!owner || !repoRaw) return null;
  const repo = repoRaw.replace(/\.git$/i, '');

  // GitHub's own rules, so a typo fails here rather than as a confusing 404.
  if (!/^[A-Za-z0-9-]+$/.test(owner)) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(repo)) return null;
  return { owner, repo };
}

export interface McpEvidence {
  /** True only when a positive signal was READ. */
  isMcp: boolean;
  /** Null when nothing could be read — never conflate with `isMcp: false`. */
  undetermined: boolean;
  /** The specific thing that decided it, quoted, so the answer is checkable. */
  signal: string | null;
  detail: string;
}

/** What a file the detector wants looks like once fetched. */
export interface FetchedFile {
  path: string;
  text: string | null;
  /** Set when the file could not be read for a reason that is not "absent". */
  unreachable?: boolean;
}

/** The files worth looking at, in the order they decide the question. */
export const MCP_PROBE_PATHS = [
  'package.json',
  'server.json',
  'pyproject.toml',
  'requirements.txt',
  '.well-known/mcp.json',
] as const;

const JS_SDK = /@modelcontextprotocol\/(sdk|server-)/;
const JS_FRAMEWORKS = /(^|[^\w-])(fastmcp|mcp-framework|xmcp|mcp-handler|@smithery\/sdk)([^\w-]|$)/;
const PY_MCP = /^\s*["']?(mcp|fastmcp|mcp-server[\w-]*)\b/m;

/**
 * Decide whether a repository contains an MCP server, from its manifests.
 *
 * Deterministic and pure — no model, no network. A dependency on the MCP SDK is
 * not a heuristic: a server that speaks the protocol imports something that
 * implements it. The DGX is not needed for this and would be worse at it: it
 * would be slower, non-deterministic, and unable to point at the line that
 * decided.
 */
export function detectMcp(files: FetchedFile[]): McpEvidence {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const read = (p: string) => byPath.get(p)?.text ?? null;

  const pkgText = read('package.json');
  if (pkgText) {
    let pkg: Record<string, unknown> = {};
    try {
      pkg = JSON.parse(pkgText) as Record<string, unknown>;
    } catch {
      // A package.json we cannot parse is not evidence either way.
    }
    const deps = Object.keys({
      ...(pkg.dependencies as object ?? {}),
      ...(pkg.devDependencies as object ?? {}),
      ...(pkg.peerDependencies as object ?? {}),
    });
    const sdk = deps.find((d) => JS_SDK.test(d));
    if (sdk) {
      return { isMcp: true, undetermined: false, signal: sdk, detail: `package.json depends on ${sdk}` };
    }
    const framework = deps.find((d) => JS_FRAMEWORKS.test(d));
    if (framework) {
      return { isMcp: true, undetermined: false, signal: framework, detail: `package.json depends on ${framework}` };
    }
    const keywords = Array.isArray(pkg.keywords) ? (pkg.keywords as unknown[]).map(String) : [];
    const keyword = keywords.find((k) => /^(mcp|modelcontextprotocol|model-context-protocol)$/i.test(k));
    if (keyword) {
      return { isMcp: true, undetermined: false, signal: keyword, detail: `package.json declares the "${keyword}" keyword` };
    }
  }

  // The official MCP registry manifest. Its presence is a declaration.
  const serverJson = read('server.json') ?? read('.well-known/mcp.json');
  if (serverJson && /"(mcpVersion|packages|remotes|\$schema)"/.test(serverJson) && /mcp/i.test(serverJson)) {
    return { isMcp: true, undetermined: false, signal: 'server.json', detail: 'an MCP server manifest is present at the repository root' };
  }

  for (const path of ['pyproject.toml', 'requirements.txt']) {
    const text = read(path);
    if (text && PY_MCP.test(text)) {
      return { isMcp: true, undetermined: false, signal: path, detail: `${path} depends on the Python MCP package` };
    }
  }

  // Nothing found. Was that an answer?
  const anyRead = files.some((f) => f.text !== null);
  const anyUnreachable = files.some((f) => f.unreachable);
  if (!anyRead) {
    return {
      isMcp: false,
      undetermined: true,
      signal: null,
      detail: anyUnreachable
        ? 'none of the repository manifests could be read — this is not a statement about the repository'
        : 'no manifest was found to read',
    };
  }
  return {
    isMcp: false,
    undetermined: false,
    signal: null,
    detail: 'no MCP SDK dependency, framework, manifest or keyword in the repository manifests',
  };
}

// ---------------------------------------------------------------------------
// the network half
// ---------------------------------------------------------------------------

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

export interface ReleaseRef {
  tag: string;
  /** The commit the tag resolves to. Immutable; this is what pins the bytes. */
  sha: string | null;
  /** `release` | `tag` | `default-branch` — what we actually found. */
  source: string;
}

export interface RepoInspection {
  ref: RepoRef | null;
  release: ReleaseRef | null;
  mcp: McpEvidence | null;
  /** Human-readable reasons things could not be read. Never silently dropped. */
  problems: string[];
}

async function getJson(url: string, fetchImpl: typeof fetch, problems: string[]): Promise<any | null> {
  try {
    const res = await fetch_(url, fetchImpl);
    if (res.status === 404) return null; // an answer
    if (!res.ok) {
      problems.push(res.status === 403
        ? 'GitHub rate-limited this browser (60 requests an hour without a token)'
        : `GitHub answered ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    problems.push(`could not reach GitHub (${(err as Error)?.name ?? 'network error'})`);
    return null;
  }
}

function fetch_(url: string, fetchImpl: typeof fetch) {
  return fetchImpl(url, { headers: { accept: 'application/vnd.github+json' } });
}

/**
 * The latest release, and the commit it points at.
 *
 * Falls back through release → newest tag → default branch, and always says which
 * of the three it used, because they are not equally strong: only the first two
 * name a version at all, and a default-branch HEAD is a moving target that cannot
 * anchor a verdict.
 */
export async function latestRelease(
  ref: RepoRef,
  fetchImpl: typeof fetch,
  problems: string[],
): Promise<ReleaseRef | null> {
  const { owner, repo } = ref;

  const release = await getJson(`${API}/repos/${owner}/${repo}/releases/latest`, fetchImpl, problems);
  const tagFromRelease = release?.tag_name ? String(release.tag_name) : null;

  let tag = tagFromRelease;
  let source = 'release';
  if (!tag) {
    const tags = await getJson(`${API}/repos/${owner}/${repo}/tags?per_page=1`, fetchImpl, problems);
    if (Array.isArray(tags) && tags.length) {
      tag = String(tags[0].name);
      source = 'tag';
    }
  }

  // Resolving the ref to a commit is a separate call on purpose: `/commits/<ref>`
  // dereferences an annotated tag object to the commit it wraps, which the tags
  // endpoint does not do reliably.
  const target = tag ?? 'HEAD';
  const commit = await getJson(`${API}/repos/${owner}/${repo}/commits/${encodeURIComponent(target)}`, fetchImpl, problems);
  const sha = commit?.sha ? String(commit.sha) : null;

  if (!tag && !sha) return null;
  return { tag: tag ?? '', sha, source: tag ? source : 'default-branch' };
}

/** Fetch the manifests the MCP detector reads, at a specific ref. */
export async function fetchManifests(
  ref: RepoRef,
  atRef: string,
  fetchImpl: typeof fetch,
  problems: string[],
): Promise<FetchedFile[]> {
  const results: FetchedFile[] = [];
  for (const path of MCP_PROBE_PATHS) {
    const url = `${RAW}/${ref.owner}/${ref.repo}/${encodeURIComponent(atRef)}/${path}`;
    try {
      const res = await fetchImpl(url);
      if (res.status === 404) {
        results.push({ path, text: null });
        continue;
      }
      if (!res.ok) {
        results.push({ path, text: null, unreachable: true });
        problems.push(`${path}: GitHub answered ${res.status}`);
        continue;
      }
      results.push({ path, text: await res.text() });
    } catch {
      results.push({ path, text: null, unreachable: true });
    }
  }
  return results;
}

/**
 * Everything the form needs about a pasted repository, in one call.
 * `fetchImpl` is injectable so the whole thing is testable without a network.
 */
export async function inspectRepo(
  input: string,
  { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {},
): Promise<RepoInspection> {
  const problems: string[] = [];
  const ref = parseRepo(input);
  if (!ref) return { ref: null, release: null, mcp: null, problems };

  const release = await latestRelease(ref, fetchImpl, problems);
  // Read the manifests at the exact commit when we have one: the answer should be
  // about the bytes that would be reviewed, not about whatever main looks like.
  const at = release?.sha ?? release?.tag ?? 'HEAD';
  const files = await fetchManifests(ref, at, fetchImpl, problems);
  return { ref, release, mcp: detectMcp(files), problems };
}
