import { MAIN_ID, SiteHeader } from './home/SiteHeader.tsx';

/**
 * The site chrome, on every route. Wraps `SiteHeader` in the v2 token scope
 * — `--v2-*` custom properties only exist under `[data-sx="v2"]`, so outside
 * that scope the header renders unstyled. `/` already gets the scope from
 * `page.tsx`; nesting it here too is harmless (identical values, set not
 * inherited) and cheaper than a route-aware branch that has to stay right.
 */
export function Chrome() {
  return (
    <div data-sx="v2" className="bg-[var(--v2-page)] text-[var(--v2-ink)]">
      <SiteHeader />
      {/* The skip link's landing point, once, not on each route's own `<main>`.
          `tabIndex={-1}` because a plain div isn't otherwise focusable. */}
      <div id={MAIN_ID} tabIndex={-1} />
    </div>
  );
}
