'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/cn.ts';
import { COPY } from '@/lib/copy.ts';

import { ThemeToggle } from './ThemeToggle.tsx';
import { SplitRule, Wordmark } from './Wordmark.tsx';

const LINKS = [
  { href: '/', label: COPY.nav.registry, match: (p: string) => p === '/' || p.startsWith('/r/') },
  { href: '/submit', label: COPY.nav.submit, match: (p: string) => p.startsWith('/submit') },
];

/**
 * The docs live on their own deployment, so this is an absolute URL and it is
 * pinned here rather than spelled inline at the call site.
 *
 * Verified 200 before shipping. A dead install link in the chrome is the worst
 * possible dead link on this site: it is the only control that leads to the
 * thing actually being installed.
 */
const INSTALL_URL = 'https://surex-docs.vercel.app/guides/install';

/**
 * Two clusters, not one run of text.
 *
 * The tagline used to sit between the mark and the nav links, at the same size
 * and nearly the same ink as `registry` and `submit a server` — so it read as a
 * third destination. It is a description, so it belongs to the mark: same
 * cluster, tied to it by a hairline, one step quieter (`text-faint`, no
 * uppercase tracking). Everything you can go to now lives on the right.
 *
 * Glass rather than a solid bar: the page carries a halftone screen and a
 * two-hue wash, and a translucent chrome lets both run under it instead of
 * ending at a hard edge. The split rule beneath is the mark's own division,
 * restated at page width.
 */
export function Chrome() {
  const pathname = usePathname() ?? '/';

  return (
    <>
    <header className="flex flex-wrap items-center gap-x-3.5 gap-y-2 bg-glass px-7 py-3.5 backdrop-blur-md">
      {/* No aria-label on the link: the mark is an `img` that already carries
          the brand name, and labelling both makes one control announce two
          names. The SVG's label IS the link's accessible name. */}
      <Link href="/" className="no-underline">
        <Wordmark />
      </Link>
      <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-line" />
      <span className="text-mini text-faint">{COPY.brand.tagline}</span>

      <nav className="ml-auto flex items-center gap-4">
        {LINKS.map((link) => {
          const active = link.match(pathname);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'py-1 text-row no-underline transition-colors duration-[140ms] ease-out',
                active ? 'border-b border-accent text-ink' : 'text-ink-3 hover:text-ink-2',
              )}
            >
              {link.label}
            </Link>
          );
        })}
        {/*
          The only ACTION in the chrome, so it is the only thing here with a
          border. The nav links are destinations inside the site and stay plain;
          this one leaves for the docs and ends with the gate running on your
          machine, which is a different kind of click and should not look like
          a third tab.

          `rel="noreferrer"` alongside `noopener` because the target is a
          separate deployment: same project, different origin.
        */}
        <a
          href={INSTALL_URL}
          target="_blank"
          rel="noopener noreferrer"
          title={COPY.nav.installTitle}
          className="rounded-input border border-accent bg-accent-t px-3 py-1.5 text-row font-semibold text-accent no-underline transition-colors duration-[140ms] ease-out hover:bg-accent hover:text-panel"
        >
          {COPY.nav.install}
        </a>
        <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-line" />
        <ThemeToggle />
      </nav>
    </header>
    <SplitRule />
    </>
  );
}
