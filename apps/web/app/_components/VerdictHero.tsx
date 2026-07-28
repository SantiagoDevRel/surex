import { COPY } from '@/lib/copy.ts';
import { shortFingerprint, splitName } from '@/lib/format.ts';
import { stampView, summarySentence, concernSentence } from '@/lib/verdict-view.ts';
import type { Entry } from '@/lib/types.ts';

import { Panel, SectionLabel } from './Panel.tsx';
import { Stamp } from './Stamp.tsx';

/**
 * The hero: one stamp, and the twenty-second version of the whole verdict
 * beside it. Nothing else competes at this size: one stamp per page (§04).
 */
export function VerdictHero({ entry }: { entry: Entry }) {
  const { head } = entry;
  const view = stampView(head, entry);
  const { name, version } = splitName(head.name ?? head.fingerprint);
  const concern = concernSentence(head);

  return (
    <div className="mt-7 flex flex-wrap items-start gap-x-9 gap-y-6">
      <div className="shrink-0 pb-3.5 pl-1 pr-3 pt-2">
        <Stamp
          state={view.state}
          tier={view.tier}
          impression={view.impression}
          counter={view.counter}
          counterTone={view.counterTone}
          superseded={view.superseded}
          dashed={view.dashed}
        />
      </div>

      <div className="min-w-[320px] flex-1">
        <h1 className="text-title font-semibold">
          {name} <span className="font-normal text-ink-3">{version}</span>
        </h1>
        <p className="mt-1.5 text-mini text-ink-3">
          {entry.source?.packageRef ? `${entry.source.packageRef} · ` : ''}
          fingerprint {shortFingerprint(head.fingerprint)}
        </p>

        {/* The reviewer's own assessment leads; the state sentence is the fallback. */}
        <Panel className="mt-3.5 px-4 py-3.5">
          <SectionLabel>{COPY.verdict.summaryLabel}</SectionLabel>
          {concern ? (
            <p className="mt-2 text-label text-ink-3">
              {COPY.verdict.concernLabel} — {concern}
            </p>
          ) : null}
          <p className="mt-2 font-serif text-prose-lg text-ink-2">{summarySentence(head, entry)}</p>
          {entry.options ? <p className="mt-2.5 text-meta text-ink-3">{entry.options}</p> : null}
        </Panel>
      </div>
    </div>
  );
}
