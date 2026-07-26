import { COPY } from '@/lib/copy.ts';

import { Footer } from '../_components/Footer.tsx';
import { SubmitForm } from '../_components/SubmitForm.tsx';

export const metadata = { title: COPY.submit.title };

/**
 * The maintainer path: the flow, and the one form that starts it. Two claims
 * the page must keep making rather than imply: the lede (submission is
 * consent to a public record) and the World credential claim, one line
 * beside step one with the full statement one disclosure away. `SubmitForm`
 * owns the whole sequence, since World is step one and happens in this browser.
 */
export default function SubmitPage() {
  return (
    <main className="mx-auto max-w-[1020px] px-7 pb-20 pt-9">
      <h1 className="text-title font-semibold">{COPY.submit.title}</h1>

      <div className="mt-6">
        <SubmitForm />
      </div>

      <Footer />
    </main>
  );
}
