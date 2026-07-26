import { COPY } from '@/lib/copy.ts';

import { Footer } from '../_components/Footer.tsx';
import { SubmitForm } from '../_components/SubmitForm.tsx';

export const metadata = { title: COPY.submit.title };

/**
 * The maintainer path: the flow, and the one form that starts it.
 *
 * This page used to be a wall — a column of inert markers down the left with no
 * state behind any of them, a four-point explainer of what happens to your code,
 * and a six-panel essay about what to do if the review finds something. All of it
 * true, none of it what
 * somebody submitting a server is looking at the screen to find out. The pipeline
 * already narrates itself step by step, naming the technology and linking the
 * identifier the moment one is reported, so the prose was restating what the flow
 * says better a few seconds later.
 *
 * What is deliberately NOT gone, because both are claims the page must keep
 * making rather than imply: the lede, which is the deal (submission is consent to
 * a public record, and the maintainer is told first so a rebuttal can ship with
 * the verdict from hour zero); and the World credential claim, which is now one
 * line beside step one with the full statement one disclosure away.
 *
 * `SubmitForm` owns the whole sequence — World is step one and happens in this
 * browser, so it cannot be drawn by anything that only exists once a run does.
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
