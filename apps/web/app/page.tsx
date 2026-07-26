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

// `data-sx="v2"` scopes the tree to globals.css's v2 token layer. `dynamic`
// prevents the API's fixture fallback from getting baked in at build time.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const registry = await getRegistry();
  const { rows, stats, partial } = registry.data;

  // Both render nothing rather than invent a row or pad a count for an empty registry.
  const items = tickerItems(rows);
  const tiles = homeStats({ rows, stats, partial });

  return (
    <div data-sx="v2" className="bg-[var(--v2-page)] text-[var(--v2-ink)]">
      {/* Rendered inline, not via the shared `IllustrativeBanner`, so this page
          states it as one muted line rather than the registry's full band. */}
      {registry.illustrative ? (
        <p className="border-b border-[var(--v2-line)] px-[var(--v2-gutter-mobile)] py-[var(--v2-space-3)] font-[family-name:var(--font-suse-mono)] text-[11px] leading-[1.6] text-[var(--v2-ink-3)] md:px-[var(--v2-gutter)] md:text-[10.5px]">
          <span className="tracking-[0.16em]">
            {registry.origin === 'fixture' ? COPY.illustrative.fixtureLabel : COPY.illustrative.mockLabel}
          </span>{' '}
          {registry.origin === 'fixture' ? COPY.illustrative.fixtureBody : COPY.illustrative.mockBody}
        </p>
      ) : null}

      <main>
        <Hero />
        <Ticker items={items} />
        <StatBand tiles={tiles} />
        <Pipeline />
        <TerminalWindow />
        <Roadmap />
        <InstallBand />
        <Closer />
      </main>
    </div>
  );
}
