'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef, useState } from 'react';
import type { MouseEvent } from 'react';

import { COPY } from '@/lib/copy.ts';

/**
 * `[data-sx="v2"] a` in globals.css sets a default anchor look as a plain,
 * unlayered rule, which in Tailwind v4 outranks any ordinary utility class
 * regardless of specificity — so overriding it needs the trailing-`!`
 * important modifier. `NAV_LINK` drops the border entirely; `MOBILE_ROW_LINK`
 * keeps it, since it doubles as the mobile list's row separator.
 */
const NAV_LINK = 'border-b-0! text-[var(--v2-ink-3)]! hover:text-[var(--v2-ink)]!';
const NAV_LINK_ACTIVE = 'border-b-0! text-[var(--v2-ink)]!';
const MOBILE_ROW_LINK = 'text-[var(--v2-ink-3)]! hover:text-[var(--v2-ink)]!';

/** The skip link's target, dropped once by `Chrome` after the header — not by
 *  each page's own `<main>`, since several routes render more than one. */
export const MAIN_ID = 'main';

const HOW_IT_WORKS_ID = 'how-it-works';
const DISPUTES_ID = 'disputes';

// DOCS_URL must stay declared above NAV_ITEMS: NAV_ITEMS is built at module
// load, and a const read before its own declaration is a TDZ throw.
const DOCS_URL = 'https://surex-docs.vercel.app';

/** `exact` for `/`; prefix for the rest, so e.g. `/r/<fingerprint>` keeps
 *  `/registry` lit without `/` itself matching every route. */
const NAV_ITEMS = [
  { href: '/', label: COPY.nav.home, external: false, isActive: (p: string) => p === '/' },
  {
    href: '/registry',
    label: COPY.nav.registry,
    external: false,
    isActive: (p: string) => p.startsWith('/registry') || p.startsWith('/r/'),
  },
  {
    href: '/submit',
    label: COPY.nav.submit,
    external: false,
    isActive: (p: string) => p.startsWith('/submit') || p.startsWith('/d/'),
  },
  { href: DOCS_URL, label: COPY.nav.docs, external: true, isActive: () => false },
  { href: COPY.brand.repoUrl, label: COPY.nav.github, external: true, isActive: () => false },
] as const;

// Leaves for the docs deployment — same project, different origin, hence
// `noreferrer` alongside `noopener`.
const INSTALL_URL = 'https://surex-docs.vercel.app/guides/install';

function HeaderWordmark() {
  const name = COPY.brand.name.toLowerCase();
  const head = name.slice(0, -1);
  const tail = name.slice(-1);
  return (
    <span className="text-[19px] font-extrabold tracking-[-0.04em] text-[var(--v2-ink)]">
      {head}
      <span className="text-[var(--v2-clean)]">{tail}</span>
    </span>
  );
}

/**
 * The site's one header, on every route. `'use client'` because the mobile
 * menu uses `showModal()` (focus trap, scroll lock, Escape-to-close) and
 * `usePathname` marks the active destination from the live route.
 */
export function SiteHeader() {
  const pathname = usePathname() ?? '/';
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Mirrored in state so the trigger can report `aria-expanded`; the dialog's
  // `open` attribute alone doesn't tell a screen reader whether it's showing.
  const [menuOpen, setMenuOpen] = useState(false);

  function openMenu() {
    dialogRef.current?.showModal();
    setMenuOpen(true);
  }
  // Focus goes back to the trigger explicitly — `close()` alone drops it to
  // `<body>`, losing a keyboard reader's place (WCAG 2.4.3).
  function closeMenu() {
    dialogRef.current?.close();
    setMenuOpen(false);
    triggerRef.current?.focus();
  }
  function onBackdropClick(e: MouseEvent<HTMLDialogElement>) {
    if (e.target === dialogRef.current) closeMenu();
  }

  return (
    <header>
      {/* First focus stop on every route (WCAG 2.4.1); visually hidden until focused. */}
      <a
        href={`#${MAIN_ID}`}
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-[var(--v2-space-3)] focus:bg-[var(--v2-ink)] focus:px-[var(--v2-space-4)] focus:py-[var(--v2-space-3)] focus:text-[var(--v2-page)] focus:no-underline"
      >
        {COPY.nav.skipToContent}
      </a>
      <div className="flex items-center gap-[30px] px-[var(--v2-gutter-mobile)] py-[20px] md:px-[var(--v2-gutter)] md:py-[24px]">
        <Link href="/" className="border-b-0! -mx-[2px] -my-[8px] shrink-0 px-[2px] py-[8px]">
          <HeaderWordmark />
        </Link>

        <nav
          aria-label={COPY.brand.name}
          className="ml-auto hidden items-center gap-[var(--v2-space-5)] font-[family-name:var(--font-suse-mono)] text-[11.5px] md:flex"
        >
          {NAV_ITEMS.map((item) => {
            const active = item.isActive(pathname);
            return item.external ? (
              <a
                key={item.href}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className={NAV_LINK}
              >
                {item.label}
              </a>
            ) : (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={active ? NAV_LINK_ACTIVE : NAV_LINK}
              >
                {item.label}
              </Link>
            );
          })}
          <a
            href={INSTALL_URL}
            target="_blank"
            rel="noopener noreferrer"
            title={COPY.nav.installTitle}
            className="border-b-0! bg-[var(--v2-ink)]! px-[var(--v2-space-4)] py-[var(--v2-space-2)] text-[11.5px] font-bold text-[var(--v2-page)]!"
          >
            {COPY.nav.install}
          </a>
        </nav>

        {/* Touch target is padding, not a fixed height, so it clears 44px
            without clipping if the line ever wraps. */}
        <button
          ref={triggerRef}
          type="button"
          onClick={openMenu}
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          className="ml-auto px-[14px] py-[15px] font-[family-name:var(--font-suse-mono)] text-[11.5px] text-[var(--v2-ink-3)] md:hidden"
        >
          {COPY.home.nav.menuOpen}
        </button>
      </div>

      <dialog
        ref={dialogRef}
        onClick={onBackdropClick}
        // Escape closes a native dialog without firing onClick.
        onCancel={(e) => {
          e.preventDefault();
          closeMenu();
        }}
        onClose={() => setMenuOpen(false)}
        aria-label={COPY.brand.name}
        className="m-0 h-dvh max-h-none w-full max-w-none border-0 bg-[var(--v2-page)] p-0 text-[var(--v2-ink)] backdrop:bg-[var(--v2-page)]"
      >
        <div className="flex items-center justify-between px-[var(--v2-gutter-mobile)] py-[20px]">
          <HeaderWordmark />
          <button
            type="button"
            onClick={closeMenu}
            className="px-[14px] py-[15px] font-[family-name:var(--font-suse-mono)] text-[11.5px] text-[var(--v2-ink-3)]"
          >
            {COPY.home.nav.menuClose}
          </button>
        </div>

        <nav
          aria-label={COPY.brand.name}
          className="flex flex-col font-[family-name:var(--font-suse-mono)] text-[14px]"
        >
          {NAV_ITEMS.map((item) => {
            const active = item.isActive(pathname);
            const row = `${MOBILE_ROW_LINK} px-[var(--v2-gutter-mobile)] py-[var(--v2-space-3)]`;
            return item.external ? (
              <a
                key={item.href}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={closeMenu}
                className={row}
              >
                {item.label}
              </a>
            ) : (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeMenu}
                aria-current={active ? 'page' : undefined}
                className={
                  active
                    ? `text-[var(--v2-ink)]! px-[var(--v2-gutter-mobile)] py-[var(--v2-space-3)]`
                    : row
                }
              >
                {item.label}
              </Link>
            );
          })}
          <a
            href={INSTALL_URL}
            target="_blank"
            rel="noopener noreferrer"
            title={COPY.nav.installTitle}
            onClick={closeMenu}
            className="border-b-0! mx-[var(--v2-gutter-mobile)] my-[var(--v2-space-4)] inline-block bg-[var(--v2-ink)]! px-[var(--v2-space-4)] py-[var(--v2-space-3)] text-center text-[14px] font-bold text-[var(--v2-page)]!"
          >
            {COPY.nav.install}
          </a>
        </nav>
      </dialog>
    </header>
  );
}

export { HOW_IT_WORKS_ID, DISPUTES_ID };
