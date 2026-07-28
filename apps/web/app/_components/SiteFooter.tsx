import Link from 'next/link';

import { COPY } from '@/lib/copy.ts';

/** Same override as `SiteHeader` — see that file for why a plain Tailwind
 * class can't beat `[data-sx="v2"] a`'s unlayered default. */
const MUTED_LINK =
  'border-b-0! text-[var(--v2-ink-3)]! hover:text-[var(--v2-ink)]! -my-[14px] inline-flex min-w-[44px] items-center justify-center py-[14px]';

// Destinations, not copy, so no COPY key; labels come from `COPY.home.footer`.
// `/registry` is relative — absolute would leave the deployment and lose
// client navigation for a link to a page already on this site.
const FOOTER_LINKS = [
  { href: '/registry', label: COPY.home.footer.registry, external: false },
  {
    href: 'https://arkiv-surex-api.vercel.app/v1/registry',
    label: COPY.home.footer.api,
    external: true,
  },
  { href: 'https://surex-docs.vercel.app', label: COPY.home.footer.docs, external: true },
  { href: 'https://app.ens.domains/surex.eth', label: COPY.home.footer.ens, external: true },
  { href: COPY.brand.repoUrl, label: COPY.home.footer.github, external: true },
] as const;

/**
 * The site's footer, on every route — the counterpart to `Chrome`. `Footer`
 * (a one-line provenance strip) still runs alongside it on the other routes,
 * naming where blobs and the verdict index live. `data-sx="v2"` for the same
 * reason `Chrome` sets it — `--v2-*` only exists inside that scope.
 */
export function SiteFooter() {
  return (
    <div data-sx="v2" className="mt-auto bg-[var(--v2-page)] text-[var(--v2-ink)]">
      <footer className="flex flex-wrap items-center justify-center gap-[var(--v2-space-5)] border-t border-[var(--v2-line)] px-[var(--v2-gutter-mobile)] py-[var(--v2-space-6)] font-[family-name:var(--font-suse-mono)] text-[11.5px] text-[var(--v2-ink-3)] md:px-[var(--v2-gutter)]">
        {FOOTER_LINKS.map((link) =>
          link.external ? (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className={MUTED_LINK}
            >
              {link.label}
            </a>
          ) : (
            <Link key={link.href} href={link.href} className={MUTED_LINK}>
              {link.label}
            </Link>
          ),
        )}
        <span aria-hidden="true">·</span>
        <span>{COPY.home.footer.builtAt}</span>
      </footer>
    </div>
  );
}
