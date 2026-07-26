import { COPY } from '@/lib/copy.ts';

/** Same override as `SiteHeader` — see that file for why a plain Tailwind
 * class can't beat `[data-sx="v2"] a`'s unlayered default. */
const MUTED_LINK = 'border-b-0! text-[var(--v2-ink-3)]! hover:text-[var(--v2-ink)]! -my-[14px] inline-flex min-w-[44px] items-center justify-center py-[14px]';

/**
 * Destinations pulled straight from the mock — they're URLs, not copy, so
 * there's no COPY key for them (same reasoning as `Chrome.tsx`'s pinned
 * `INSTALL_URL`). Labels still come from `COPY.home.footer`.
 */
const FOOTER_LINKS = [
  { href: 'https://arkiv-surex.vercel.app', label: COPY.home.footer.registry },
  { href: 'https://arkiv-surex-api.vercel.app/v1/registry', label: COPY.home.footer.api },
  { href: 'https://surex-docs.vercel.app', label: COPY.home.footer.docs },
  { href: 'https://app.ens.domains/surex.eth', label: COPY.home.footer.ens },
  { href: 'https://github.com/SantiagoDevRel/surex', label: COPY.home.footer.github },
] as const;

/**
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

      <div className="mt-[var(--v2-space-6)] flex flex-wrap items-center justify-center gap-[var(--v2-space-5)] font-[family-name:var(--font-suse-mono)] text-[11.5px] text-[var(--v2-ink-3)]">
        {FOOTER_LINKS.map((link) => (
          <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" className={MUTED_LINK}>
            {link.label}
          </a>
        ))}
        <span aria-hidden="true">·</span>
        <span>{COPY.home.footer.builtAt}</span>
      </div>
    </section>
  );
}
