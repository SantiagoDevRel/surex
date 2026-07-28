import type { Metadata } from 'next';
import { SUSE } from 'next/font/google';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';

import { COPY } from '@/lib/copy.ts';

import { Chrome } from './_components/Chrome.tsx';
import { SiteFooter } from './_components/SiteFooter.tsx';
import './globals.css';

/**
 * Two typefaces, one job each: SUSE Mono → structure (rows, labels, stamps,
 * commands, terminals); SUSE → voice (findings, rebuttals, long-form).
 *
 * SUSE Mono is self-hosted (`next/font/local`, ./fonts) rather than loaded
 * from `next/font/google`, because this Next version's bundled font metadata
 * predates it and throws "Unknown font" at build time — self-hosting avoids
 * a render-blocking third-party `<link>` too. SIL OFL 1.1, redistribution permitted.
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${suse.variable} ${suseMono.variable}`}
    >
      <body className="font-mono">
        <Chrome />
        {/* Load-bearing wrapper: `body` is a flex column, and a flex ITEM with
            auto inline margins sizes to max-content instead of stretching —
            without this, the registry's widest table row forced a horizontal
            scroll on narrow viewports. `flex-1` pushes the footer down. */}
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
