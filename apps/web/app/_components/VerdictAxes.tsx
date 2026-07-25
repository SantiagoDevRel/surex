import { COPY } from '@/lib/copy.ts';

import { SectionLabel, Well } from './Panel.tsx';
import { TierLegend } from './TierLegend.tsx';

/**
 * The two axes a row is read along, and the fact that they are independent.
 *
 * The tier legend was on this page before this component existed, and on its own
 * it taught the wrong lesson: three letters explained, next to a coloured state
 * that was not, reads as one scale running from good to bad. It is two scales.
 * VERDICT is what the review found; TIER is whether the reviewed bytes are the
 * bytes you will run. A `clean` at C and a `flagged` at A are both ordinary, and
 * they mean completely different things.
 *
 * So the legend is no longer rendered by itself: it is the second half of this
 * block, and the first half is the distinction. Composition rather than a second
 * copy of the tier text — one wording for the three letters, in one place.
 */
export function VerdictAxes() {
  const terms: [string, string][] = [
    [COPY.browse.axesVerdictTerm, COPY.browse.axesVerdictBody],
    [COPY.browse.axesTierTerm, COPY.browse.axesTierBody],
  ];

  return (
    <section aria-label={COPY.browse.axesLabel} className="mt-3">
      <Well className="px-4 py-2.5">
        <SectionLabel className="text-faint">{COPY.browse.axesLabel}</SectionLabel>
        <dl className="mt-1.5 grid gap-x-7 gap-y-1.5 sm:grid-cols-2">
          {terms.map(([term, body]) => (
            <div key={term} className="flex items-start gap-2">
              <dt className="text-row shrink-0 font-semibold text-ink">{term}</dt>
              <dd className="text-mini text-ink-2">{body}</dd>
            </div>
          ))}
        </dl>
        <p className="text-mini mt-2 text-ink-2">{COPY.browse.axesIndependent}</p>
      </Well>
      <TierLegend />
    </section>
  );
}
