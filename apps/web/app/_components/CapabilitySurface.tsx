import { capabilityLine } from '@surex/core';

import { cn } from '@/lib/cn.ts';
import { COPY } from '@/lib/copy.ts';
import { stateStyle } from '@/lib/state-styles.ts';
import type { Capabilities, CapabilityKey, RowStatus } from '@/lib/types.ts';

import { Panel, PanelHeader, SectionLabel } from './Panel.tsx';

// Shown on every verdict. Intent-matching only checks whether code and
// description agree, so this panel carries what the code can actually reach,
// from a static scan — often the more useful half.

const ORDER: CapabilityKey[] = ['network', 'filesystem', 'exec', 'env', 'credentials'];

const LABEL: Record<CapabilityKey, string> = {
  network: 'network',
  filesystem: 'filesystem',
  exec: 'process exec',
  env: 'env variables',
  credentials: 'credentials',
};

export function CapabilitySurface({
  capabilities,
  state,
}: {
  capabilities?: Capabilities;
  state: RowStatus;
}) {
  const s = stateStyle(state);
  const line = capabilityLine(capabilities) as string | null;

  return (
    <Panel>
      <PanelHeader>
        <SectionLabel>{COPY.verdict.capabilityLabel}</SectionLabel>
        <span className="text-micro text-faint">{COPY.verdict.capabilityNote}</span>
      </PanelHeader>

      {capabilities ? (
        ORDER.map((key) => {
          const cap = capabilities[key];
          const present = cap?.present === true;
          return (
            <div
              key={key}
              className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1 border-b border-line-2 px-5 py-2.5 last:border-b-0"
            >
              <span
                className={cn(
                  'w-3.5 shrink-0 font-semibold',
                  cap?.implicated ? s.text : present ? 'text-ink-2' : 'text-faint',
                )}
                aria-hidden="true"
              >
                {present ? '✓' : '—'}
              </span>
              <span
                className={cn(
                  'w-[150px] shrink-0 text-data',
                  present ? 'text-ink' : 'text-ink-3',
                )}
              >
                {LABEL[key]}
              </span>
              <span className="text-data text-ink-2">
                {cap?.what ?? cap?.detail ?? COPY.verdict.capabilityAbsent}
              </span>
              {cap?.proof ? (
                <span
                  className={cn(
                    'ml-auto text-meta',
                    cap.implicated ? s.text : 'text-accent',
                  )}
                >
                  {cap.proof}
                </span>
              ) : null}
            </div>
          );
        })
      ) : (
        <div className="px-5 py-4 text-data text-ink-3">
          No capability scan is recorded for this entry.
        </div>
      )}

      {line ? (
        <div className="border-t border-line px-5 py-2.5 text-row text-ink-2">
          This code can reach: {line}
        </div>
      ) : null}
    </Panel>
  );
}
