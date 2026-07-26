import { COPY } from '@/lib/copy.ts';

/**
 * The callback line before `Closer`'s sign-off (design system screen 08 — the
 * closer treatment is the only precedent for a wordmark-adjacent install
 * moment, and this band is inferred from it plus the system's general rules —
 * there is no dedicated screen for a pre-closer CTA).
 *
 * `Closer` is the quiet last word: a huge wordmark, the command in a plain
 * chip, a tagline. This band sets it up, so the difference is structural
 * rather than typographic — a top border plus a filled `--v2-well` surface
 * (the system's only vocabulary for depth, since nothing here gets a shadow or
 * a radius) sits this band apart from the page-colour `Closer` directly below
 * it. The headline deliberately repeats the hero's
 * (`COPY.home.install.headline` === `COPY.home.hero.headline`, on purpose —
 * the page ends where it began) but renders at the section-heading scale this
 * page's other `<h2>`s use, not the hero's 138px display size, so it reads as
 * a callback rather than a second hero.
 *
 * It held a copyable command chip until that was cut: `Closer`, immediately
 * below, prints the same `/plugin install surex@surex`, so the page ran the
 * command twice in a row and the second one was the one beside the wordmark
 * that earns it.
 *
 * The headline carries the `<h2>` again. It used to be a `<p>` with the lede
 * as the heading, because the string was the hero's `<h1>` verbatim and two
 * indistinguishable headings is worse than an unconventional one. That string
 * has since changed, so the section heads with its own sentence and the lede
 * goes back to being a lede.
 *
 * No state and no clipboard left here, so no `'use client'` — this renders on
 * the server like `Closer` does.
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
