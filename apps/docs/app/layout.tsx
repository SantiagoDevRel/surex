import type { Metadata } from 'next';
import { IBM_Plex_Mono, Source_Serif_4 } from 'next/font/google';
import { Footer, Layout, Navbar } from 'nextra-theme-docs';
import { Head } from 'nextra/components';
import { getPageMap } from 'nextra/page-map';
import type { ReactNode } from 'react';

import './globals.css';

/**
 * design/tokens.html §02. Self-hosted by next/font at build time — this site
 * makes no request to a CDN at runtime, which for a project about what your
 * tools reach out to is not a detail.
 */
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
});

const serif = Source_Serif_4({
  subsets: ['latin'],
  variable: '--font-source-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'SureX docs — a trust registry for MCP servers, and a gate that reads it',
    template: '%s · SureX docs',
  },
  description:
    'How to install the SureX gate, read a verdict, submit a server and contest one. Written to be read by a person and by an agent.',
};

const navbar = (
  <Navbar
    logo={
      <span className="flex items-center gap-3">
        <span className="sx-mark">SUREX</span>
        <span style={{ fontSize: 10, opacity: 0.55 }}>docs</span>
      </span>
    }
    projectLink="https://github.com/SantiagoDevRel/surex"
    // The registry is the product; the docs are about it. Keep it one click away.
    chatLink="https://arkiv-surex.vercel.app"
    chatIcon={<span style={{ fontSize: 11 }}>registry ↗</span>}
  />
);

const footer = (
  <Footer>
    <div style={{ fontSize: 11, lineHeight: 1.7 }}>
      Reviews are automated. No human audits them. A verdict describes the version that was reviewed —
      not necessarily the copy installed on your machine.
      <br />
      <a href="https://github.com/SantiagoDevRel/surex">github.com/SantiagoDevRel/surex</a> ·{' '}
      <a href="https://arkiv-surex.vercel.app">registry</a> ·{' '}
      <a href="https://arkiv-surex-api.vercel.app">API</a> · <a href="/llms.txt">llms.txt</a>
    </div>
  </Footer>
);

export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      dir="ltr"
      className={`${mono.variable} ${serif.variable}`}
      suppressHydrationWarning
    >
      <Head
        // hsl of the SureX accent: #33608f in light, #7aa3cc in dark.
        color={{ hue: 210, saturation: 46, lightness: { light: 38, dark: 64 } }}
        backgroundColor={{ light: '#f5f2ea', dark: '#141310' }}
      />
      <body>
        <Layout
          navbar={navbar}
          footer={footer}
          pageMap={await getPageMap()}
          docsRepositoryBase="https://github.com/SantiagoDevRel/surex/tree/main/apps/docs"
          // Dark-first, like the registry.
          nextThemes={{ defaultTheme: 'dark', attribute: 'class' }}
          editLink="Edit this page"
          sidebar={{ defaultMenuCollapseLevel: 2 }}
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}
