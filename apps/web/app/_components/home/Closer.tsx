import { COPY } from '@/lib/copy.ts';

/**
 * The link row that used to close this section moved to `SiteFooter`, which
 * renders on every route including this one — so it still appears directly
 * below this wordmark, and now appears below the registry and the verdict
 * pages too. Rendering it here as well would print the same five links twice
 * on the homepage.
 *
 * The wordmark as the last argument (design system screen 08). Fluid between
 * a 72px floor and the 200px the mock sets at 1440 — same anchored-clamp
 * method as `Hero`'s h1, solved for 72px/390 and 200px/1440.
 *
 * The x's colour is NOT simply "emerald because this is the closer": the
 * house rule is sage below 120px, emerald only above it, "never the
 * reverse" — and this wordmark's own fluid curve crosses 120px at a 787px
 * viewport (solved from the same clamp), so on narrow phones it renders sage
 * like the header, and only becomes emerald once the mass actually earns it.
 */
export function Closer() {
  const name = COPY.brand.name.toLowerCase();
  const head = name.slice(0, -1);
  const tail = name.slice(-1);

  return (
    <section className="border-t border-[var(--v2-line)] px-[var(--v2-gutter-mobile)] py-[var(--v2-rhythm-mobile)] text-center md:px-[var(--v2-gutter)] md:pt-[var(--v2-space-9)] md:pb-[var(--v2-space-8)]">
      <div className="text-[clamp(72px,24px_+_12.19vw,200px)] leading-[0.85] font-extrabold tracking-[-0.06em] text-[var(--v2-ink)]">
        {head}
        <span className="text-[var(--v2-clean)] min-[787px]:text-[var(--v2-brand-emerald)]">
          {tail}
        </span>
      </div>

      <div className="mt-[var(--v2-space-6)] inline-block border border-[var(--v2-border)] px-[26px] py-[16px] font-[family-name:var(--font-suse-mono)] text-[15px] text-[var(--v2-ink)]">
        {COPY.home.closer.installCommand}
      </div>
    </section>
  );
}
