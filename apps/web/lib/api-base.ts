/**
 * Split out of `api.ts` so client components can use it: `api.ts` imports
 * `@surex/core`, which reaches `node:crypto`/`node:fs` and cannot be bundled
 * into a browser.
 */

/** Dev default matches the port the API lane runs on. */
export const DEFAULT_BASE = 'http://localhost:4310';

export function apiBase(): string {
  const raw = process.env.NEXT_PUBLIC_SUREX_API?.trim();
  return (raw && raw.length ? raw : DEFAULT_BASE).replace(/\/+$/, '');
}
