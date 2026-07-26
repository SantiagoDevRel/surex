import Link from 'next/link';

import { COPY } from '@/lib/copy.ts';

/** Same override as `SiteHeader` — see that file for why a plain Tailwind
 * class can't beat `[data-sx="v2"] a`'s unlayered default. */
const MUTED_LINK =
  'border-b-0! text-[var(--v2-ink-3)]! hover:text-[var(--v2-ink)]! -my-[14px] inline-flex min-w-[44px] items-center justify-center py-[14px]';

/**
 * Destinations, not copy, so they have no COPY key — same reasoning as
 * `SiteHeader`'s pinned `INSTALL_URL`. Labels come from `COPY.home.footer`.
 *
 * The registry entry is a relative `/registry`, and it is the one that changed:
 * it used to be the absolute site root, which was the registry table until the
 * landing page took that route. Absolute is also just wrong for a link to the
 * page you are already on — it left the deployment and came back, losing client
 * navigation and pinning a preview build to production.
 */
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
 * The site's footer, on every route — the counterpart to `Chrome` at the other
 * end of the page.
 *
 * It is lifted verbatim out of `Closer`, which is why it looks like the
 * homepage: the homepage was the only route that had a footer of the site at
 * all. The other four ended on `Footer`, a one-line provenance strip naming
 * where blobs and the verdict index live — which is a statement about the
 * record on that page, not a way out of it, and it is still there doing that
 * job. Ending four routes on a technical strip and one on a signed-off site
 * footer was the same "two people built this" tell as the two headers were.
 *
 * `data-sx="v2"` for the same reason `Chrome` sets it: `--v2-*` exist only
 * inside that scope, and outside it every one of them resolves to nothing.
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
