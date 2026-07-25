import { COPY } from '@/lib/copy.ts';

const PARTS = [
  COPY.footer.sourceBlobs,
  COPY.footer.verdictIndex,
  COPY.footer.personhood,
  COPY.footer.agentIdentity,
];

export function Footer() {
  return (
    <footer className="mt-14 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-line pt-4 text-mini text-ink-3">
      {/*
        The interpunct TRAILS its item rather than leading the next one, and
        that is the whole fix: this footer wraps at 736px and below — tablets,
        not just phones — and with a leading separator every wrapped line began
        with a bare "·" hanging in the left margin.

        The rhythm is unchanged, because it is the same glyph in the same place:
        the parent's gap-x-4 and this span's gap-4 are both 16px, so "part · part"
        measures identically whichever side of the boundary the dot is grouped
        with. What changes is only what happens at a line break — a line now
        ENDS with "·", which is how a continued list is supposed to read.

        No dot after the last part: the permanence line that follows is pushed
        away by ml-auto and was never dot-separated from this group.
      */}
      {PARTS.map((part, i) => (
        <span key={part} className="flex items-baseline gap-4">
          {part}
          {i < PARTS.length - 1 ? <span aria-hidden="true">·</span> : null}
        </span>
      ))}
      <span className="ml-auto">{COPY.footer.permanence}</span>
    </footer>
  );
}
