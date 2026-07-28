import { COPY } from '@/lib/copy.ts';
import type { DataOrigin } from '@/lib/types.ts';

/**
 * The illustrative banner — a hard rule (AGENTS.md §2 and §4). Wherever a screen
 * renders data that is not a real review, it says so on that screen: sticky,
 * at the top, for as long as the data is fake.
 *
 * ⚠️ 30% opacity on the halftone layer is a measured ceiling, not a taste
 * call — at 40% the worst-pixel contrast drops to 4.14:1, under AA.
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
