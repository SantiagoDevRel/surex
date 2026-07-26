'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef, useState } from 'react';
import type { MouseEvent } from 'react';

import { COPY } from '@/lib/copy.ts';

/**
 * `[data-sx="v2"] a` in globals.css sets a default anchor look — ink text,
 * a hairline border-bottom in `--v2-border`, brightening to `--v2-accent` on
 * hover — as a plain, unlayered rule, which in Tailwind v4 outranks any
 * ordinary utility class regardless of specificity. Where that default *is*
 * the look we want (nothing here needs it as-is, but the secondary button in
 * `Hero` rides it unchanged), no override is needed. Where the chrome needs
 * something the default doesn't give it — a muted resting colour, no border
 * at all — the only reliable way to win is the trailing-`!` important
 * modifier, which beats any non-`!important` rule no matter which layer (or
 * no layer) it lives in.
 *
 * Two shapes of the override: the desktop row sits flush with no rule under
 * it at all (`NAV_LINK`), while the stacked mobile list keeps the hairline
 * the default rule already draws — it doubles as the row separator, so
 * `MOBILE_ROW_LINK` overrides only the colour and leaves the border alone.
 */
const NAV_LINK = 'border-b-0! text-[var(--v2-ink-3)]! hover:text-[var(--v2-ink)]!';
const NAV_LINK_ACTIVE = 'border-b-0! text-[var(--v2-ink)]!';
const MOBILE_ROW_LINK = 'text-[var(--v2-ink-3)]! hover:text-[var(--v2-ink)]!';

/**
 * The skip link's target. `Chrome` drops this immediately after the header on
 * every route, rather than each page putting it on its own `<main>`: there are
 * six `<main>` elements across the app and the verdict and dispute routes each
 * carry three, one per render branch. One target the chrome owns is the only
 * version of this that cannot silently go missing on a branch nobody re-read.
 */
export const MAIN_ID = 'main';

/**
 * Four destinations and one action, in the order the user reads them: what the
 * product is, what it has reviewed, how to add to it, where the code lives —
 * then the one thing that changes anything on their machine.
 *
 * `#how-it-works` and `#disputes` used to sit here. They are anchors into the
 * homepage, and this header now renders on every route, so from `/registry`
 * they pointed at ids that are not on the page. A nav item that does nothing
 * from four of the five routes it appears on is worse than one fewer nav item.
 * Both sections are still on the homepage and still reachable by scrolling it.
 */
const HOW_IT_WORKS_ID = 'how-it-works';
const DISPUTES_ID = 'disputes';

/**
 * `exact` for `/`, prefix for the rest — `/registry` has to stay lit while you
 * are reading `/r/<fingerprint>`, which is a registry entry and not a fifth
 * destination, and the same holds for `/d/<fingerprint>` under submit's
 * sibling. `/` matched as a prefix would light HOME on every page there is.
 */
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
  { href: COPY.brand.repoUrl, label: COPY.nav.github, external: true, isActive: () => false },
] as const;

/**
 * The install action. It leaves for the docs deployment — same project,
 * different origin, hence `noreferrer` alongside `noopener`.
 *
 * This replaces the static `/plugin install surex@surex` chip that used to sit
 * here. The chip was the command to paste, which is the right thing to show
 * once you have decided; in the chrome of every page it was a string you could
 * not click sitting exactly where a control belongs. The command itself is not
 * lost — `InstallBand` and `Closer` both still print it, with a copy button.
 */
const INSTALL_URL = 'https://surex-docs.vercel.app/guides/install';

/** design/tokens.html — small register: the x stays sage below 120px. Only
 * the closer's display-scale wordmark ever earns the emerald. */
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
 * The site's ONE header, on every route. It began as the homepage's own — the
 * registry ran a separate `Chrome` with a different wordmark, a different type
 * scale and a theme toggle — and the two headers were the most visible half of
 * the site reading as two products. `Chrome` now renders this and nothing else.
 *
 * Desktop is one row: wordmark, four destinations, the install action. Below
 * the breakpoint those do not fit, so a trigger opens a native `<dialog>` —
 * `showModal()` gives focus trap, scroll lock and Escape-to-close for free,
 * which is the whole reason this is a client component while `Hero` and
 * `Closer` are not. `usePathname` is the second reason: the current
 * destination is marked, and marking it is a read of the live route.
 */
export function SiteHeader() {
  const pathname = usePathname() ?? '/';
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  /**
   * Mirrored in state only so the trigger can report `aria-expanded`. The
   * dialog's own `open` attribute is the source of truth for whether it is
   * showing; without this, a screen reader is told the button opens a dialog
   * but never whether that dialog is currently open.
   */
  const [menuOpen, setMenuOpen] = useState(false);

  function openMenu() {
    dialogRef.current?.showModal();
    setMenuOpen(true);
  }
  /**
   * Focus goes back to the trigger explicitly. `close()` alone dropped it to
   * `<body>`, which loses a keyboard reader's place entirely — they would have
   * to tab from the top of the page again (WCAG 2.4.3).
   */
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
      {/*
        First focus stop on the page, on every route (WCAG 2.4.1). Visually
        hidden until focused, then it appears in place. Its target is dropped
        by `Chrome` immediately after this header — see MAIN_ID above.
      */}
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
          {/*
            Filled, not outlined: `Hero`'s primary action is `bg-[var(--v2-ink)]`
            with page-coloured text, and this is the same action. An outlined box
            here would have been a fifth thing that looks like the four
            destinations beside it.
          */}
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

        {/*
          Touch target is padding, not a fixed height (design system screen
          07 — "44pt minimum, padded not sized"): 15px top/bottom around an
          11.5px mono line clears 44px without pinning a min-height that
          would clip if the line ever wrapped or the font metrics shifted.
        */}
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
        /* Escape closes a native dialog without firing onClick, so `cancel`
           is where the state reset and focus restore have to hang too. */
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
