import { BLOCKING_STATES, isFingerprint } from '@surex/core';
import Link from 'next/link';

import { getEntry } from '@/lib/api.ts';
import { COPY } from '@/lib/copy.ts';
import { splitName } from '@/lib/format.ts';
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

  /* Reachable registry, no entry. A real fact, and a different screen from a
     registry we could not reach — absence of a verdict is absence of
     knowledge, not a clean bill of health. */
  if (!entry) {
    return (
      <>
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

        <div className="mt-6 grid gap-5">
          {findings.length ? (
            findings.map((finding, i) => (
              <FindingCard
                key={`${finding.file ?? 'finding'}:${finding.line ?? i}`}
                finding={finding}
                index={i + 1}
                total={totalFindings}
                state={head.state}
                blobId={entry.source?.blob?.blobId ?? head.evidence?.blobId}
                disputeHref={disputeHref}
              />
            ))
          ) : (
            <NoFindings state={head.state} reason={head.reason} />
          )}
          {/* A count with no account of the remainder is worse than no count. The
              entry carries only the highest-severity finding, so "FINDING 1 OF 5"
              would otherwise leave four findings nowhere on the page — and on a
              registry whose neighbouring state is called `withheld`, four invisible
              findings is the worst ambiguity available. */}
          {totalFindings > findings.length ? (
            <p className="text-meta text-ink-3">{COPY.verdict.findingsRemainder}</p>
          ) : null}
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
