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
        <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-line" />
        <ThemeToggle />
      </nav>
    </header>
    <SplitRule />
    </>
  );
}
