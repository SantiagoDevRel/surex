import { getRegistry } from '@/lib/api.ts';
import { COPY } from '@/lib/copy.ts';
import { homeStats, tickerItems } from '@/lib/home-data.ts';

import { Closer } from './_components/home/Closer.tsx';
import { Hero } from './_components/home/Hero.tsx';
import { InstallBand } from './_components/home/InstallBand.tsx';
import { Pipeline } from './_components/home/Pipeline.tsx';
import { Roadmap } from './_components/home/Roadmap.tsx';
import { StatBand } from './_components/home/StatBand.tsx';
import { TerminalWindow } from './_components/home/TerminalWindow.tsx';
import { Ticker } from './_components/home/Ticker.tsx';

/**
 * The homepage. `data-sx="v2"` scopes the whole tree to the token layer at the
 * end of globals.css — dark-only, achromatic accent, nothing rounded.
 *
 * The header is no longer rendered here. `Chrome` renders it on every route
 * including this one, because it is the site's header now and not this page's
 * — see `_components/Chrome.tsx`.
 *
 * Dynamic for the same reason the registry is: the API is a separate lane and
 * may come up after this page is deployed. Prerendering would freeze whichever
 * answer was available at build time — including the fixture fallback — and
 * bake the illustrative banner into a page that could have been live.
 */
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const registry = await getRegistry();
  const { rows, stats, partial } = registry.data;

  // Both derived from the rows this render actually received. The ticker and
  // the band render nothing rather than invent a row or pad a count — an empty
  // registry is a fact about the registry, and the honest way to show it is to
  // show less, not to fill the space.
  const items = tickerItems(rows);
  const tiles = homeStats({ rows, stats, partial });

  return (
    <div data-sx="v2" className="bg-[var(--v2-page)] text-[var(--v2-ink)]">
      {/*
        The disclosure, whenever the numbers below are not real reviews.
        AGENTS.md 4: a screen rendering illustrative data says so on that
        screen. The stat band and the ticker are both fed from this payload.

        Rendered here rather than via the shared `IllustrativeBanner` so this
        page can state it quietly without restyling the registry pages, which
        keep the full band. It is one muted line, and it disappears on its own
        the moment the API answers with real records.
      */}
      {registry.illustrative ? (
        <p className="border-b border-[var(--v2-line)] px-[var(--v2-gutter-mobile)] py-[var(--v2-space-3)] font-[family-name:var(--font-suse-mono)] text-[11px] leading-[1.6] text-[var(--v2-ink-3)] md:px-[var(--v2-gutter)] md:text-[10.5px]">
          <span className="tracking-[0.16em]">
            {registry.origin === 'fixture' ? COPY.illustrative.fixtureLabel : COPY.illustrative.mockLabel}
          </span>{' '}
          {registry.origin === 'fixture' ? COPY.illustrative.fixtureBody : COPY.illustrative.mockBody}
        </p>
      ) : null}

      {/*
        Order is deliberate. `Pipeline` ends on "06 THE CHECK — runs before the
        tool call, on your machine", and `TerminalWindow` is a transcript of
        exactly that happening: the explanation, then the evidence for it.
        `Roadmap` is the only section about work not yet done, so it sits last,
        immediately before the closer's install command.
      */}
      <main>
        <Hero />
        <Ticker items={items} />
        <StatBand tiles={tiles} />
        <Pipeline />
        <TerminalWindow />
        <Roadmap />
        {/*
          The ask, then the sign-off. `InstallBand` is the call to action — a
          filled surface with the command and a copy affordance; `Closer` is
          the wordmark as the last argument. Two endings on purpose, made
          structurally different so they do not read as one block repeated.
        */}
        <InstallBand />
        <Closer />
      </main>
    </div>
  );
}
