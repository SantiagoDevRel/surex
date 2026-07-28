import { BLOCKING_STATES, isFingerprint } from '@surex/core';
import Link from 'next/link';
import { Suspense } from 'react';

import { getEntry, getFindings } from '@/lib/api.ts';
import { COPY } from '@/lib/copy.ts';
import { splitName } from '@/lib/format.ts';
import type { Entry, Finding, RecordLinks } from '@/lib/types.ts';
import { evidenceExpiredOf, stateBanner } from '@/lib/verdict-view.ts';

import { ActionPanels, CleanMeans } from '../../_components/ActionPanels.tsx';
import { Banner } from '../../_components/Banner.tsx';
import { CapabilitySurface } from '../../_components/CapabilitySurface.tsx';
import { ClaimCard } from '../../_components/ClaimCard.tsx';
import { FindingCard, NoFindings } from '../../_components/FindingCard.tsx';
import { FingerprintBar } from '../../_components/FingerprintBar.tsx';
import { Footer } from '../../_components/Footer.tsx';
import { IllustrativeBanner } from '../../_components/IllustrativeBanner.tsx';
import { LinkagePanel } from '../../_components/LinkagePanel.tsx';
import { Panel, SectionLabel } from '../../_components/Panel.tsx';
import { Provenance } from '../../_components/Provenance.tsx';
import { VerdictHero } from '../../_components/VerdictHero.tsx';

/** Same reason as the registry list: the API may come up after the deploy. */
export const dynamic = 'force-dynamic';

const BLOCKS = BLOCKING_STATES as readonly string[];

interface FindingsProps {
  findings: Finding[];
  total: number;
  head: Entry['head'];
  blobId?: string;
  disputeHref: string;
}

function FindingList({ findings, total, head, blobId, disputeHref }: FindingsProps) {
  if (!findings.length) return <NoFindings state={head.state} reason={head.reason} />;
  return (
    <>
      {findings.map((finding, i) => (
        <FindingCard
          key={`${finding.file ?? 'finding'}:${finding.line ?? i}`}
          finding={finding}
          index={i + 1}
          total={total}
          state={head.state}
          blobId={blobId}
          disputeHref={disputeHref}
        />
      ))}
    </>
  );
}

/**
 * The certified blob did not answer.
 *
 * The count stays on screen and the list does not shrink to nothing: an entry
 * whose verdict rests on seven findings still says seven, and the two links are
 * the blob itself rather than this page's reading of it.
 */
function FindingsUnavailable({ links, error }: { links?: RecordLinks; error?: string }) {
  return (
    <Panel className="px-5 py-4">
      <SectionLabel>{COPY.verdict.findingsFailedLabel}</SectionLabel>
      <p className="mt-2 text-data text-ink-2">{COPY.verdict.findingsFailed}</p>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        {links?.blob ? (
          <a href={links.blob} className="text-row text-accent" rel="noreferrer noopener">
            {COPY.verdict.findingsFailedBlob} →
          </a>
        ) : null}
        {links?.suiObject ? (
          <a href={links.suiObject} className="text-row text-accent" rel="noreferrer noopener">
            {COPY.verdict.findingsFailedSui} →
          </a>
        ) : null}
      </div>
      {error ? <p className="mt-2.5 text-mini uppercase tracking-[0.1em] text-ink-3">{error}</p> : null}
    </Panel>
  );
}

/**
 * The whole list, once the certified blob arrives.
 *
 * Suspended rather than awaited by the page, so the verdict, the count and the
 * highest-severity finding are on screen while this is still in flight. The
 * fallback renders the same first card this does, so nothing moves under the
 * reader when it resolves.
 */
async function AllFindings({
  fp,
  shell,
  links,
  ...rest
}: FindingsProps & { fp: string; shell: Finding[]; links?: RecordLinks }) {
  const result = await getFindings(fp);
  if (result.loaded) {
    return (
      <FindingList {...rest} findings={result.items} total={Math.max(rest.total, result.items.length)} />
    );
  }
  return (
    <>
      <FindingList {...rest} findings={shell} />
      <FindingsUnavailable links={links} error={result.error} />
    </>
  );
}

export default async function VerdictPage({ params }: { params: Promise<{ fp: string }> }) {
  const { fp } = await params;
  const decoded = decodeURIComponent(fp);

  if (!isFingerprint(decoded)) {
    return (
      <main className="mx-auto max-w-[1020px] px-7 pb-20 pt-9">
        <h1 className="text-title font-semibold">{COPY.errors.badFingerprint}</h1>
        <p className="mt-2 max-w-[70ch] font-serif text-prose text-ink-2">
          {COPY.errors.badFingerprintBody}
        </p>
        <Link href="/registry" className="mt-4 inline-block text-row text-accent">
          ← {COPY.browse.title}
        </Link>
      </main>
    );
  }

  const result = await getEntry(decoded);
  const entry = result.data;

  /* Unreachable registry, so there is no entry to show and no fixture standing
     in for one. `notFound*` below would report absence of a verdict, which is a
     fact this page does not have: nothing was read.

     No illustrative band: it labels data that is not a real review, and this
     screen renders no data. The error is printed here instead. */
  if (!entry && result.origin === 'fixture') {
    return (
      <main className="mx-auto max-w-[1020px] px-7 pb-20 pt-9">
        <FingerprintBar prefix="surex.dev/r/" fingerprint={decoded} />
        <h1 className="mt-6 text-title font-semibold text-ink-3">
          {COPY.verdict.unreachableTitle}
        </h1>
        <p className="mt-2 max-w-[74ch] font-serif text-prose-lg text-ink-2">
          {COPY.verdict.unreachableBody}
        </p>
        {result.note ? (
          <p className="mt-3.5 text-mini uppercase tracking-[0.1em] text-ink-3">{result.note}</p>
        ) : null}
        <Link href="/registry" className="mt-4 inline-block text-row text-accent">
          ← {COPY.browse.title}
        </Link>
        <Footer />
      </main>
    );
  }

  /* Reachable registry, no entry. A real fact, and a different screen from a
     registry we could not reach — absence of a verdict is absence of
     knowledge, not a clean bill of health. */
  if (!entry) {
    return (
      <>
        <IllustrativeBanner
          origin={result.origin}
          illustrative={result.illustrative}
          note={result.note}
        />
        <main className="mx-auto max-w-[1020px] px-7 pb-20 pt-9">
          <FingerprintBar prefix="surex.dev/r/" fingerprint={decoded} />
          <h1 className="mt-6 text-title font-semibold text-ink-3">{COPY.verdict.notFoundTitle}</h1>
          <p className="mt-2 max-w-[74ch] font-serif text-prose-lg text-ink-2">
            {COPY.verdict.notFoundBody}
          </p>
          <Link
            href="/submit"
            className="mt-4 inline-block rounded-input border border-accent bg-accent-t px-3.5 py-2 text-row font-semibold text-accent no-underline"
          >
            {COPY.verdict.notFoundAction}
          </Link>
          <Footer />
        </main>
      </>
    );
  }

  const { head } = entry;
  const { name } = splitName(head.name ?? head.fingerprint);
  const findings = entry.findings ?? [];
  const banner = stateBanner(head);
  /**
   * How many findings the verdict actually rests on.
   *
   * The page used `findings.length`, and `findings` is at most ONE — the API serves
   * the head's `topFinding` and nothing else. So a five-finding review was captioned
   * "FINDING 1 OF 1", which understates the verdict every time. `findingCount` is
   * published on the head for exactly this, and it falls back to what is on screen
   * when a head predates it.
   */
  const totalFindings = Math.max(head.findingCount ?? 0, findings.length);
  const blocking = BLOCKS.includes(head.state);
  const expired = evidenceExpiredOf(entry);
  const disputeHref = `/d/${head.fingerprint}`;
  /** The review blob is the one holding the findings — not the source blob. */
  const reviewLinks = entry.review?.links ?? head.links;
  const findingsProps = {
    total: totalFindings,
    head,
    blobId: entry.source?.blob?.blobId ?? head.evidence?.blobId,
    disputeHref,
  };

  return (
    <>
      <IllustrativeBanner
        origin={result.origin}
        illustrative={result.illustrative}
        note={result.note}
      />

      <main className="mx-auto max-w-[1020px] px-7 pb-20 pt-7">
        <FingerprintBar prefix="surex.dev/r/" fingerprint={head.fingerprint} />

        <div className="mt-3.5 grid gap-2.5">
          {result.origin === 'fixture' ? (
            <Banner tone="stale" label={COPY.banners.unreachableLabel}>
              {COPY.banners.unreachableBody}
            </Banner>
          ) : null}
          {entry.supersededBy ? (
            <Banner tone="neutral" label={COPY.banners.supersededLabel}>
              {COPY.banners.supersededBody}{' '}
              <Link href={`/r/${entry.supersededBy}`} className="text-accent">
                the current verdict →
              </Link>
            </Banner>
          ) : null}
          {expired ? (
            <Banner tone="stale" label={COPY.banners.evidenceExpiredLabel}>
              {COPY.banners.evidenceExpiredBody}
            </Banner>
          ) : null}
          {banner ? (
            <Banner tone={head.state === 'stale' ? 'stale' : 'neutral'} label={banner.label}>
              {banner.body}
            </Banner>
          ) : null}
        </div>

        <VerdictHero entry={entry} />
        <LinkagePanel entry={entry} />

        {/* The head carries the highest-severity finding and the count; the rest
            live in the certified record, which is a second network hop and the
            slow half of this page. So the count and the first card render from
            what is already here, and the remainder streams in behind them. When
            the head carries the whole list there is nothing to fetch and no
            boundary at all. */}
        <div className="mt-6 grid gap-5">
          {totalFindings > findings.length ? (
            <Suspense
              fallback={
                <>
                  <FindingList {...findingsProps} findings={findings} />
                  <p className="text-meta text-ink-3">
                    <span className="font-semibold">{COPY.verdict.findingsPendingLabel}</span>{' '}
                    {COPY.verdict.findingsPending}
                  </p>
                </>
              }
            >
              <AllFindings
                {...findingsProps}
                fp={decoded}
                shell={findings}
                findings={findings}
                links={reviewLinks}
              />
            </Suspense>
          ) : (
            <FindingList {...findingsProps} findings={findings} />
          )}
        </div>

        {entry.dispute ? (
          <>
            <div className="mt-6 grid gap-3.5 md:grid-cols-2">
              <ClaimCard claim={entry.dispute.accusation} kind="accusation" />
              <ClaimCard claim={entry.dispute.rebuttal} kind="rebuttal" badge="ON FILE" />
            </div>
            <p className="mt-2.5 px-1 text-meta text-ink-3">
              {COPY.verdict.bothStand}{' '}
              <Link href={disputeHref} className="text-accent">
                {COPY.verdict.followDispute} →
              </Link>
            </p>
          </>
        ) : null}

        <div className="mt-6 grid gap-5">
          <CapabilitySurface capabilities={head.capabilities} state={head.state} />
          <Provenance entry={entry} />
        </div>

        {head.state === 'clean' ? <CleanMeans /> : null}

        {blocking || expired ? (
          <ActionPanels disputeHref={disputeHref} overrideCommand={entry.overrideCommand} />
        ) : (
          <Panel className="mt-6 px-5 py-4">
            <SectionLabel>{COPY.verdict.disagreeLabel}</SectionLabel>
            <p className="mt-2 text-data text-ink-2">{COPY.verdict.disagreeBody}</p>
            <Link
              href={disputeHref}
              className="mt-3 inline-block rounded-input border border-accent bg-accent-t px-3.5 py-2 text-row font-semibold text-accent no-underline"
            >
              {COPY.verdict.disagreeAction}
            </Link>
          </Panel>
        )}

        <p className="mt-6 px-1 text-meta text-ink-3">
          {name} · {COPY.footer.permanence}
        </p>

        <Footer />
      </main>
    </>
  );
}
