import { cn } from '@/lib/cn.ts';
import { COPY } from '@/lib/copy.ts';

/**
 * The mark, and it is the product model rather than a logo dropped on top.
 *
 *   the capsule is split down the middle — emerald on the left, tangerine on
 *   the right — for the two verdicts the GATE acts on: pass it silently, or
 *   stop the call.
 *   the wordmark takes the same split.
 *   the x's leg BREAKS THE OUTLINE at the lower right. That is a call being
 *   stopped: the gate is the one place the registry reaches out of its own
 *   boundary and interrupts something.
 *
 * ⚠️ Two colours here are NOT a claim that the registry has two answers. It
 * has seven (`COPY.states`), and `unknown` — nobody has looked — is the one
 * the registry holds most of, which is the whole point of "absence of a
 * verdict is absence of knowledge". The mark shows what the gate DOES, not
 * what the registry KNOWS; the states are enumerated on the page, in words,
 * where a claim like that belongs. Nothing here should ever grow into a
 * legend.
 *
 * Drawn rather than shipped as an asset so it follows the theme: the two
 * gradients read from `--sx-clean-hi/--sx-clean` and their tangerine twins, so
 * the light variant is the darker, denser ink of the same two hues and not a
 * pale image on a pale page. Minimal on purpose — two stops, one hue each.
 *
 * Geometry (viewBox 126×52): the stadium is x 2→118, y 2→42, caps of r=20
 * centred at (22,22) and (98,22). The right cap stops at θ=70° and the bottom
 * edge restarts at the cap's foot (θ=90°); that arc is the gap. The leg starts
 * at the X's lower-right terminal, crosses the gap at θ≈81°, and stops just
 * outside — a break, not a tail. Fixed coordinates, so it lands in the same
 * place whether or not the webfont has loaded.
 */

const NAME = COPY.brand.name;
const HEAD = NAME.slice(0, -1);
const TAIL = NAME.slice(-1);

export function Wordmark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 126 52"
      role="img"
      aria-label={NAME}
      className={cn('block h-[26px] w-auto', className)}
    >
      <defs>
        <linearGradient id="sx-mark-clean" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="[stop-color:var(--sx-clean-hi)]" />
          <stop offset="1" className="[stop-color:var(--sx-clean)]" />
        </linearGradient>
        <linearGradient id="sx-mark-flagged" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="[stop-color:var(--sx-flagged-hi)]" />
          <stop offset="1" className="[stop-color:var(--sx-flagged)]" />
        </linearGradient>
      </defs>

      {/* left half of the capsule */}
      <path
        d="M60 2 H22 A20 20 0 0 0 22 42 H60"
        fill="none"
        stroke="url(#sx-mark-clean)"
        strokeWidth={3}
        strokeLinecap="round"
      />
      {/* right half, interrupted at the lower right */}
      <path
        d="M60 2 H98 A20 20 0 0 1 104.84 40.79 M98 42 H60"
        fill="none"
        stroke="url(#sx-mark-flagged)"
        strokeWidth={3}
        strokeLinecap="round"
      />
      {/* the leg that goes through the break */}
      <path
        d="M86.5 27 L106 46.5"
        fill="none"
        stroke="url(#sx-mark-flagged)"
        strokeWidth={3}
        strokeLinecap="round"
      />

      <text
        x="60"
        y="28.5"
        textAnchor="middle"
        letterSpacing="1.6"
        fontSize="17"
        fontWeight="600"
        className="font-mono"
      >
        <tspan fill="url(#sx-mark-clean)">{HEAD}</tspan>
        <tspan fill="url(#sx-mark-flagged)">{TAIL}</tspan>
      </text>
    </svg>
  );
}

/**
 * The split, as a page rule. One hairline under the chrome, carrying the
 * capsule's division at page width. Decorative — it is hidden from the
 * accessibility tree and carries no legend, for the reason in `Wordmark`.
 */
export function SplitRule({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'block h-px w-full bg-[image:linear-gradient(90deg,var(--sx-clean-l)_0_50%,var(--sx-flagged-l)_50%_100%)]',
        className,
      )}
    />
  );
}
