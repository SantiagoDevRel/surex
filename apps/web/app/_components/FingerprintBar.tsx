'use client';

import { useState } from 'react';

import { COPY } from '@/lib/copy.ts';
import { shortFingerprint } from '@/lib/format.ts';

/** Shortened on screen; the copy button hands over the full fingerprint,
 *  since a truncated one is useless to paste into `surex allow`. */
export function FingerprintBar({ prefix, fingerprint }: { prefix: string; fingerprint: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(fingerprint);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — the fingerprint is in the address bar anyway */
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-meta text-ink-3">
      <span>{prefix}</span>
      <span className="break-all text-ink-2">{shortFingerprint(fingerprint, 21, 8)}</span>
      <button
        type="button"
        onClick={copy}
        className="rounded-chip border border-line px-2 py-px text-label uppercase tracking-normal text-accent"
      >
        {copied ? COPY.verdict.copied : COPY.verdict.copy}
      </button>
    </div>
  );
}
