'use client';

import type { IDKitResult } from '@worldcoin/idkit';
import { useActionState, useCallback, useRef, useState } from 'react';

import { COPY } from '@/lib/copy.ts';
import {
  inspectRepo,
  parseRepo,
  resolveCommit,
  type ReleaseRef,
  type RepoInspection as Inspection,
} from '@/lib/github.ts';
import { submitRelease, type SubmitOutcome } from '@/lib/submit-action.ts';
import type { FlowStep, WorldCredential, WorldPhase } from '@/lib/submission.ts';

import { Banner, type BannerTone } from './Banner.tsx';
import { Panel, SectionLabel } from './Panel.tsx';
import { RepoInspection } from './RepoInspection.tsx';
import { StageRail } from './StageRail.tsx';
import { SubmissionMonitor, useSubmissionWatch } from './SubmissionMonitor.tsx';
import { WorldIdProof } from './WorldIdProof.tsx';

const INITIAL: SubmitOutcome = { kind: 'idle' };

function Outcome({ outcome }: { outcome: SubmitOutcome }) {
  if (outcome.kind === 'idle') return null;

  const view: { tone: BannerTone; label: string; body: string } =
    outcome.kind === 'accepted'
      ? {
          tone: 'clean',
          label: COPY.submit.resultAcceptedLabel,
          body: outcome.detail ?? COPY.submit.resultAcceptedBody,
        }
      : outcome.kind === 'notBuilt'
        ? {
            // Not a failure and not a success — proof checked, pipeline behind the gate doesn't exist.
            tone: 'stale',
            label: COPY.submit.resultNotBuiltLabel,
            body: [COPY.submit.resultNotBuiltBody, outcome.detail].filter(Boolean).join(' — '),
          }
        : outcome.kind === 'refused'
          ? {
              tone: 'flagged',
              label: `${COPY.submit.resultRefusedLabel} · HTTP ${outcome.status}`,
              body:
                [outcome.code, outcome.message, outcome.detail].filter(Boolean).join(' — ') || 'no reason given',
            }
          : outcome.kind === 'unreachable'
            ? {
                tone: 'stale',
                label: COPY.submit.resultUnreachableLabel,
                body: `${COPY.submit.resultUnreachableBody} (${outcome.detail})`,
              }
            : {
                tone: 'neutral',
                label: COPY.submit.resultMissingLabel,
                body: COPY.submit.resultMissingBody,
              };

  return (
    <div className="mt-3.5">
      <Banner tone={view.tone} label={view.label}>
        {view.body}
      </Banner>
    </div>
  );
}

/**
 * World is step one of the same sequence the pipeline finishes, so this
 * component owns both halves. `useSubmissionWatch` is called here, not inside
 * the monitor, because the flow has to be on screen from first paint — a hook
 * that only runs once a submission exists can't feed it.
 */
export function SubmitForm() {
  const [outcome, action, pending] = useActionState(submitRelease, INITIAL);
  const [repo, setRepo] = useState('');
  const [release, setRelease] = useState('');
  const [commit, setCommit] = useState('');
  const [releases, setReleases] = useState<ReleaseRef[]>([]);
  const [proof, setProof] = useState<IDKitResult | null>(null);
  const [inspection, setInspection] = useState<Inspection | 'loading' | null>(null);
  /** Step one, reported by the widget. There is no run to poll it out of. */
  const [world, setWorld] = useState<{ phase: WorldPhase; credential: WorldCredential | null }>({
    phase: 'idle',
    credential: null,
  });
  /** `null` (default and reset state) means the panel follows the flow;
   *  choosing the same tile again clears the pick. */
  const [picked, setPicked] = useState<FlowStep | null>(null);

  // `accepted` without an id is still an acceptance, but there's nothing to watch.
  const submissionId = outcome.kind === 'accepted' ? outcome.submissionId ?? null : null;
  const watch = useSubmissionWatch(submissionId);

  const onWorldPhase = useCallback((phase: WorldPhase, credential: WorldCredential | null) => {
    setWorld({ phase, credential });
    setPicked(null);
  }, []);
  // Only the newest inspection may write state — a slow early request must not
  // land after a fast later one and repaint with a stale repo's answer.
  const inspectionId = useRef(0);

  async function inspect(value: string) {
    const ref = parseRepo(value);
    if (!ref) {
      setInspection(null);
      return;
    }
    const id = inspectionId.current + 1;
    inspectionId.current = id;
    setInspection('loading');
    const result = await inspectRepo(value);
    if (inspectionId.current !== id) return;
    setInspection(result);
    setReleases(result.releases ?? []);
    const first = result.releases?.[0] ?? result.release ?? null;
    setRelease(first?.tag ?? '');
    setCommit(first?.sha ?? '');
  }

  // The list is fetched with SHAs unresolved on purpose — GitHub's unauthenticated
  // rate limit can't afford resolving all of them, so the cost is paid here, on
  // the one release actually chosen.
  async function pickRelease(tag: string) {
    setRelease(tag);
    const known = releases.find((r) => r.tag === tag);
    setCommit(known?.sha ?? '');
    const ref = parseRepo(repo);
    if (!ref || known?.sha) return;
    const id = inspectionId.current;
    const sha = await resolveCommit(ref, tag);
    // Ignore a late answer for a version the user has already moved off.
    if (inspectionId.current === id) setCommit(sha ?? '');
  }

  // `undetermined` (GitHub didn't reply) leaves the button enabled — refusing
  // on a rate limit would wrongly tell a maintainer their server isn't an MCP server.
  const refusedAsNotMcp = inspection !== null && inspection !== 'loading'
    && Boolean(inspection.mcp) && !inspection.mcp!.isMcp && !inspection.mcp!.undetermined;

  return (
    <div className="grid gap-5">
      <StageRail
        status={watch.status}
        trace={watch.trace}
        world={world.phase}
        credential={world.credential}
        picked={picked}
        onPick={(step) => setPicked((prev) => (prev === step ? null : step))}
      />

      <Panel className="px-5 py-4">
        <SectionLabel>{COPY.submit.formLabel}</SectionLabel>

        <form action={action} className="mt-3.5 grid gap-3">
          <label className="grid gap-1.5">
            <span className="text-label uppercase text-faint">{COPY.submit.repoLabel}</span>
            <input
              name="repo"
              value={repo}
              onChange={(e) => {
                // The signal is derived from the repository, so a proof bound to
                // the old one must be dropped.
                setRepo(e.target.value);
                if (proof) setProof(null);
                setInspection(null);
                setReleases([]);
                setRelease('');
                setCommit('');
              }}
              onBlur={(e) => void inspect(e.target.value)}
              onPaste={(e) => {
                // The pasted value isn't in the input yet.
                const pasted = e.clipboardData.getData('text');
                if (pasted) void inspect(pasted);
              }}
              placeholder={COPY.submit.repoPlaceholder}
              className="rounded-input border border-line bg-panel-2 px-3 py-2 text-data text-ink placeholder:text-faint"
            />
          </label>

          <RepoInspection state={inspection} />

          {/* Chosen from what the repository has, never typed — the repository
              is the only authority on which bytes exist. */}
          <label className="grid gap-1.5">
            <span className="text-label uppercase text-faint">{COPY.submit.releaseLabel}</span>
            <select
              value={release}
              onChange={(e) => void pickRelease(e.target.value)}
              disabled={!releases.length}
              className="rounded-input border border-line bg-panel-2 px-3 py-2 text-data text-ink disabled:text-faint"
            >
              {releases.length ? (
                releases.map((r) => (
                  <option key={r.tag || 'HEAD'} value={r.tag}>
                    {r.tag || COPY.submit.releaseDefaultBranch}
                    {r.source !== 'release' ? ` · ${r.source}` : ''}
                  </option>
                ))
              ) : (
                <option value="">{COPY.submit.releaseEmpty}</option>
              )}
            </select>
          </label>

          {/* Tag names the version a human recognises; commit is the bytes —
              a tag can be repointed or deleted, a commit cannot. */}
          <input type="hidden" name="release" value={release} />
          <input type="hidden" name="commit" value={commit} />

          <WorldIdProof
            context={{ action: 'maintainer-submit', repo }}
            onProof={setProof}
            onPhase={onWorldPhase}
            label={COPY.dispute.humanAction}
            disabled={!repo.trim()}
          />

          {/* The IDKit result travels to the server unmodified. */}
          <input type="hidden" name="proof" value={proof ? JSON.stringify(proof) : ''} />

          <button
            type="submit"
            disabled={pending || refusedAsNotMcp}
            className="justify-self-start rounded-input border border-accent bg-accent-t px-3.5 py-2 text-row font-semibold text-accent disabled:border-line-2 disabled:text-faint"
          >
            {pending ? 'queueing…' : COPY.submit.action}
          </button>
        </form>

        <p className="mt-3 max-w-[80ch] text-meta text-ink-3">{COPY.submit.worldIdNote}</p>

        <Outcome outcome={outcome} />
      </Panel>

      {/* Only for a submission the registry named — nothing to watch otherwise. */}
      {submissionId ? <SubmissionMonitor id={submissionId} {...watch} /> : null}
    </div>
  );
}
