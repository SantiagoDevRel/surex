'use client';

import Link from 'next/link';
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
const MOBILE_ROW_LINK = 'text-[var(--v2-ink-3)]! hover:text-[var(--v2-ink)]!';

/**
 * Anchor ids the "how it works" and "disputes" nav items point at. The
 * sections that own these ids are built elsewhere in this same pass — see
 * the report handed back with this change for the exact expectation.
 */
/** The skip link's target — `page.tsx` puts this on <main>. */
export const MAIN_ID = 'main';

const HOW_IT_WORKS_ID = 'how-it-works';
const DISPUTES_ID = 'disputes';

const NAV_ITEMS = [
  { href: '/registry', label: COPY.home.nav.registry, internal: true },
  { href: `#${HOW_IT_WORKS_ID}`, label: COPY.home.nav.howItWorks, internal: false },
  { href: `#${DISPUTES_ID}`, label: COPY.home.nav.disputes, internal: false },
] as const;

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
 * The site's own header — the registry/dossier `Chrome` is suppressed on
 * this route (see `app/_components/Chrome.tsx`) and this replaces it.
 *
 * Desktop is one row: wordmark, three destinations, the install command as a
 * static bordered chip (not a control — there is nothing to click, it is the
 * command to paste). Below the breakpoint those five things do not fit, so
 * a trigger opens a native `<dialog>` — `showModal()` gives focus trap,
 * scroll lock and Escape-to-close for free, which is the whole reason this
 * is a client component while `Hero` and `Closer` are not.
 */
export function SiteHeader() {
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
        First focus stop on the page. The registry pages get this from
        `Chrome`, which is suppressed on this route — so without it here the
        homepage has no way past eight sections of chrome (WCAG 2.4.1).
        Visually hidden until focused, then it appears in place.
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
          {NAV_ITEMS.map((item) =>
            item.internal ? (
              <Link key={item.href} href={item.href} className={NAV_LINK}>
                {item.label}
              </Link>
            ) : (
              <a key={item.href} href={item.href} className={NAV_LINK}>
                {item.label}
              </a>
            ),
          )}
          <span className="border border-[var(--v2-border)] px-[var(--v2-space-3)] py-[var(--v2-space-2)] text-[15px] text-[var(--v2-ink)]">
            {COPY.home.nav.installCommand}
          </span>
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
          {NAV_ITEMS.map((item) =>
            item.internal ? (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeMenu}
                className={`${MOBILE_ROW_LINK} px-[var(--v2-gutter-mobile)] py-[var(--v2-space-3)]`}
              >
                {item.label}
              </Link>
            ) : (
              <a
                key={item.href}
                href={item.href}
                onClick={closeMenu}
                className={`${MOBILE_ROW_LINK} px-[var(--v2-gutter-mobile)] py-[var(--v2-space-3)]`}
              >
                {item.label}
              </a>
            ),
          )}
          <span className="mx-[var(--v2-gutter-mobile)] my-[var(--v2-space-4)] inline-block border border-[var(--v2-border)] px-[var(--v2-space-3)] py-[var(--v2-space-3)] text-[15px] text-[var(--v2-ink)]">
            {COPY.home.nav.installCommand}
          </span>
        </nav>
      </dialog>
    </header>
  );
}

export { HOW_IT_WORKS_ID, DISPUTES_ID };
