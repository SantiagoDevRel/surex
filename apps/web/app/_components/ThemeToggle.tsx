'use client';

import { useEffect, useState } from 'react';

import { COPY } from '@/lib/copy.ts';

type Theme = 'dark' | 'light';

/**
 * Dark is the default. `prefers-color-scheme` is honoured when no choice has
 * been made; this button writes `data-theme` on <html>, which beats the media
 * query in both directions (app/globals.css).
 *
 * The label is resolved after mount on purpose — the server cannot know which
 * theme a given reader is in, and guessing produces a hydration mismatch.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const stored = (() => {
      try {
        return window.localStorage.getItem('surex-theme');
      } catch {
        return null;
      }
    })();
    if (stored === 'light' || stored === 'dark') {
      setTheme(stored);
      return;
    }
    setTheme(window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  }, []);

  function toggle() {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem('surex-theme', next);
    } catch {
      /* a reader with storage blocked still gets the toggle, just not the memory */
    }
  }

  const label =
    theme === null
      ? COPY.nav.themeLabel
      : theme === 'light'
        ? `☾ ${COPY.nav.themeToDark}`
        : `☀ ${COPY.nav.themeToLight}`;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={COPY.nav.themeLabel}
      className="rounded-chip border border-line px-2.5 py-1 text-mini text-ink-2 transition-colors duration-[140ms] ease-out hover:text-ink"
    >
      {label}
    </button>
  );
}
