import { COPY } from '@/lib/copy.ts';
import type { Tier } from '@/lib/types.ts';

import { TierMeter } from './CustodyRow.tsx';
import { SectionLabel, Well } from './Panel.tsx';

/**
 * What A, B and C mean, with a sample of the meter for each.
 *
 * The TIER column decides whether a verdict is about the reader's code at all,
 * and the meter is three unlabelled cells — unreadable to anyone who has not
 * read the spec. So the legend is on the page, above the table it explains,
 * next to the TIER filter that offers the same three letters.
 *
 * A legend, not a section: `Well` rather than `Panel`, one label, three lines of
 * text. It carries no state hue — tier is form, state is hue (tokens §01), and
 * the sample meters here are the same neutral ink the rows use.
 */
const TIERS: [Tier, string][] = [
  ['A', COPY.browse.tierLegendA],
  ['B', COPY.browse.tierLegendB],
  ['C', COPY.browse.tierLegendC],
];

export function TierLegend() {
  return (
    <Well className="mt-3 px-4 py-2.5">
      <SectionLabel className="text-faint">{COPY.browse.tierLegendLabel}</SectionLabel>
      <dl className="mt-1.5 grid gap-x-7 gap-y-1.5 sm:grid-cols-3">
        {TIERS.map(([tier, meaning]) => (
          <div key={tier} className="flex items-start gap-2">
            <dt className="mt-[3px] flex shrink-0 items-center gap-1.5">
              <TierMeter tier={tier} />
              <span className="text-row font-semibold text-ink">{tier}</span>
            </dt>
            <dd className="text-mini text-ink-2">{meaning}</dd>
          </div>
        ))}
      </dl>
    </Well>
  );
}
