import { COPY } from '@/lib/copy.ts';
import { shortFingerprint, splitName } from '@/lib/format.ts';
import { stampView } from '@/lib/verdict-view.ts';
import type { Entry } from '@/lib/types.ts';

import { Panel, SectionLabel } from './Panel.tsx';
import { Stamp } from './Stamp.tsx';

const STATE_MEANING = COPY.stateMeaning as Record<string, string | undefined>;

/**
 * The hero: one stamp, and the twenty-second version of the whole verdict
 * beside it. Nothing else competes at this size — §04 says one stamp per page
 * and means it.
 */
export function VerdictHero({ entry }: { entry: Entry }) {
  const { head } = entry;
  const view = stampView(head, entry);
  const { name, version } = splitName(head.name ?? head.fingerprint);

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

        {/* With no summary on the record, say what the STATE means rather than
            leaving the panel out or writing a summary nobody produced. The
            state sentence is a fact about the model, not about this server. */}
        <Panel className="mt-3.5 px-4 py-3.5">
          <SectionLabel>{COPY.verdict.summaryLabel}</SectionLabel>
          <p className="mt-2 font-serif text-prose-lg text-ink-2">
            {entry.summary ?? STATE_MEANING[head.state] ?? COPY.stateMeaning.unknown}
          </p>
          {entry.options ? <p className="mt-2.5 text-meta text-ink-3">{entry.options}</p> : null}
        </Panel>
      </div>
    </div>
  );
}
