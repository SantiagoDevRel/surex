import Link from 'next/link';

import { COPY } from '@/lib/copy.ts';

/**
 * Where the deployed docs live for the plugin install walkthrough — pinned
 * here the same way `Chrome.tsx` pins `INSTALL_URL` for the registry chrome.
 * A separate constant rather than a shared import: `Hero` cannot reach into
 * `Chrome.tsx` without pulling the registry/dossier chrome's dependencies
 * into the v2 homepage bundle, and it's a URL, not copy — there is no COPY
 * key for a destination.
 */
const INSTALL_URL = 'https://surex-docs.vercel.app/guides/install';

/**
 * Four elements, in this order, always (design system screen 08 — "HERO —
 * CLAIM, RULE, PLAIN SENTENCE, TWO ACTIONS"): the claim, the 56×2 emerald
 * rule, the plain sentence, then the explanatory body and the two actions.
 * The rule is the one ornament on the whole site and appears exactly once,
 * here.
 *
 * Fluid type instead of breakpoints for the display size, per the brief:
 * the mock's instance is 138px at 1440 and screen 02 ("Display 64/800 —
 * hero, footer wordmark") gives the family's own floor, so the curve is
 * anchored at 40px/390 and 138px/1440 and solved for slope + intercept —
 * not eyeballed. `clamp()` also means there is no breakpoint to get wrong at
 * an in-between width.
 */
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

      {/*
       * `COPY.home.hero.lede` is a standing placeholder — the mock's own line
       * fails the copy law and a human is choosing its replacement (see the
       * comment on that key in lib/copy.ts). Rendered as-is, untouched.
       */}
      <p className="mx-auto mt-[var(--v2-space-6)] max-w-[44ch] text-[22px] leading-[1.5] text-[var(--v2-ink)]">
        {COPY.home.hero.lede}
      </p>

      <p className="mx-auto mt-[var(--v2-space-3)] max-w-[50ch] text-[17px] leading-[1.6] text-[var(--v2-ink-2)]">
        {COPY.home.hero.body}
      </p>

      <div className="mt-[var(--v2-space-6)] flex flex-wrap items-center justify-center gap-[14px]">
        {/*
         * Primary — the one filled surface in the hero, so it needs the
         * `!important` override described in `SiteHeader`: the default
         * anchor look is ink text with a hairline border-bottom, and this
         * button inverts the fill entirely.
         */}
        <a
          href={INSTALL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="border-b-0! bg-[var(--v2-ink)]! px-[26px] py-[16px] text-[14px] font-bold text-[var(--v2-page)]!"
        >
          {COPY.home.hero.actionInstall}
        </a>
        {/*
         * Secondary — every value here already matches the default anchor
         * look (ink text, `--v2-border` hairline, brightening to `--v2-ink`
         * on hover), so it rides that rule instead of fighting it; the only
         * additions are the box's other three edges and the padding.
         */}
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
