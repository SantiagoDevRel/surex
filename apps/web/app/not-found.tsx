import Link from 'next/link';

import { COPY } from '@/lib/copy.ts';

export default function NotFound() {
  return (
    <main className="mx-auto max-w-[1020px] px-7 pb-20 pt-9">
      <h1 className="text-title font-semibold text-ink-3">No such page.</h1>
      <p className="mt-2 max-w-[70ch] font-serif text-prose text-ink-2">
        A record lives at <code className="font-mono text-ink">/r/&lt;fingerprint&gt;</code> and its
        dispute at <code className="font-mono text-ink">/d/&lt;fingerprint&gt;</code>.
      </p>
      <Link href="/" className="mt-4 inline-block text-row text-accent">
        ← {COPY.browse.title}
      </Link>
    </main>
  );
}
