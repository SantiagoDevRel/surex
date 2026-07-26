import type { Metadata } from 'next';
import { SUSE } from 'next/font/google';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';

import { COPY } from '@/lib/copy.ts';

import { Chrome } from './_components/Chrome.tsx';
import { SiteFooter } from './_components/SiteFooter.tsx';
import './globals.css';

/**
 * Two typefaces, one job each — the rule design/tokens.html §02 states, with
 * the pair the v2 design system names:
 *   SUSE Mono → structure: rows, labels, stamps, commands, terminals
 *   SUSE      → voice: findings, rebuttals, long-form
 * Nothing else. A third face would blur which of the two a block of text is.
 *
 * IBM Plex Mono and Source Serif 4 were that pair until the whole site moved to
 * the v2 language, and they are loaded here no longer. `--font-mono` and
 * `--font-serif` in globals.css now resolve to these two, so every screen reads
 * them under the names the components already use — which is why no component
 * changed. Leaving the old two declared would have downloaded two families
 * nothing renders.
 *
 * SUSE Mono is real and live on Google Fonts, but this Next version's bundled
 * `next/font/google` metadata predates it — `SUSE` resolves, `SUSE_Mono`
 * throws "Unknown font" at build time. So it is self-hosted instead, from
 * Google's own unmodified woff2 files in ./fonts.
 *
 * `next/font/local`, not a `<link>` to fonts.googleapis.com: a stylesheet link
 * is render-blocking, leaks every visitor to a third party, and forfeits the
 * layout-shift metrics next/font computes. Self-hosting costs 31 kB in the
 * repo and nothing at runtime.
 *
 * One file per subset, each a variable face spanning 400–700 — which is why
 * there is no weight list here. Vietnamese is skipped; the site is English.
 * Glyphs outside SUSE Mono's charset (→ ✕ ✓) fall back to the stack below,
 * and would have done so via the CDN too — that is the font's coverage, not
 * a consequence of how it is loaded.
 *
 * SIL Open Font License 1.1, which permits redistribution.
 */
const suse = SUSE({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
  variable: '--font-suse',
  display: 'swap',
});

const suseMono = localFont({
  src: [
    { path: './fonts/SUSEMono-latin.woff2', style: 'normal' },
    { path: './fonts/SUSEMono-latin-ext.woff2', style: 'normal' },
  ],
  variable: '--font-suse-mono',
  display: 'swap',
  fallback: ['ui-monospace', 'monospace'],
});

export const metadata: Metadata = {
  title: {
    default: `${COPY.brand.name} — ${COPY.brand.tagline}`,
    template: `%s · ${COPY.brand.name}`,
  },
  description: COPY.brand.description,
};

/**
 * No theme bootstrap script, and no `suppressHydrationWarning` that existed to
 * cover it. Both were there to apply a stored light/dark choice before first
 * paint; nothing themes any more (see the header of `globals.css`), so the
 * script had nothing to apply and the warning had nothing to suppress. Two
 * fewer things running before the first byte of content renders.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${suse.variable} ${suseMono.variable}`}
    >
      <body className="font-mono">
        <Chrome />
        {/*
          This wrapper is load-bearing, and not for layout reasons you can see.

          `body` is a flex column so the footer can sit at the bottom of short
          routes. Page content is a `<main className="mx-auto max-w-[...]">`,
          and a flex ITEM with auto inline margins does not stretch to the
          container — it sizes to max-content. The registry's widest table row
          is about 1060px, so at a 375px viewport `main` became 1060px wide and
          the whole document scrolled sideways. Measured, not theorised.

          Wrapping restores a block formatting context: this div is the flex
          item and stretches, `main` is an ordinary block inside it, and
          `mx-auto max-w-*` means what it has always meant. `flex-1` is what
          actually pushes the footer down.
        */}
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
