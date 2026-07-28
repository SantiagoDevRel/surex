import { CLEAN_MEANS } from '@surex/core';
import Link from 'next/link';

import { COPY } from '@/lib/copy.ts';

import { CopyCommand } from './CopyCommand.tsx';
import { Panel, SectionLabel } from './Panel.tsx';

/** The two things a reader can do about a disputed verdict, side by side and
 *  the same size: answer it, or override it. */
export function ActionPanels({
  disputeHref,
  overrideCommand,
}: {
  disputeHref: string;
  overrideCommand?: string;
}) {
  return (
    <div className="mt-6 grid gap-3.5 md:grid-cols-2">
      <Panel className="px-5 py-4">
        <SectionLabel>{COPY.verdict.disagreeLabel}</SectionLabel>
        <p className="mt-2 text-data text-ink-2">{COPY.verdict.disagreeBody}</p>
        <Link
          href={disputeHref}
          className="mt-3 inline-block rounded-input border border-accent bg-accent-t px-3.5 py-2 text-row font-semibold text-accent no-underline"
        >
          {COPY.verdict.disagreeAction}
        </Link>
      </Panel>

      <Panel className="px-5 py-4">
        <SectionLabel>{COPY.verdict.overrideLabel}</SectionLabel>
        <p className="mt-2 text-data text-ink-2">{COPY.verdict.overrideBody}</p>
        {overrideCommand ? (
          <div className="mt-3">
            <CopyCommand command={overrideCommand} />
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

/**
 * What `clean` actually means, in full, on any page that renders one. The
 * sentence comes from `@surex/core` so the gate, the API and this page cannot
 * each soften it a little differently.
 */
export function CleanMeans() {
  return (
    <Panel className="mt-6 px-5 py-4">
      <SectionLabel>{COPY.verdict.cleanMeansLabel}</SectionLabel>
      <p className="mt-2 font-serif text-prose text-ink-2">{CLEAN_MEANS as string}</p>
      <p className="mt-2.5 text-meta text-ink-3">{COPY.verdict.staleNote}</p>
    </Panel>
  );
}
