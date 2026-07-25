import { COPY } from '@/lib/copy.ts';

import { Panel, SectionLabel } from './Panel.tsx';

/**
 * The two kinds of standing. Same panel, same size, same three steps.
 *
 * A wrongly-flagged server hurts the humans who wrote it and the agents that
 * depend on it, so both can defend it. The requirements differ — a person
 * proves personhood, an agent proves a human stands behind it — and the weight
 * of the rebuttal does not.
 *
 * Never described as agent reputation: the World track excludes that
 * explicitly, and SureX reviews servers.
 */

const AGENT_PAYLOAD = `{ "subject": "<fingerprint>",
  "claim": "finding_incorrect",
  "evidence": "walrus:<blobId>",
  "agent": "wld:agent:<address>" }`;

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="mt-3 grid gap-2 text-row text-ink-2">
      {items.map((item, i) => (
        <li key={item}>
          <b className="text-ink">{i + 1}</b> · {item}
        </li>
      ))}
    </ol>
  );
}

export function StandingPanels() {
  return (
    <section className="mt-8">
      <SectionLabel>{COPY.dispute.fileLabel}</SectionLabel>
      <p className="mt-1.5 max-w-[76ch] text-row text-ink-2">{COPY.dispute.fileBody}</p>

      <div className="mt-3.5 grid gap-3.5 md:grid-cols-2">
        <Panel className="px-5 py-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <span
              className="grid h-[22px] w-[22px] place-items-center rounded-full border-2 border-ink-2 text-mini"
              aria-hidden="true"
            >
              ⬤
            </span>
            <span className="text-body-lg font-semibold">{COPY.dispute.humanTitle}</span>
            <span className="ml-auto text-label tracking-[0.1em] text-faint">
              {COPY.dispute.humanBadge}
            </span>
          </div>
          <Steps
            items={[COPY.dispute.humanStep1, COPY.dispute.humanStep2, COPY.dispute.humanStep3]}
          />
          <button
            type="button"
            disabled
            className="mt-3.5 rounded-input border border-line-2 px-3.5 py-2 text-row text-faint"
          >
            {COPY.dispute.humanAction}
          </button>
        </Panel>

        <Panel className="px-5 py-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <span
              className="grid h-[22px] w-[22px] place-items-center border-2 border-ink-2 text-micro"
              aria-hidden="true"
            >
              ◇
            </span>
            <span className="text-body-lg font-semibold">{COPY.dispute.agentTitle}</span>
            <span className="ml-auto text-label tracking-[0.1em] text-faint">
              {COPY.dispute.agentBadge}
            </span>
          </div>
          <Steps
            items={[COPY.dispute.agentStep1, COPY.dispute.agentStep2, COPY.dispute.agentStep3]}
          />
          <pre className="mt-2.5 overflow-x-auto rounded-input border border-line bg-panel-2 px-3 py-2.5 font-mono text-mini leading-relaxed text-ink-2">
            {AGENT_PAYLOAD}
          </pre>
          <p className="mt-2.5 text-mini text-ink-3">{COPY.dispute.standingNote}</p>
          <button
            type="button"
            disabled
            className="mt-3 rounded-input border border-line-2 px-3.5 py-2 text-row text-faint"
          >
            {COPY.dispute.agentAction}
          </button>
        </Panel>
      </div>
    </section>
  );
}
