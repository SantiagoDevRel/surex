import Link from 'next/link';

import { cn } from '@/lib/cn.ts';
import { COPY } from '@/lib/copy.ts';
import { stateStyle } from '@/lib/state-styles.ts';
import type { Finding, RowStatus } from '@/lib/types.ts';

import { SeverityChip } from './Chip.tsx';
import { Panel, SectionLabel } from './Panel.tsx';

// One finding, with the lines it is about. The rebuttal route sits next to
// the accusation, not three clicks away — a model is wrong in both directions.
export function FindingCard({
  finding,
  index,
  total,
  state,
  blobId,
  disputeHref,
}: {
  finding: Finding;
  index: number;
  total: number;
  state: RowStatus;
  blobId?: string;
  disputeHref: string;
}) {
  const s = stateStyle(state);
  const hasExcerpt = (finding.excerpt?.length ?? 0) > 0;

  return (
    <Panel tone={s.borderSoft} className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-5 py-3">
        <SectionLabel>
          {COPY.verdict.findingLabel} {index} OF {total}
        </SectionLabel>
        <SeverityChip severity={finding.severity} />
        {/* The API lane sends `category` and no `title` — read whichever is there. */}
        <span className="text-subject font-semibold text-ink">
          {finding.title ?? finding.category ?? 'finding'}
        </span>
        {finding.file ? (
          <span className="ml-auto text-meta text-accent">
            {finding.file}
            {finding.line ? `:${finding.line}` : ''}
          </span>
        ) : null}
      </div>

      {/* Only split the panel when there is source to show on the right. */}
      <div className={cn('grid', hasExcerpt && 'md:grid-cols-[1.1fr_1fr]')}>
        <div className={cn('border-line px-5 py-4', hasExcerpt && 'md:border-r')}>
          <p className="font-serif text-prose-lg text-ink-2">{finding.description}</p>
          <p className="mt-3 text-meta text-ink-3">
            <b className="text-ink-2">{COPY.verdict.couldBeWrongLabel}</b>{' '}
            {COPY.verdict.couldBeWrongBody}{' '}
            <Link href={disputeHref} className="text-accent">
              {COPY.verdict.disagreeAction} →
            </Link>
          </p>
        </div>

        {finding.excerpt?.length ? (
          <div className="bg-panel-2 px-4 py-3.5">
            <div className="mb-2 text-label text-faint">
              {finding.file} · reviewed blob {blobId ?? 'not recorded'}
            </div>
            <pre className="overflow-x-auto font-mono text-row leading-[1.7] text-ink-2">
              {finding.excerpt.map((row) => (
                <span
                  key={row.line}
                  className={cn(
                    'block',
                    row.implicated && cn('-mx-4 border-l-2 px-4', s.tint, s.border),
                  )}
                >
                  <span className="text-faint">{row.line}</span> {row.text}
                </span>
              ))}
            </pre>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

/** What an empty findings list means — it does not always mean "none found":
 *  clean (true), withheld (published elsewhere), or flagged-with-no-body
 *  (verdict stands on a blob this page isn't showing). */
export function NoFindings({ state, reason }: { state?: string; reason?: string }) {
  // TOTAL over the states a head can carry — `unknown` (most of the registry,
  // via seeded entries) must not read as "the model saw this and found nothing".
  const { label, body } = (() => {
    if (reason === 'withheld') {
      return { label: COPY.verdict.findingsWithheldLabel, body: COPY.verdict.findingsWithheld };
    }
    if (state === 'flagged' || state === 'disputed') {
      return { label: COPY.verdict.findingsNoneLabel, body: COPY.verdict.findingsMissing };
    }
    if (state === 'unknown') {
      return { label: COPY.verdict.findingsNoneLabel, body: COPY.verdict.findingsNeverReviewed };
    }
    if (state === 'unreviewable' || state === 'stale') {
      return { label: COPY.verdict.findingsNoneLabel, body: COPY.verdict.findingsNoVerdict };
    }
    return { label: COPY.verdict.findingsNoneLabel, body: COPY.verdict.findingsNone };
  })();

  return (
    <Panel className="px-5 py-4">
      <SectionLabel>{label}</SectionLabel>
      <p className="mt-2 font-serif text-prose-lg text-ink-2">{body}</p>
    </Panel>
  );
}
