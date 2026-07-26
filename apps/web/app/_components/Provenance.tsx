import { COPY } from '@/lib/copy.ts';
import { ensAppUrl, ensNameFor } from '@/lib/ens.ts';
import { isoDate } from '@/lib/format.ts';
import type { Entry } from '@/lib/types.ts';

import { Panel, PanelHeader, SectionLabel } from './Panel.tsx';

// The disclosure obligation, as a panel (PRD §6, AGENTS.md §4). A field with
// no value reads "not recorded" — it never falls back to something plausible.

function Row({ label, value, href }: { label: string; value?: string | null; href?: string }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-line-2 py-1.5">
      <span className="w-[110px] shrink-0 text-label uppercase tracking-[0.12em] text-faint">
        {label}
      </span>
      {value && href ? (
        <a
          className="break-all text-data text-ink-2 underline decoration-line underline-offset-2 hover:text-ink"
          href={href}
          target="_blank"
          rel="noreferrer"
        >
          {value}
        </a>
      ) : (
        <span className="break-all text-data text-ink-2">{value || COPY.verdict.provenanceUnknown}</span>
      )}
    </div>
  );
}

export function Provenance({ entry }: { entry: Entry }) {
  const { head, source, review } = entry;
  const promptVersion = review?.promptVersion ?? head.promptVersion;
  const promptValue = promptVersion
    ? `${promptVersion}${review?.agreementRuns ? ` · ${review.agreementRuns} passes` : ''}`
    : null;
  // `null` until a parent name is configured; the row is omitted entirely
  // rather than rendered as "not recorded".
  const ensName = ensNameFor(head.fingerprint);
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
        {/* URLs arrive already built from `apps/api/src/links.mjs`; `href`
            undefined renders as plain text — an absent link, not a formatting
            choice. Source and verdict blobs take links from their OWN records,
            since they're different blobs on Walrus. */}
        <Row
          label={COPY.verdict.provenanceSourceBlob}
          value={source?.blob?.blobId ?? head.evidence?.blobId}
          href={source?.links?.blob ?? head.links?.blob}
        />
        <Row label={COPY.verdict.provenanceModel} value={review?.modelId ?? head.modelId} />
        <Row label={COPY.verdict.provenancePrompt} value={promptValue} />
        <Row label={COPY.verdict.provenanceIntegrity} value={head.integrity} />
        <Row
          label={COPY.verdict.provenanceIndex}
          value={head.arkivEntityKey}
          href={head.links?.arkivEntity}
        />
        <Row label="VERDICT BLOB" value={review?.blob?.blobId} href={review?.links?.blob} />
        {/* Sui rows appear only when our own wallet registered the blob — in
            publisher mode the record carries no `suiObjectId`. */}
        {source?.links?.suiObject || review?.links?.suiObject ? (
          <Row
            label="SUI OBJECT"
            value={source?.blob?.suiObjectId ?? review?.blob?.suiObjectId}
            href={source?.links?.suiObject ?? review?.links?.suiObject}
          />
        ) : null}
        {source?.links?.certifyTx || review?.links?.certifyTx ? (
          <Row
            label="CERTIFY TX"
            value={source?.blob?.certifyTx ?? review?.blob?.certifyTx}
            href={source?.links?.certifyTx ?? review?.links?.certifyTx}
          />
        ) : null}
        {ensName ? (
          <Row label={COPY.verdict.provenanceEns} value={ensName} href={ensAppUrl(ensName)} />
        ) : null}
      </div>

      {ensName ? (
        <div className="border-t border-line px-5 py-2.5 text-row text-ink-2">
          {COPY.verdict.ensNote}{' '}
          <code className="whitespace-nowrap text-data text-ink">{COPY.verdict.ensExample}</code>
        </div>
      ) : null}

      <div className="border-t border-line px-5 py-2.5 text-row text-ink-2">
        {COPY.verdict.automatedDisclosure}
      </div>
    </Panel>
  );
}
