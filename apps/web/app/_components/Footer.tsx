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
      {/* Interpunct trails its item rather than leading the next one — a leading
          separator left a bare "·" hanging in the margin on a wrapped line. */}
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
