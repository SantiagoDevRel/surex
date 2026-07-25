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
      className="sticky top-0 z-50 border-b border-stale-l bg-stale px-4 py-2.5 text-bg"
    >
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-label font-semibold uppercase">{label}</span>
        <span className="max-w-[92ch] text-row">{body}</span>
        {note ? <span className="ml-auto text-mini uppercase tracking-[0.1em]">{note}</span> : null}
      </div>
    </div>
  );
}
