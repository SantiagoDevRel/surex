import { COPY } from '@/lib/copy.ts';
import { tierNote } from '@/lib/verdict-view.ts';
import type { Entry, RowStatus, Tier } from '@/lib/types.ts';

import { LinkageChain } from './LinkageChain.tsx';
import { Panel, SectionLabel } from './Panel.tsx';

export function LinkagePanel({ entry }: { entry: Entry }) {
  const { head } = entry;
  const expired = (entry.source?.blob ?? head.evidence)?.retrievable === false;

  return (
    <Panel className="mt-8 px-5 py-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <SectionLabel>{COPY.verdict.linkageLabel}</SectionLabel>
        <span className="text-micro text-faint">{COPY.verdict.linkageNote}</span>
      </div>

      <div className="mt-3.5 overflow-x-auto">
        <LinkageChain
          state={head.state as RowStatus}
          tier={expired ? 'C' : ((head.tier ?? 'C') as Tier)}
          blobId={entry.source?.blob?.blobId ?? head.evidence?.blobId}
          localText={entry.localLinkage?.text ?? 'nothing was compared'}
          localTone={entry.localLinkage?.tone ?? 'unknown'}
          note={tierNote(head, entry)}
        />
      </div>
    </Panel>
  );
}
