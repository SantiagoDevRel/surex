import type { CSSProperties } from 'react';

import { COPY } from '@/lib/copy.ts';
import { SX_COLUMNS, SX_T, type HalftoneState, type WriteReceipt } from '@/lib/submission.ts';
import { halftoneClass } from '@/lib/submission.ts';

/**
 * The four pieces of the motion system, as markup. Presentational only — they
 * take values and render them, and every one of them can render "there is no
 * value" without inventing one.
 *
 * The CSS is the whole animation (`app/globals.css`, SUREX MOTION v1). There is
 * no JS driving any of it, which is what makes the static render correct: every
 * keyframe track ends at the natural resting style, so a screenshot, a print or
 * a reduced-motion browser gets a settled, true frame rather than a half-drawn
 * one.
 *
 * Inline `style` appears here and nowhere else in the app, and only ever to set
 * a CSS custom property — `--sx-p`, `--t`, `--c` are the animation's inputs and
 * a Tailwind class cannot carry a per-element number.
 */

/**
 * Progress as dot density. There is no bar: `--sx-p` is `done / total` and the
 * dots light as it crosses each one's dither threshold.
 *
 * `aria-hidden` because it is the same fact the live text beside it already
 * states — a screen reader announcing 48 dots would be announcing nothing.
 */
export function Halftone({ state, fraction }: { state: HalftoneState; fraction: number }) {
  return (
    <div
      className={halftoneClass(state)}
      style={{ '--sx-p': fraction } as CSSProperties}
      aria-hidden="true"
    >
      {SX_T.map((t, i) => (
        <i key={i} style={{ '--t': t, '--c': i % SX_COLUMNS } as CSSProperties} />
      ))}
    </div>
  );
}

/**
 * Mounted while the DGX has the source open, unmounted when it stops.
 *
 * The head sweeps, ink accumulates behind it, the page pulls away and the pass
 * dots step every loop — 40 seconds before anything repeats exactly, which is
 * the point: a review runs for minutes and a two-second spinner looks stuck long
 * before it is.
 */
export function ReadingPulse({ source }: { source: string }) {
  return (
    <div className="sx-reading" aria-hidden="true">
      <div className="sx-reading__top">
        <span className="sx-reading__ico" />
        <span className="sx-reading__src">{source}</span>
      </div>
      <div className="sx-reading__doc">
        <div className="sx-reading__line l1" />
        <div className="sx-reading__line l2" />
        <div className="sx-reading__line l3" />
        <div className="sx-reading__line l4" />
        <div className="sx-reading__line l5" />
        <div className="sx-reading__head" />
      </div>
      <div className="sx-reading__meta">
        <em>{COPY.pipeline.readingLabel}</em>
        <span className="sx-reading__pages">
          <i />
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  );
}

/**
 * The two readings, not agreeing.
 *
 * Bilateral by design: emphasis oscillates between the two cards in exact
 * antiphase and never lands, because the system has not picked a side. It mounts
 * only on `disagreementReported()` — something the backend said — and its two
 * values are whatever the backend sent. When it sent none, the cards say so;
 * putting two plausible verdicts in there would be manufacturing the split the
 * panel is about.
 */
export function Disagreement({ a, b }: { a: string | null; b: string | null }) {
  return (
    <div className="sx-disagree" aria-hidden="true">
      <div className="sx-disagree__card">
        <span className="sx-disagree__tag">{COPY.pipeline.readingOne}</span>
        <strong className="sx-disagree__val">{a ?? '—'}</strong>
        <em className="sx-disagree__ctx">{a ? '' : COPY.pipeline.readingAbsent}</em>
      </div>
      <span className="sx-disagree__vs">≠</span>
      <div className="sx-disagree__card sx-disagree__card--b">
        <span className="sx-disagree__tag">{COPY.pipeline.readingTwo}</span>
        <strong className="sx-disagree__val">{b ?? '—'}</strong>
        <em className="sx-disagree__ctx">{b ? '' : COPY.pipeline.readingAbsent}</em>
      </div>
      <div className="sx-disagree__reruns">
        <div className="sx-rerun">
          <span>{COPY.pipeline.rerunThree}</span>
          <span className="sx-rerun__bar">
            <i />
          </span>
        </div>
        <div className="sx-rerun">
          <span>{COPY.pipeline.rerunFour}</span>
          <span className="sx-rerun__bar">
            <i />
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * A write that landed. The mount IS the animation — 1.7s, once, never looping —
 * so it is keyed on the identifier it carries and a re-render does not replay it.
 *
 * It is only ever built from an id the pipeline reported (`writeReceipts()`), so
 * there is no pending variant of this component and no placeholder id. The
 * second line is omitted when no hash or digest was reported rather than being
 * filled with an ellipsis that reads like a value.
 */
export function WriteLanded({ receipt }: { receipt: WriteReceipt }) {
  const id = (
    <>
      <span className="text-faint">{receipt.idLabel} </span>
      {receipt.id}
    </>
  );

  /**
   * `.sx-write__blob` goes on the LINK, not inside it.
   *
   * A blob id is 44 characters and an entity key is longer; the class is what
   * clips them, and `overflow: hidden` does nothing on an inline box. Wrapping a
   * `<code class="sx-write__blob">` in an `<a>` therefore un-clipped it and the id
   * ran out under the stamp — caught in a render, not in review. The element that
   * carries the class has to be the grid item, which is also the element the
   * typewriter reveal animates.
   */
  return (
    <div className="sx-write">
      <svg className="sx-write__tick" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M4 10.5 8.2 14.5 16 6" />
      </svg>
      <span className="sx-write__ids">
        {receipt.href ? (
          <a
            href={receipt.href}
            target="_blank"
            rel="noreferrer"
            title={`${receipt.kind === 'walrus' ? COPY.pipeline.openBlob : COPY.pipeline.openEntity} — ${receipt.id}`}
            className="sx-write__blob underline decoration-line underline-offset-2 hover:decoration-ink"
          >
            {id}
          </a>
        ) : (
          <code className="sx-write__blob" title={receipt.id}>
            {id}
          </code>
        )}
        {receipt.second ? (
          <code className="sx-write__txn" title={receipt.second}>
            {receipt.second}
          </code>
        ) : null}
      </span>
      <span className="sx-write__stamp">{receipt.stamp}</span>
    </div>
  );
}
