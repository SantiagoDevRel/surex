import { COPY } from '@/lib/copy.ts';
import { isoDate } from '@/lib/format.ts';
import type { Entry } from '@/lib/types.ts';

import { Panel, PanelHeader, SectionLabel } from './Panel.tsx';

/**
 * The disclosure obligation, as a panel. PRD §6, AGENTS.md §4.
 *
 * Every verdict shown in full states what was reviewed (commit + blob ID),
 * when, by which model and prompt version — and that it was automated with no
 * human audit. That last line is not a disclaimer at the bottom of the page; it
 * is part of the record, so it sits inside the panel that carries the record.
 *
 * A field with no value reads "not recorded". It never falls back to something
 * plausible.
 */

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-line-2 py-1.5">
      <span className="w-[110px] shrink-0 text-label uppercase tracking-[0.12em] text-faint">
        {label}
      </span>
      <span className="break-all text-data text-ink-2">{value || COPY.verdict.provenanceUnknown}</span>
    </div>
  );
}

export function Provenance({ entry }: { entry: Entry }) {
  const { head, source, review } = entry;
  const promptVersion = review?.promptVersion ?? head.promptVersion;
  const promptValue = promptVersion
    ? `${promptVersion}${review?.agreementRuns ? ` · ${review.agreementRuns} passes` : ''}`
    : null;
  return (
    <Panel>
      <PanelHeader>
        <SectionLabel>{COPY.verdict.provenanceLabel}</SectionLabel>
      </PanelHeader>

      <div className="grid gap-x-8 px-5 pb-3 pt-1.5 sm:grid-cols-2">
        <Row label={COPY.verdict.provenanceCommit} value={source?.commit ?? head.reviewedCommit} />
        <Row
          label={COPY.verdict.provenanceReviewed}
          value={review?.analyzedAt ?? isoDate(head.reviewedAt ?? head.updatedAt)}
        />
        <Row label={COPY.verdict.provenanceSourceBlob} value={source?.blob?.blobId ?? head.evidence?.blobId} />
        <Row label={COPY.verdict.provenanceModel} value={review?.modelId ?? head.modelId} />
        <Row label={COPY.verdict.provenancePrompt} value={promptValue} />
        <Row label={COPY.verdict.provenanceIntegrity} value={head.integrity} />
        <Row label={COPY.verdict.provenanceIndex} value={head.arkivEntityKey} />
        <Row label="VERDICT BLOB" value={review?.blob?.blobId} />
      </div>

      <div className="border-t border-line px-5 py-2.5 text-row text-ink-2">
        {COPY.verdict.automatedDisclosure}
      </div>
    </Panel>
  );
}
