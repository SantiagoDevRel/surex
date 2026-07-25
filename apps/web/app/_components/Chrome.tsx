'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/cn.ts';
import { COPY } from '@/lib/copy.ts';

import { ThemeToggle } from './ThemeToggle.tsx';

const LINKS = [
  { href: '/', label: COPY.nav.registry, match: (p: string) => p === '/' || p.startsWith('/r/') },
  { href: '/submit', label: COPY.nav.submit, match: (p: string) => p.startsWith('/submit') },
];

export function Chrome() {
  const pathname = usePathname() ?? '/';

  return (
    <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-7 py-3.5">
      <Link
        href="/"
        className="border-2 border-ink px-2.5 py-[3px] text-body font-semibold tracking-[0.24em] text-ink no-underline"
      >
        {COPY.brand.name}
      </Link>
      <span className="text-label tracking-[0.08em] text-ink-3">{COPY.brand.tagline}</span>

      <nav className="flex items-center gap-4">
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
      </nav>

      <span className="ml-auto flex items-center gap-3">
        <ThemeToggle />
      </span>
    </header>
  );
}
