import type { CSSProperties } from 'react';

import { COPY } from '@/lib/copy.ts';
import { SX_COLUMNS, SX_T, type HalftoneState, type WriteReceipt } from '@/lib/submission.ts';
import { halftoneClass } from '@/lib/submission.ts';

/**
 * The four pieces of the motion system, as markup — presentational only. The
 * CSS is the whole animation (`app/globals.css`); no JS drives any of it, so
 * every keyframe track ends at its natural resting style and a static/print
 * render is always a settled, true frame. Inline `style` appears here and
 * nowhere else, only to set the animation's CSS custom-property inputs.
 */

/** Progress as dot density, not a bar. `aria-hidden` — the live text beside
 *  it already states the same fact in words. */
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

/** Mounted while the DGX has the source open. 40s before anything repeats
 *  exactly — a review runs for minutes, and a 2s spinner looks stuck too soon. */
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

/** The two readings, not agreeing. Mounts only on `disagreementReported()`,
 *  and its values are whatever the backend sent — never invented. */
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

/** A write that landed. The mount is the animation — 1.7s, once, keyed on the
 *  id it carries so a re-render doesn't replay it. */
export function WriteLanded({ receipt }: { receipt: WriteReceipt }) {
  const id = (
    <>
      <span className="text-faint">{receipt.idLabel} </span>
      {receipt.id}
    </>
  );

  // `.sx-write__blob` must go on the link, not inside it — `overflow: hidden`
  // does nothing on an inline box, so wrapping a clipped `<code>` in an `<a>`
  // un-clips it and the id runs out under the stamp.
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
