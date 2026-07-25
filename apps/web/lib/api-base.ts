/**
 * Where the registry lives. Split out of `api.ts` so a CLIENT component can ask
 * for it.
 *
 * `api.ts` imports `@surex/core`, and `@surex/core` reaches `node:crypto` and
 * `node:fs` — vendored into the Claude Code plugin, which runs on a machine with
 * nothing installed, so those imports are correct and are not going anywhere.
 * They just cannot be bundled into a browser. The submit page's live loader runs
 * in the browser and needs exactly this one function, so this is the one function
 * that moved.
 *
 * `api.ts` re-exports it, so every existing importer is unaffected.
 */

/** Dev default matches the port the API lane runs on. */
export const DEFAULT_BASE = 'http://localhost:4310';

export function apiBase(): string {
  const raw = process.env.NEXT_PUBLIC_SUREX_API?.trim();
  return (raw && raw.length ? raw : DEFAULT_BASE).replace(/\/+$/, '');
}
