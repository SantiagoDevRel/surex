'use client';

import { useState } from 'react';

import { COPY } from '@/lib/copy.ts';

/** A command block with a copy affordance top-right. The command stands alone
 *  with nothing after it on the line, so a triple-click selects exactly it. */
export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — the command is still selectable on the page */
    }
  }

  return (
    <div className="relative rounded-input border border-line bg-panel-2 py-2.5 pl-3 pr-[74px] text-data text-ink">
      <code className="font-mono">{command}</code>
      <button
        type="button"
        onClick={copy}
        className="absolute right-2 top-1.5 rounded-chip border border-line px-2 py-0.5 text-label uppercase tracking-normal text-accent"
      >
        {copied ? COPY.verdict.copied : COPY.verdict.copy}
      </button>
    </div>
  );
}
