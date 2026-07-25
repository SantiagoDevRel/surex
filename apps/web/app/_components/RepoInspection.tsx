'use client';

import { COPY } from '@/lib/copy.ts';
import type { RepoInspection as Inspection } from '@/lib/github.ts';

import { Banner } from './Banner.tsx';

/**
 * What we could read about the pasted repository, shown before anything is
 * submitted.
 *
 * Three outcomes, kept apart on the screen because they are not the same claim:
 *
 *   confirmed     an MCP signal was READ, and it is quoted
 *   not an MCP    the manifests were read and contain no signal — a refusal
 *   undetermined  GitHub did not answer — NOT a refusal, and it says so
 *
 * The last one exists because collapsing it into the second would tell a
 * maintainer their MCP server is not an MCP server on the strength of a rate
 * limit. Same rule as the licence gate (FRICTION-LOG D10).
 */
export function RepoInspection({ state }: { state: Inspection | 'loading' | null }) {
  if (!state) return null;
  if (state === 'loading') {
    return <p className="text-meta mt-2 text-faint">{COPY.submit.inspecting}</p>;
  }
  if (!state.ref) return null;

  const { mcp, release } = state;

  if (mcp?.undetermined) {
    return (
      <div className="mt-2.5">
        <Banner tone="stale" label={COPY.submit.inspectUnknownLabel}>
          {COPY.submit.inspectUnknownBody}
          {state.problems.length ? ` (${state.problems[0]})` : null}
        </Banner>
      </div>
    );
  }

  if (mcp && !mcp.isMcp) {
    return (
      <div className="mt-2.5">
        <Banner tone="flagged" label={COPY.submit.inspectMcpNo}>
          {COPY.submit.inspectMcpNoBody}
        </Banner>
      </div>
    );
  }

  return (
    <div className="mt-2.5 grid gap-1.5">
      <p className="text-meta text-clean">
        {COPY.submit.inspectMcpYes}
        {mcp?.signal ? ` — ${mcp.detail}` : null}
      </p>
      {release ? (
        <div className="text-meta text-ink-3">
          <span className="text-label uppercase text-faint">{COPY.submit.inspectPinnedLabel}</span>{' '}
          <span className="text-data text-ink">{release.tag || '—'}</span>
          {release.sha ? (
            <>
              {' · '}
              <span className="text-data text-ink" title={release.sha}>{release.sha.slice(0, 12)}</span>
            </>
          ) : null}
          <p className="mt-1 max-w-[80ch]">
            {release.sha ? COPY.submit.inspectShaNote : COPY.submit.inspectNoShaNote}
          </p>
        </div>
      ) : null}
    </div>
  );
}
