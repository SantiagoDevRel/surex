'use client';

import type { IDKitResult } from '@worldcoin/idkit';
import { useActionState, useState } from 'react';

import { COPY } from '@/lib/copy.ts';
import { fileDispute, type DisputeOutcome } from '@/lib/dispute-action.ts';

import { Banner, type BannerTone } from './Banner.tsx';
import { CopyCommand } from './CopyCommand.tsx';
import { Panel, SectionLabel } from './Panel.tsx';
import { WorldIdProof } from './WorldIdProof.tsx';

/**
 * The two kinds of standing, same panel and three steps. A person proves
 * personhood; an agent proves a human stands behind it. The agent panel is
 * not a button — an agent signs its own request with a wallet a human
 * registered in AgentBook, which a browser cannot do on its behalf — so it
 * shows the actual request instead of a control that couldn't work.
 */

const INITIAL: DisputeOutcome = { kind: 'idle' };

/** The real request. Not a mock-up — this is the shape POST /v1/disputes accepts. */
const AGENT_REQUEST = `POST /v1/disputes
agentkit: <base64 payload signed by the agent wallet>

{ "fingerprint": "<sxf1_…>",
  "evidence": "<the rebuttal, pointing at file and line>",
  "contestantType": "agent" }`;

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

function HumanOutcome({ outcome }: { outcome: DisputeOutcome }) {
  if (outcome.kind === 'idle') return null;
  const view: { tone: BannerTone; label: string; body: string } =
    outcome.kind === 'filed'
      ? {
          tone: 'disputed',
          label: COPY.dispute.resultFiledLabel,
          body: [outcome.enforcement, outcome.note].filter(Boolean).join(' ') || COPY.dispute.stageOpenBody,
        }
      : outcome.kind === 'refused'
        ? {
            tone: 'flagged',
            label: `${COPY.dispute.resultRefusedLabel} · HTTP ${outcome.status}`,
            body: [outcome.code, outcome.message, outcome.detail].filter(Boolean).join(' — ') || 'no reason given',
          }
        : outcome.kind === 'unreachable'
          ? {
              tone: 'stale',
              label: COPY.dispute.resultUnreachableLabel,
              body: `${COPY.dispute.resultUnreachableBody} (${outcome.detail})`,
            }
          : { tone: 'neutral', label: COPY.submit.resultMissingLabel, body: COPY.dispute.resultMissingBody };

  return (
    <div className="mt-3">
      <Banner tone={view.tone} label={view.label}>
        {view.body}
      </Banner>
    </div>
  );
}

export function StandingPanels({ fingerprint }: { fingerprint?: string }) {
  const [outcome, action, pending] = useActionState(fileDispute, INITIAL);
  const [evidence, setEvidence] = useState('');
  const [proof, setProof] = useState<IDKitResult | null>(null);

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

          <form action={action} className="mt-3.5 grid gap-2.5">
            <input type="hidden" name="fingerprint" value={fingerprint ?? ''} />
            <label className="grid gap-1.5">
              <span className="text-label uppercase text-faint">{COPY.dispute.humanRebuttalLabel}</span>
              <textarea
                name="evidence"
                rows={4}
                value={evidence}
                onChange={(e) => {
                  // The proof's signal is bound to this exact rebuttal — editing
                  // invalidates it.
                  setEvidence(e.target.value);
                  if (proof) setProof(null);
                }}
                placeholder={COPY.dispute.humanRebuttalPlaceholder}
                className="rounded-input border border-line bg-panel-2 px-3 py-2 text-row text-ink placeholder:text-faint"
              />
            </label>

            <WorldIdProof
              context={{ action: 'contest-verdict', verdictKey: fingerprint ?? '', evidence }}
              onProof={setProof}
              label={COPY.dispute.humanAction}
              disabled={!fingerprint || !evidence.trim()}
            />

            <input type="hidden" name="proof" value={proof ? JSON.stringify(proof) : ''} />

            <button
              type="submit"
              disabled={pending || !proof || !evidence.trim() || !fingerprint}
              className="justify-self-start rounded-input border border-accent bg-accent-t px-3.5 py-2 text-row font-semibold text-accent disabled:border-line-2 disabled:bg-transparent disabled:text-faint"
            >
              {pending ? 'filing…' : COPY.dispute.humanFileAction}
            </button>
            <p className="text-mini text-ink-3">{COPY.dispute.humanFilingNote}</p>
          </form>

          <HumanOutcome outcome={outcome} />
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
          <p className="mt-3 text-mini text-ink-3">{COPY.dispute.agentAction}</p>
          <div className="mt-2">
            <CopyCommand command="npx @worldcoin/agentkit-cli register <agent-wallet-address>" />
          </div>
          <pre className="mt-2.5 overflow-x-auto rounded-input border border-line bg-panel-2 px-3 py-2.5 font-mono text-mini leading-relaxed text-ink-2">
            {AGENT_REQUEST}
          </pre>
          <p className="mt-2.5 text-mini text-ink-3">{COPY.dispute.standingNote}</p>
          <p className="mt-2 text-mini text-faint">{COPY.dispute.agentRefusedNote}</p>
        </Panel>
      </div>
    </section>
  );
}
