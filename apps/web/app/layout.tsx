import type { Metadata } from 'next';
import { IBM_Plex_Mono, Source_Serif_4, SUSE } from 'next/font/google';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';

import { COPY } from '@/lib/copy.ts';

import { Chrome } from './_components/Chrome.tsx';
import './globals.css';

/**
 * design/tokens.html §02 — two typefaces, one job each.
 *   IBM Plex Mono   → structure: rows, labels, stamps, commands, terminals
 *   Source Serif 4  → evidence prose: findings, rebuttals, long-form
 * Nothing else. A third face would blur which of the two a block of text is.
 */
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-plex-mono',
  display: 'swap',
});

const serif = Source_Serif_4({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  variable: '--font-source-serif',
  display: 'swap',
});

/**
 * v2 homepage only — SUSE (voice) and SUSE Mono (structure). Registry pages
 * stay on `mono`/`serif` above; these two are additive, not a replacement.
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
 * Applied before first paint so a reader who chose light does not get a frame
 * of dark. Dark stays the default: with no stored choice this script does
 * nothing and the CSS decides.
 */
const THEME_BOOTSTRAP =
  "try{var t=localStorage.getItem('surex-theme');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t}}catch(e){}";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${mono.variable} ${serif.variable} ${suse.variable} ${suseMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="font-mono">
        <Chrome />
        {children}
      </body>
    </html>
  );
}
