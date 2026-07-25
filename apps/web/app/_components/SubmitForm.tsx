'use client';

import { useActionState } from 'react';

import { COPY } from '@/lib/copy.ts';
import { submitRelease, type SubmitOutcome } from '@/lib/submit-action.ts';

import { Banner, type BannerTone } from './Banner.tsx';
import { Panel, SectionLabel } from './Panel.tsx';

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
      : outcome.kind === 'refused'
        ? {
            tone: 'flagged',
            label: `${COPY.submit.resultRefusedLabel} · HTTP ${outcome.status}`,
            body: [outcome.code, outcome.message].filter(Boolean).join(' — ') || 'no reason given',
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

  return (
    <Panel className="px-5 py-4">
      <SectionLabel>{COPY.submit.formLabel}</SectionLabel>

      <form action={action} className="mt-3.5 grid gap-3">
        <label className="grid gap-1.5">
          <span className="text-label uppercase text-faint">{COPY.submit.repoLabel}</span>
          <input
            name="repo"
            placeholder={COPY.submit.repoPlaceholder}
            className="rounded-input border border-line bg-panel-2 px-3 py-2 text-data text-ink placeholder:text-faint"
          />
        </label>

        <label className="grid gap-1.5">
          <span className="text-label uppercase text-faint">{COPY.submit.releaseLabel}</span>
          <input
            name="release"
            placeholder={COPY.submit.releasePlaceholder}
            className="rounded-input border border-line bg-panel-2 px-3 py-2 text-data text-ink placeholder:text-faint"
          />
        </label>

        <button
          type="submit"
          disabled={pending}
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
