import { COPY } from '@/lib/copy.ts';
import type { DataOrigin } from '@/lib/types.ts';

/**
 * The illustrative banner. HARD RULE — AGENTS.md §2 and §4.
 *
 * Wherever a screen renders data that is not a real review of a real MCP
 * server, it says so on that screen. Not in a tooltip, not in a footnote, not
 * on a different page: here, at the top, sticky, for as long as the data is
 * fake. The deployed static prototype does the same thing and the same rule
 * applies — it never comes off while the numbers are placeholders.
 *
 * It is deliberately sticky rather than the nav: if you can only see one of
 * them while scrolling a page of fake verdicts, it should be this.
 *
 * THE ONE PLACE SUNBEAM YELLOW IS A FILL, and the one surface that does not
 * theme. Everywhere else the brand hues are accents on a Deep Mocha / Dust Grey
 * surface, because the product is a serious one; here the whole job of the
 * element is to be impossible to miss, and a hazard band that went quiet in one
 * of the two themes would be quiet exactly where it must not be. Deep Mocha on
 * Sunbeam Yellow measures 8.46:1, which is better than the band it replaced
 * managed in either theme.
 *
 * The halftone is on its own layer behind the words, and ⚠️ 30% IS A MEASURED
 * CEILING: text over a pattern has to clear AA against the pattern's WORST
 * pixel, not its average. At the centre of a dot the band is #C9B513 and the
 * ink still reads 5.05:1; at 40% it drops to 4.14:1 and this becomes an
 * accessibility regression dressed as texture.
 */
export function IllustrativeBanner({
  origin,
  illustrative,
  note,
}: {
  origin: DataOrigin;
  illustrative: boolean;
  /** The reason the API was not used, when it was not. Shown, not swallowed. */
  note?: string;
}) {
  if (!illustrative) return null;

  const fromFixtures = origin === 'fixture';
  const label = fromFixtures ? COPY.illustrative.fixtureLabel : COPY.illustrative.mockLabel;
  const body = fromFixtures ? COPY.illustrative.fixtureBody : COPY.illustrative.mockBody;

  return (
    <div
      role="status"
      className="sticky top-0 z-50 overflow-hidden border-b border-band-line bg-band px-4 py-2.5 text-band-ink"
    >
      <span
        aria-hidden="true"
        className="halftone pointer-events-none absolute inset-0 opacity-30"
      />
      <div className="relative mx-auto flex max-w-[1180px] flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-label font-semibold uppercase">{label}</span>
        <span className="max-w-[92ch] text-row">{body}</span>
        {note ? <span className="ml-auto text-mini uppercase tracking-[0.1em]">{note}</span> : null}
      </div>
    </div>
  );
}
