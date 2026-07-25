import { isFingerprint } from '@surex/core';
import Link from 'next/link';

import { getDispute } from '@/lib/api.ts';
import { COPY } from '@/lib/copy.ts';
import type { DisputeStatus } from '@/lib/types.ts';

import { Banner, type BannerTone } from '../../_components/Banner.tsx';
import { StateChip } from '../../_components/Chip.tsx';
import { ClaimCard } from '../../_components/ClaimCard.tsx';
import { DisputeTimeline } from '../../_components/DisputeTimeline.tsx';
import { FingerprintBar } from '../../_components/FingerprintBar.tsx';
import { Footer } from '../../_components/Footer.tsx';
import { IllustrativeBanner } from '../../_components/IllustrativeBanner.tsx';
import { StandingPanels } from '../../_components/StandingPanels.tsx';

export const dynamic = 'force-dynamic';

const STAGE: Record<DisputeStatus, { label: string; body: string; tone: BannerTone }> = {
  open: { label: COPY.dispute.stageOpen, body: COPY.dispute.stageOpenBody, tone: 'neutral' },
  under_review: {
    label: COPY.dispute.stageReview,
    body: COPY.dispute.stageReviewBody,
    tone: 'disputed',
  },
  upheld: { label: COPY.dispute.stageUpheld, body: COPY.dispute.stageUpheldBody, tone: 'flagged' },
  overturned: {
    label: COPY.dispute.stageOverturned,
    body: COPY.dispute.stageOverturnedBody,
    tone: 'clean',
  },
};

export default async function DisputePage({ params }: { params: Promise<{ fp: string }> }) {
  const { fp } = await params;
  const decoded = decodeURIComponent(fp);

  if (!isFingerprint(decoded)) {
    return (
      <main className="mx-auto max-w-[1020px] px-7 pb-20 pt-9">
        <h1 className="text-title font-semibold">{COPY.errors.badFingerprint}</h1>
        <p className="mt-2 max-w-[70ch] font-serif text-prose text-ink-2">
          {COPY.errors.badFingerprintBody}
        </p>
        <Link href="/" className="mt-4 inline-block text-row text-accent">
          ← {COPY.browse.title}
        </Link>
      </main>
    );
  }

  const result = await getDispute(decoded);
  const dispute = result.data;

  if (!dispute) {
    return (
      <>
        <IllustrativeBanner
          origin={result.origin}
          illustrative={result.illustrative}
          note={result.note}
        />
        <main className="mx-auto max-w-[1020px] px-7 pb-20 pt-7">
          <FingerprintBar prefix="surex.dev/d/" fingerprint={decoded} />
          <h1 className="mt-6 text-title font-semibold text-ink-3">
            {COPY.dispute.notFoundTitle}
          </h1>
          <p className="mt-2 max-w-[74ch] font-serif text-prose-lg text-ink-2">
            {COPY.dispute.notFoundBody}
          </p>
          <Link href={`/r/${decoded}`} className="mt-4 inline-block text-row text-accent">
            ← read the verdict
          </Link>
          <StandingPanels fingerprint={decoded} />
          <Footer />
        </main>
      </>
    );
  }

  const stage = STAGE[dispute.status];
  const stageNote =
    dispute.status === 'open' || dispute.status === 'under_review'
      ? dispute.closesAt
        ? `window closes ${dispute.closesAt}`
        : undefined
      : dispute.closedAt
        ? `closed ${dispute.closedAt}`
        : undefined;

  return (
    <>
      <IllustrativeBanner
        origin={result.origin}
        illustrative={result.illustrative}
        note={result.note}
      />

      <main className="mx-auto max-w-[1020px] px-7 pb-20 pt-7">
        <FingerprintBar prefix="surex.dev/d/" fingerprint={dispute.fingerprint} />

        {result.origin === 'fixture' ? (
          <div className="mt-3.5">
            <Banner tone="stale" label={COPY.banners.unreachableLabel}>
              {COPY.banners.unreachableBody}
            </Banner>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap items-baseline gap-x-3.5 gap-y-2">
          <h1 className="text-title font-semibold">
            {COPY.dispute.title} {dispute.subject}{' '}
            <span className="font-normal text-ink-3">{dispute.version}</span>
          </h1>
          <StateChip state="disputed" />
          <span className="text-mini text-ink-3">
            {COPY.dispute.openedBy} {dispute.openedAt} by {dispute.contestant}
          </span>
        </div>

        <DisputeTimeline status={dispute.status} note={stageNote} />

        <div className="mt-4">
          <Banner tone={stage.tone} label={stage.label}>
            {stage.body}
          </Banner>
        </div>

        <div className="mt-5 grid gap-3.5 md:grid-cols-2">
          <ClaimCard claim={dispute.accusation} kind="accusation" />
          <ClaimCard claim={dispute.rebuttal} kind="rebuttal" badge="EQUAL WEIGHT" />
        </div>

        <p className="mt-2.5 px-1 text-meta text-ink-3">
          {COPY.verdict.bothStand}{' '}
          <Link href={`/r/${dispute.fingerprint}`} className="text-accent">
            read the verdict in full →
          </Link>
        </p>

        <StandingPanels fingerprint={dispute.fingerprint} />
        <Footer />
      </main>
    </>
  );
}
