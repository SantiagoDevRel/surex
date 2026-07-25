import type { Metadata } from 'next';
import { IBM_Plex_Mono, Source_Serif_4 } from 'next/font/google';
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
    <html lang="en" className={`${mono.variable} ${serif.variable}`} suppressHydrationWarning>
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
