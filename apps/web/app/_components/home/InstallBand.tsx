import { COPY } from '@/lib/copy.ts';

/**
 * The callback line before `Closer`'s sign-off. The headline deliberately
 * repeats the hero's (`COPY.home.install.headline` === `COPY.home.hero.headline`
 * — the page ends where it began), but renders at the section-heading scale
 * rather than the hero's display size, so it reads as a callback, not a
 * second hero. No state or clipboard here, so no `'use client'`.
 */
export function InstallBand() {
  const headingId = 'install-band-heading';

  return (
    <section
      aria-labelledby={headingId}
      className="border-t border-[var(--v2-line)] bg-[var(--v2-well)] px-[var(--v2-gutter-mobile)] py-[var(--v2-rhythm-mobile)] text-center md:px-[var(--v2-gutter)] md:py-[var(--v2-space-8)]"
    >
      <h2
        id={headingId}
        className="mx-auto max-w-[18ch] text-[clamp(30px,24px_+_3vw,40px)] leading-[1.05] font-extrabold tracking-[-0.04em] text-[var(--v2-ink)]"
      >
        {COPY.home.install.headline}
      </h2>

      <p className="mx-auto mt-[var(--v2-space-4)] max-w-[44ch] text-[15px] leading-[1.6] text-[var(--v2-ink-2)] md:text-[17px]">
        {COPY.home.install.lede}
      </p>
    </section>
  );
}
