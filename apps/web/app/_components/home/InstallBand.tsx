'use client';

import { useId, useState } from 'react';

import { COPY } from '@/lib/copy.ts';

/**
 * The ask, immediately before `Closer`'s sign-off (design system screen 08 —
 * the closer treatment is the only precedent for a wordmark-adjacent install
 * moment, and this band is inferred from it plus the system's general
 * rules — there is no dedicated screen for a pre-closer CTA).
 *
 * `Closer` is the quiet last word: a huge wordmark, the command in a plain
 * chip, a tagline. This band is the ask that earns it, so the difference is
 * structural rather than typographic — a top border plus a filled
 * `--v2-well` surface (the system's only vocabulary for depth, since nothing
 * here gets a shadow or a radius) sits this band apart from the page-colour
 * `Closer` directly below it. The headline deliberately repeats the hero's
 * (`COPY.home.install.headline` === `COPY.home.hero.headline`, on purpose —
 * the page ends where it began) but renders at the section-heading scale
 * this page's other `<h2>`s use, not the hero's 138px display size, so it
 * reads as a callback rather than a second hero.
 */
export function InstallBand() {
  const headingId = useId();
  const [copied, setCopied] = useState(false);

  async function copyCommand() {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(COPY.home.install.command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked or unavailable — the command is still selectable
       * in the <code> element above, and the label never claims a copy that
       * did not happen (same handling as `CopyCommand`). */
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      className="border-t border-[var(--v2-line)] bg-[var(--v2-well)] px-[var(--v2-gutter-mobile)] py-[var(--v2-rhythm-mobile)] text-center md:px-[var(--v2-gutter)] md:py-[var(--v2-space-8)]"
    >
      <p
        id={headingId}
        className="mx-auto max-w-[18ch] text-[clamp(30px,24px_+_3vw,40px)] leading-[1.05] font-extrabold tracking-[-0.04em] text-[var(--v2-ink)]"
      >
        {COPY.home.install.headline}
      </p>

      {/*
        The lede is the heading, not the big line above it. The big line is a
        deliberate echo of the hero — same string — so as an <h2> it gave the
        page two headings a screen reader could not tell apart. The echo stays
        visually, demoted to a <p>; the distinct sentence carries the heading.
      */}
      <h2 className="mx-auto mt-[var(--v2-space-4)] max-w-[44ch] text-[15px] leading-[1.6] font-normal text-[var(--v2-ink-2)] md:text-[17px]">
        {COPY.home.install.lede}
      </h2>

      <div className="mx-auto mt-[var(--v2-space-6)] inline-flex max-w-full flex-wrap items-center justify-center gap-x-[var(--v2-space-4)] gap-y-[var(--v2-space-3)] border border-[var(--v2-border)] px-[var(--v2-space-4)] py-[var(--v2-space-3)]">
        <code className="whitespace-nowrap font-[family-name:var(--font-suse-mono)] text-[12px] text-[var(--v2-ink)] md:text-[15px]">
          {COPY.home.install.command}
        </code>
        {/*
         * A real button, keyboard operable, riding the global focus ring
         * (`[data-sx="v2"] :focus-visible`) rather than reimplementing it.
         * 44pt minimum touch target from padding, not a fixed box size.
         * `aria-live` on the label span is the accessible-feedback channel:
         * `CopyCommand` (v1) swaps the label visually only, which the brief
         * for this band calls out as insufficient, so the swap here is
         * wrapped in a polite live region that announces "copied" on its
         * own, independent of the visible text change.
         */}
        <button
          type="button"
          onClick={copyCommand}
          className="inline-flex min-h-[44px] items-center justify-center border border-[var(--v2-border)] px-[var(--v2-space-3)] py-[var(--v2-space-2)] font-[family-name:var(--font-suse-mono)] text-[11.5px] uppercase tracking-[0.1em] text-[var(--v2-accent)] hover:border-[var(--v2-ink)]"
        >
          <span aria-live="polite" aria-atomic="true">
            {copied ? COPY.home.install.copiedLabel : COPY.home.install.copyLabel}
          </span>
        </button>
      </div>
    </section>
  );
}
