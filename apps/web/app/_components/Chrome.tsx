import { MAIN_ID, SiteHeader } from './home/SiteHeader.tsx';

/**
 * The site chrome, on every route.
 *
 * This used to be a second header: its own wordmark, its own type scale, its
 * own two links, an install button styled unlike the homepage's, and a theme
 * toggle. It was suppressed on `/` so the two would not stack — which is the
 * clearest statement of the problem, because a header that must be hidden when
 * the other one appears is not chrome, it is a second design. The registry read
 * as a different product one click from the landing page.
 *
 * So there is one header now and `SiteHeader` is it. This component's whole job
 * is to put it inside the v2 token scope on routes that are not the homepage —
 * `--v2-*` are plain custom properties that exist only under `[data-sx="v2"]`,
 * so outside that scope every one of them resolves to nothing and the header
 * renders unstyled. `/` gets the scope from `page.tsx`, which wraps the entire
 * page in it; nesting the attribute here as well is harmless (the values are
 * identical, and it is set, not inherited-and-modified), and paying for one
 * redundant wrapper is cheaper than a route-aware branch that has to be right.
 *
 * The theme toggle is gone with it. Nothing themes any more — see the header of
 * `globals.css` for why — so a control offering a choice that no longer exists
 * would have been a button that does nothing.
 */
export function Chrome() {
  return (
    <div data-sx="v2" className="bg-[var(--v2-page)] text-[var(--v2-ink)]">
      <SiteHeader />
      {/*
        The skip link's landing point. It sits here, once, rather than on each
        route's `<main>`: there are six of those across the app and the verdict
        and dispute routes carry three each, one per render branch, so "every
        `<main>` has the id" is a claim that quietly stops being true the next
        time somebody adds a branch. `tabIndex={-1}` because a plain <div> is
        not focusable, and a skip link whose target cannot take focus moves the
        viewport but leaves the keyboard where it was.
      */}
      <div id={MAIN_ID} tabIndex={-1} />
    </div>
  );
}
