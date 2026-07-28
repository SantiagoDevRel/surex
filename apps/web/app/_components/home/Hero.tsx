import Link from 'next/link';

import { COPY } from '@/lib/copy.ts';

// A separate constant, not a shared import from `Chrome.tsx` — `Hero` would
// otherwise pull the registry/dossier chrome's dependencies into the v2 bundle.
const INSTALL_URL = 'https://surex-docs.vercel.app/guides/install';

// Fluid type instead of breakpoints for the display size: the curve is
// anchored at 40px/390 and 138px/1440 and solved for slope + intercept.
export function Hero() {
  return (
    <section className="px-[var(--v2-gutter-mobile)] py-[var(--v2-rhythm-mobile)] text-center md:px-[var(--v2-gutter)] md:pt-[var(--v2-space-9)] md:pb-[var(--v2-space-8)]">
      <h1 className="mx-auto max-w-[14ch] text-[clamp(40px,3.6px_+_9.33vw,138px)] leading-[0.92] font-extrabold tracking-[-0.055em] text-[var(--v2-ink)]">
        {COPY.home.hero.headline}
      </h1>

      <div
        aria-hidden="true"
        className="mx-auto mt-[var(--v2-space-7)] h-[2px] w-[56px] bg-[var(--v2-brand-emerald)]"
      />

      {/* `COPY.home.hero.lede` is a standing placeholder — see lib/copy.ts. */}
      <p className="mx-auto mt-[var(--v2-space-6)] max-w-[44ch] text-[22px] leading-[1.5] text-[var(--v2-ink)]">
        {COPY.home.hero.lede}
      </p>

      <p className="mx-auto mt-[var(--v2-space-3)] max-w-[50ch] text-[17px] leading-[1.6] text-[var(--v2-ink-2)]">
        {COPY.home.hero.body}
      </p>

      <div className="mt-[var(--v2-space-6)] flex flex-wrap items-center justify-center gap-[14px]">
        {/* The one filled surface in the hero — needs the `!important` override
            described in `SiteHeader`, since it inverts the default anchor look. */}
        <a
          href={INSTALL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="border-b-0! bg-[var(--v2-ink)]! px-[26px] py-[16px] text-[14px] font-bold text-[var(--v2-page)]!"
        >
          {COPY.home.hero.actionInstall}
        </a>
        {/* Secondary — rides the default anchor look instead of fighting it. */}
        <Link
          href="/registry"
          className="border border-[var(--v2-border)] px-[26px] py-[16px] text-[14px] text-[var(--v2-ink)] hover:border-[var(--v2-ink)]"
        >
          {COPY.home.hero.actionBrowse}
        </Link>
      </div>
    </section>
  );
}
