'use client';

import type { IDKitResult } from '@worldcoin/idkit';
import { useActionState, useRef, useState } from 'react';

import { COPY } from '@/lib/copy.ts';
import { inspectRepo, parseRepo, type RepoInspection as Inspection } from '@/lib/github.ts';
import { submitRelease, type SubmitOutcome } from '@/lib/submit-action.ts';

import { Banner, type BannerTone } from './Banner.tsx';
import { Panel, SectionLabel } from './Panel.tsx';
import { RepoInspection } from './RepoInspection.tsx';
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
            // Not a failure and not a success. The proof was checked; the pipeline
            // behind the gate does not exist, and the screen says which is which.
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

export function SubmitForm() {
  const [outcome, action, pending] = useActionState(submitRelease, INITIAL);
  const [repo, setRepo] = useState('');
  const [release, setRelease] = useState('');
  const [proof, setProof] = useState<IDKitResult | null>(null);
  const [inspection, setInspection] = useState<Inspection | 'loading' | null>(null);
  /**
   * Only the newest inspection may write state. Typing a repository fires one
   * request per pause, and without this a slow early request can land after a
   * fast later one and repaint the form with an answer about a repository the
   * user has already replaced.
   */
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
    // Fill the tag, never overwrite what the maintainer typed themselves.
    if (result.release?.tag) setRelease((current) => current || result.release!.tag);
  }

  // The refusal is only ever on a READ answer. `undetermined` — GitHub did not
  // reply — leaves the button enabled, because refusing on a rate limit would
  // tell a maintainer their MCP server is not an MCP server.
  const refusedAsNotMcp = inspection !== null && inspection !== 'loading'
    && Boolean(inspection.mcp) && !inspection.mcp!.isMcp && !inspection.mcp!.undetermined;

  return (
    <Panel className="px-5 py-4">
      <SectionLabel>{COPY.submit.formLabel}</SectionLabel>

      <form action={action} className="mt-3.5 grid gap-3">
        <label className="grid gap-1.5">
          <span className="text-label uppercase text-faint">{COPY.submit.repoLabel}</span>
          <input
            name="repo"
            value={repo}
            onChange={(e) => {
              // The signal is derived from the repository, so changing it after
              // proving would leave a proof bound to a different repo. Drop it.
              setRepo(e.target.value);
              if (proof) setProof(null);
              setInspection(null);
            }}
            onBlur={(e) => void inspect(e.target.value)}
            onPaste={(e) => {
              // Paste is the common case and the value is not in the input yet.
              const pasted = e.clipboardData.getData('text');
              if (pasted) void inspect(pasted);
            }}
            placeholder={COPY.submit.repoPlaceholder}
            className="rounded-input border border-line bg-panel-2 px-3 py-2 text-data text-ink placeholder:text-faint"
          />
        </label>

        <RepoInspection state={inspection} />

        <label className="grid gap-1.5">
          <span className="text-label uppercase text-faint">{COPY.submit.releaseLabel}</span>
          <input
            name="release"
            value={release}
            onChange={(e) => setRelease(e.target.value)}
            placeholder={COPY.submit.releasePlaceholder}
            className="rounded-input border border-line bg-panel-2 px-3 py-2 text-data text-ink placeholder:text-faint"
          />
        </label>

        {/*
          The commit the tag resolved to, carried to the server alongside the tag.
          This is the field that decides how strongly a verdict can be linked to
          the bytes a user installs: a tag is a label that can be repointed, a
          commit is not.
        */}
        <input
          type="hidden"
          name="commit"
          value={inspection !== null && inspection !== 'loading' ? (inspection.release?.sha ?? '') : ''}
        />

        <div className="grid gap-1.5">
          <span className="text-label uppercase text-faint">{COPY.submit.stepHuman}</span>
          <WorldIdProof
            context={{ action: 'maintainer-submit', repo }}
            onProof={setProof}
            label={COPY.dispute.humanAction}
            disabled={!repo.trim()}
          />
        </div>

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
  );
}
