/**
 * The stage rail's logic, without a browser.
 *
 * The rail makes two kinds of claim the rest of the loader does not: *this stage
 * touches this technology*, and *here is a link to the artifact it produced*. Both
 * are claims about somebody else's infrastructure, so both are only ever built
 * from an identifier the run actually reported — and these tests are mostly about
 * the cases where it reported nothing.
 *
 * Run: node --test apps/web/test/
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { copyViolations } from '@surex/core';

import { COPY } from '../lib/copy.ts';
import {
  DEFAULT_ENS_APP_HOST,
  DEFAULT_GITHUB,
  DEFAULT_NPM,
  DEFAULT_SUI_EXPLORER,
  ENS_LABEL_HEX_LENGTH,
  ENS_LABEL_PREFIX,
  FLOW_STAGES,
  FLOW_STEPS,
  FLOW_TECH,
  STAGE_TECH,
  SUBMISSION_STAGES,
  artifactUrl,
  ensAppUrl,
  ensLabelFor,
  ensNameFor,
  ensParent,
  flowFacts,
  flowFocusStage,
  flowGatePassed,
  flowPhase,
  flowProvisional,
  flowSubStages,
  githubCommitUrl,
  githubRepoUrl,
  npmVersionUrl,
  parseSubmissionStatus,
  railStages,
  shownStage,
  shownStep,
  stageFacts,
  stageGatePassed,
  stagePhase,
  stageProvisional,
  stepForStage,
  suiObjectUrl,
  traceFrom,
} from '../lib/submission.ts';

const FP = `sxf1_${'a'.repeat(64)}`;
const SHA = 'f0457c3012a351b89df29a190d8189595074cf2fe';

/**
 * The ENS parent decides whether a name exists at all, so it is cleared here and
 * set only inside the two tests that are about it. A variable inherited from the
 * shell would make "no parent, no row" pass or fail depending on whose machine
 * ran it.
 */
delete process.env.NEXT_PUBLIC_SUREX_ENS_PARENT;

const status = (over = {}) => parseSubmissionStatus({ id: 'sub_1', status: 'running', ...over });
const at = (stage, detail = {}, over = {}) => status({ progress: { stage, detail }, ...over });

/** Feed the watch a sequence of payloads, the way the component does. */
function walk(...payloads) {
  return payloads.reduce((trace, payload) => traceFrom(trace, payload), {});
}

/* ----------------------------------------------------------- what is drawn --*/

test('every stage has a name, a caption and a detail — none can be added silently', () => {
  for (const stage of SUBMISSION_STAGES) {
    assert.ok(COPY.pipeline.rail.name[stage], `no rail name for ${stage}`);
    assert.ok(COPY.pipeline.stage[stage], `no caption for ${stage}`);
    assert.ok(COPY.pipeline.rail.stage[stage]?.lede, `no lede for ${stage}`);
    assert.ok(COPY.pipeline.rail.stage[stage]?.body, `no body for ${stage}`);
    // A tech id must have a label, and `null` must stay a real answer rather than
    // becoming an empty chip.
    const tech = STAGE_TECH[stage];
    assert.ok(tech === null || COPY.pipeline.rail.tech[tech], `no tech label for ${tech}`);
  }
  assert.equal(
    Object.keys(STAGE_TECH).length,
    SUBMISSION_STAGES.length,
    'STAGE_TECH must cover exactly the shared stage list',
  );
});

test('the four sponsor technologies each appear exactly where they are touched', () => {
  // The point of the rail. If one of these moves, it moved for a reason and the
  // test should be the thing that says so.
  assert.equal(STAGE_TECH.reviewing, 'dgx');
  assert.equal(STAGE_TECH.walrus, 'walrus');
  assert.equal(STAGE_TECH.arkiv, 'arkiv');
  assert.equal(STAGE_TECH.done, 'ens');
  // The licence gate touches none of them, and `null` says so rather than a chip.
  assert.equal(STAGE_TECH.licence, null);
});

test('`starting` is not drawn, because this pipeline does not run it', () => {
  // scripts/ingest-submission.mjs: the stage is RESERVED and never emitted — it
  // reads the tool list out of the README instead of installing and starting the
  // server. Drawing a step that does not run is a fabricated fact on a progress
  // screen.
  assert.ok(SUBMISSION_STAGES.includes('starting'), 'it is still in the shared list');
  assert.ok(!railStages({}).includes('starting'));
  assert.equal(railStages({}).length, SUBMISSION_STAGES.length - 1);
});

test('…and it IS drawn for a run that actually reported it', () => {
  const trace = walk(at('starting', { artifact: 'npm:acme-mcp@1.0.0' }));
  assert.deepEqual(trace.seen, ['starting']);
  assert.ok(railStages(trace).includes('starting'));
  assert.deepEqual([...railStages(trace)], [...SUBMISSION_STAGES]);
});

test('seen is append-only and keeps first-seen order', () => {
  const trace = walk(at('resolving'), at('licence'), at('resolving'), at('walrus'));
  assert.deepEqual(trace.seen, ['resolving', 'licence', 'walrus']);
});

/* ------------------------------------------------------------- the phases --*/

test('a stage the run has not reached is pending; the reported one is active', () => {
  const s = at('reviewing');
  assert.equal(stagePhase('resolving', s), 'done');
  assert.equal(stagePhase('reviewing', s), 'active');
  assert.equal(stagePhase('walrus', s), 'pending');
  assert.equal(stagePhase('done', s), 'pending');
});

test('with no reported stage nothing is active', () => {
  for (const stage of SUBMISSION_STAGES) {
    assert.equal(stagePhase(stage, null), 'pending');
    assert.equal(stagePhase(stage, status()), 'pending');
  }
});

test('a finished run is past everything, including a stage the poll never saw', () => {
  // The watch polls every 1800 ms and a short stage passes between two requests.
  // `pending` on a run that has ended would be the false answer, which is why the
  // phase is worded "the run is past this" rather than "done".
  const s = at('arkiv', {}, { status: 'done' });
  for (const stage of SUBMISSION_STAGES) assert.equal(stagePhase(stage, s), 'done');
  assert.match(COPY.pipeline.rail.phaseDone, /past/i);
  assert.ok(
    !/succeeded|completed|passed/i.test(COPY.pipeline.rail.phaseDone),
    'the phase must not claim the stage ran',
  );
});

test('a failed run stops on the stage it reported, and nothing after it advances', () => {
  const s = at('walrus', {}, { status: 'failed' });
  assert.equal(stagePhase('walrus', s), 'stopped');
  assert.equal(stagePhase('arkiv', s), 'pending');
  assert.equal(stagePhase('reviewing', s), 'done');
});

/* ------------------------------------------------------- what is described --*/

test('the panel follows the last REPORTED stage, not the active one', () => {
  // The bug this test exists for: a finished run has no active stage, so keying
  // the panel off `active` made a completed run describe stage one. Caught in a
  // render rather than in review.
  const stages = railStages({});
  assert.equal(shownStage(stages, null, at('arkiv', {}, { status: 'done' })), 'arkiv');
  assert.equal(shownStage(stages, null, at('done', {}, { status: 'done' })), 'done');
  assert.equal(shownStage(stages, null, at('walrus', {}, { status: 'failed' })), 'walrus');
  assert.equal(shownStage(stages, null, at('reviewing')), 'reviewing');
});

test('a pick wins, and a pick for a tile that is not drawn is ignored', () => {
  const stages = railStages({});
  assert.equal(shownStage(stages, 'walrus', at('resolving')), 'walrus');
  // `starting` is not on the rail for this run, so the panel stays with the run
  // rather than describing a tile nobody can see or unselect.
  assert.equal(shownStage(stages, 'starting', at('resolving')), 'resolving');
});

test('with nothing reported the panel describes the first stage', () => {
  assert.equal(shownStage(railStages({}), null, null), 'resolving');
  assert.equal(shownStage([], null, null), null);
});

/* ------------------------------------------------------ the two overrides --*/

test('a blob a public publisher registered is marked provisional, and only that', () => {
  const publisher = walk(at('walrus', { blobId: 'b', registeredBy: 'publisher' }));
  const ours = walk(at('walrus', { blobId: 'b', registeredBy: 'wallet' }));
  assert.equal(stageProvisional('walrus', publisher), true);
  assert.equal(stageProvisional('walrus', ours), false);
  assert.equal(stageProvisional('walrus', {}), false, 'an unreported custody is not a claim');
  for (const stage of SUBMISSION_STAGES) {
    if (stage !== 'walrus') assert.equal(stageProvisional(stage, publisher), false);
  }
});

test('the licence gate reads as passed only once the run has moved past it', () => {
  const trace = walk(at('licence', { spdx: 'MIT' }));
  assert.equal(stageGatePassed('licence', trace, at('licence', { spdx: 'MIT' })), false, 'still on it');
  assert.equal(stageGatePassed('licence', trace, at('reviewing')), true);
  assert.equal(stageGatePassed('licence', {}, at('reviewing')), false, 'no licence reported, no pass');
  assert.equal(stageGatePassed('walrus', trace, at('done')), false, 'only the licence gate is a gate');
});

/* --------------------------------------------------------------- the facts -*/

test('a stage that reported nothing produces no facts at all', () => {
  // The panel then says so in words. There is no placeholder row, and an empty
  // list would read as "there is nothing to see" rather than "nobody said".
  for (const stage of SUBMISSION_STAGES) {
    assert.deepEqual(stageFacts(stage, {}, null), [], `${stage} invented a fact`);
  }
  assert.match(COPY.pipeline.rail.nothingReported, /reported/i);
});

test('resolving links the repo and the commit, and never a tag', () => {
  const trace = walk(at('resolving', { repo: 'acme/acme-mcp', commit: 'a'.repeat(40), release: 'v2.3.0' }));
  const facts = stageFacts('resolving', trace, null);
  const byLabel = Object.fromEntries(facts.map((f) => [f.label, f]));

  assert.equal(byLabel[COPY.pipeline.rail.fact.repo].href, `${DEFAULT_GITHUB}/acme/acme-mcp`);
  assert.equal(
    byLabel[COPY.pipeline.rail.fact.commit].href,
    `${DEFAULT_GITHUB}/acme/acme-mcp/commit/${'a'.repeat(40)}`,
  );
  // A tag can be repointed, so it is shown and never linked.
  assert.equal(byLabel[COPY.pipeline.rail.fact.release].value, 'v2.3.0');
  assert.equal(byLabel[COPY.pipeline.rail.fact.release].href, undefined);
});

test('resolving records the fingerprint the pipeline announces early', () => {
  // Said minutes before the run finishes so a watcher can open /r/<fp> under the
  // name they were already given.
  const trace = walk(at('resolving', { fingerprint: FP }));
  assert.equal(trace.fingerprint, FP);
  assert.equal(walk(at('resolving', { fingerprint: 'sxf1_nope' })).fingerprint, undefined);
});

test('the npm row carries name@version and links to that exact version', () => {
  const trace = walk(at('resolving', { package: '@acme/mcp', version: '1.2.3' }));
  const [pkg] = stageFacts('resolving', trace, null).filter(
    (f) => f.label === COPY.pipeline.rail.fact.package,
  );
  assert.equal(pkg.value, '@acme/mcp@1.2.3');
  assert.equal(pkg.href, `${DEFAULT_NPM}/package/%40acme/mcp/v/1.2.3`);
});

test('walrus states custody in words, and omits what a publisher never returns', () => {
  const trace = walk(at('walrus', { blobId: 'blob-1', contentSha256: SHA, registeredBy: 'publisher' }));
  const facts = stageFacts('walrus', trace, null);
  const labels = facts.map((f) => f.label);

  assert.ok(labels.includes(COPY.pipeline.blobLabel));
  assert.ok(labels.includes(COPY.pipeline.sha256Label));
  assert.ok(
    !labels.includes(COPY.pipeline.rail.fact.suiObject),
    'a publisher write has no object of ours — the row is omitted, not blanked',
  );
  const custody = facts.find((f) => f.label === COPY.pipeline.rail.fact.custody);
  assert.equal(custody.value, COPY.pipeline.rail.custodyPublisher);
  assert.match(custody.value, /theirs/i);
});

test('walrus links the Sui object and both digests when the run reports them', () => {
  const trace = walk(
    at('walrus', {
      blobId: 'blob-1',
      contentSha256: SHA,
      registeredBy: 'wallet',
      suiObjectId: '0xe0ad',
      registerTx: '2s1og',
      certifyTx: '7BiSZ',
    }),
  );
  const byLabel = Object.fromEntries(stageFacts('walrus', trace, null).map((f) => [f.label, f]));
  assert.equal(byLabel[COPY.pipeline.rail.fact.suiObject].href, `${DEFAULT_SUI_EXPLORER}/object/0xe0ad`);
  assert.equal(byLabel[COPY.pipeline.rail.fact.registerTx].href, `${DEFAULT_SUI_EXPLORER}/tx/2s1og`);
  assert.equal(byLabel[COPY.pipeline.rail.fact.certifyTx].href, `${DEFAULT_SUI_EXPLORER}/tx/7BiSZ`);
  assert.equal(byLabel[COPY.pipeline.rail.fact.custody].value, COPY.pipeline.rail.custodyWallet);
});

test('the Arkiv entity links to the explorer and its transaction does not', () => {
  // apps/api/src/links.mjs builds an entity URL for Arkiv and nothing else. A
  // transaction path nobody has confirmed would be a guess, and a dead link that
  // looks alive is worse than no link.
  const trace = walk(at('arkiv', { entityKey: '0xabc', txHash: '0xdef' }));
  const byLabel = Object.fromEntries(stageFacts('arkiv', trace, null).map((f) => [f.label, f]));
  assert.match(byLabel[COPY.pipeline.entityLabel].href, /\/entity\/0xabc$/);
  assert.equal(byLabel[COPY.pipeline.txLabel].href, undefined);
});

test('reviewing names the model and prompt from either place the run reports them', () => {
  const fromDetail = walk(at('reviewing', { model: 'qwen3-coder-next:surex32k', promptVersion: 'rv-6', files: 12 }));
  const byLabel = Object.fromEntries(stageFacts('reviewing', fromDetail, null).map((f) => [f.label, f]));
  assert.equal(byLabel[COPY.pipeline.rail.fact.model].value, 'qwen3-coder-next:surex32k');
  assert.equal(byLabel[COPY.pipeline.rail.fact.prompt].value, 'rv-6');
  assert.equal(byLabel[COPY.pipeline.rail.fact.files].value, '12');

  const fromReviewer = stageFacts('reviewing', {}, status({ reviewer: { model: 'm', promptVersion: 'p' } }));
  assert.deepEqual(
    fromReviewer.map((f) => f.value),
    ['m', 'p'],
  );
});

/* ---------------------------------------------------------------- the ENS --*/

test('with no parent configured there is no name and no row', () => {
  delete process.env.NEXT_PUBLIC_SUREX_ENS_PARENT;
  assert.equal(ensParent(), null);
  assert.equal(ensNameFor(FP), null);
  const trace = walk(at('done', { state: 'clean' }));
  const labels = stageFacts('done', trace, null).map((f) => f.label);
  assert.ok(!labels.includes(COPY.pipeline.rail.fact.ensName));
});

test('the name is built, and it is deliberately not a link', () => {
  process.env.NEXT_PUBLIC_SUREX_ENS_PARENT = 'surex.eth';
  try {
    const trace = walk(at('done', { state: 'clean' }), at('resolving', { fingerprint: FP }));
    const byLabel = Object.fromEntries(stageFacts('done', trace, null).map((f) => [f.label, f]));
    const name = byLabel[COPY.pipeline.rail.fact.ensName];
    assert.equal(name.value, `${ENS_LABEL_PREFIX}${'a'.repeat(40)}.surex.eth`);
    // FRICTION-LOG E9: an offchain resolver cannot enumerate its keys, so the ENS
    // app renders an empty Records tab for a name that is answering perfectly
    // well. Sending anyone there makes them conclude it is broken.
    assert.equal(name.href, undefined);
    assert.equal(byLabel[COPY.pipeline.rail.fact.ensRead].value, COPY.verdict.ensExample);
    // The PARENT is a real, ordinary registration and does render in the app.
    assert.equal(byLabel[COPY.pipeline.rail.fact.ensParent].href, `https://${DEFAULT_ENS_APP_HOST}/name/surex.eth`);
  } finally {
    delete process.env.NEXT_PUBLIC_SUREX_ENS_PARENT;
  }
});

test('the label is 45 characters and legal, which is the whole reason it exists', () => {
  const label = ensLabelFor(FP);
  assert.equal(label.length, ENS_LABEL_PREFIX.length + ENS_LABEL_HEX_LENGTH);
  assert.ok(label.length < 64, 'above 63 bytes viem resolves and ethers throws — E2');
  assert.ok(!label.includes('_'), 'ENSIP-15 rejects a mid-label underscore — E1');
  assert.equal(ensLabelFor('sxf1_nope'), null);
  assert.equal(ensLabelFor(undefined), null);
  assert.equal(ensAppUrl(null), null);
});

test('the ENS encoding has not drifted from lib/ens.ts', () => {
  /**
   * `lib/ens.ts` is the authority and is SERVER ONLY — it holds the gateway's
   * signing configuration. The browser copy is read out of that file as TEXT, the
   * same technique the link bases and the golden signature vector already use.
   */
  const source = readFileSync(new URL('../lib/ens.ts', import.meta.url), 'utf8');
  assert.ok(source.includes(`LABEL_PREFIX = '${ENS_LABEL_PREFIX}'`), 'the label prefix moved');
  assert.ok(source.includes(`LABEL_HEX_LENGTH = ${ENS_LABEL_HEX_LENGTH}`), 'the label length moved');
  assert.ok(source.includes(`'${DEFAULT_ENS_APP_HOST}'`), 'the ENS app host moved');
  assert.ok(source.includes('NEXT_PUBLIC_SUREX_ENS_PARENT'), 'the parent variable moved');
});

/* -------------------------------------------------------------- the links --*/

test('a link is built only from a shape the pipeline itself enforces', () => {
  // ingest-submission.mjs: `--repo` is owner/name and `--commit` must be a
  // 40-character hex sha, "a tag cannot pin bytes".
  assert.equal(githubRepoUrl('acme/acme-mcp'), `${DEFAULT_GITHUB}/acme/acme-mcp`);
  assert.equal(githubRepoUrl('not a repo'), null);
  assert.equal(githubRepoUrl(undefined), null);
  assert.equal(githubCommitUrl('acme/acme-mcp', 'v2.3.0'), null, 'a tag is not a commit');
  assert.equal(githubCommitUrl('acme/acme-mcp', 'abc'), null);
  assert.equal(npmVersionUrl('Acme-MCP'), null, 'npm names are lower case');
  assert.equal(npmVersionUrl('acme-mcp'), `${DEFAULT_NPM}/package/acme-mcp`);
  assert.equal(suiObjectUrl(''), null);
});

test('the reviewed artifact parses into a link, or into nothing', () => {
  assert.equal(artifactUrl('npm:acme-mcp@1.0.0'), `${DEFAULT_NPM}/package/acme-mcp/v/1.0.0`);
  // The scope's `@` is not a version separator.
  assert.equal(artifactUrl('npm:@acme/mcp@1.0.0'), `${DEFAULT_NPM}/package/%40acme/mcp/v/1.0.0`);
  assert.equal(
    artifactUrl(`github:acme/acme-mcp@${'b'.repeat(40)}`),
    `${DEFAULT_GITHUB}/acme/acme-mcp/commit/${'b'.repeat(40)}`,
  );
  for (const bad of ['', null, undefined, 'acme-mcp@1.0.0', 'npm:acme-mcp', 'oci:docker.io/acme/mcp@1']) {
    assert.equal(artifactUrl(bad), null, `${bad} produced a link`);
  }
});

/* ---------------------------------------------------------------- the copy -*/

test('every rail string obeys the copy law', () => {
  // copy.test.mjs walks the whole module, so this is belt and braces — but the
  // rail is the block most likely to reach for "verified" or "trusted", because
  // it is describing storage and signatures.
  const failures = [];
  const walkCopy = (node, path) => {
    if (typeof node === 'string') {
      for (const v of copyViolations(node)) failures.push(`${path}: "${v.word}" → ${v.instead}`);
      return;
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walkCopy(v, `${path}.${k}`);
    }
  };
  walkCopy(COPY.pipeline.rail, 'pipeline.rail');
  assert.deepEqual(failures, [], `\n${failures.join('\n')}\n`);
});

test('the rail names the DGX, and says the source does not leave it', () => {
  const reviewing = COPY.pipeline.rail.stage.reviewing;
  assert.match(reviewing.body, /DGX/);
  assert.match(reviewing.body, /never goes to a hosted model|own hardware/i);
  // Two readings, and what a split buys. The calibration changed the product here
  // and the screen should not describe the old rule.
  assert.match(reviewing.body, /two paraphrased readings/i);
  assert.match(reviewing.body, /lower severity/i);
});

test('the walrus copy states the one thing a blob ID is not', () => {
  const body = COPY.pipeline.rail.stage.walrus.body;
  assert.match(body, /two Sui transactions/i);
  assert.match(body, /contentSha256/);
  assert.match(body, /not the sha256|rather than the sha256/i);
});

/* ---------------------------------------------------------------- the flow -*/

/**
 * Six steps, one sequence, and the World step in front of the five the pipeline
 * reports. The fold is presentational — these tests are about proving it loses
 * nothing: every stage still belongs to exactly one step, every fact still comes
 * from the stage that reported it, and no step can reach a state the run did not.
 */

test('the six steps cover every pipeline stage exactly once', () => {
  // The fold is lossless or it is a lie. A stage in no step would vanish from the
  // screen; a stage in two would tick twice.
  const covered = FLOW_STEPS.flatMap((step) => [...FLOW_STAGES[step]]);
  assert.deepEqual([...covered].sort(), [...SUBMISSION_STAGES].sort());
  assert.equal(covered.length, new Set(covered).size, 'a stage is claimed by two steps');
  for (const stage of SUBMISSION_STAGES) {
    assert.ok(FLOW_STAGES[stepForStage(stage)].includes(stage), `${stage} maps to the wrong step`);
  }
});

test('World is the only step with no stage behind it', () => {
  assert.deepEqual([...FLOW_STAGES.world], []);
  for (const step of FLOW_STEPS) {
    if (step !== 'world') assert.ok(FLOW_STAGES[step].length > 0, `${step} covers nothing`);
  }
  // It happens in this browser, before a submission exists, so no run can move it.
  for (const status of [null, at('reviewing'), at('done', {}, { status: 'done' })]) {
    assert.equal(flowPhase('world', status, 'idle'), 'pending');
    assert.equal(flowPhase('world', status, 'checking'), 'active');
    assert.equal(flowPhase('world', status, 'held'), 'done');
    assert.equal(flowPhase('world', status, 'failed'), 'stopped');
  }
});

test('every step has a name, a caption, a technology and a label for it', () => {
  for (const step of FLOW_STEPS) {
    assert.ok(COPY.pipeline.rail.flow.name[step], `no name for ${step}`);
    assert.ok(COPY.pipeline.rail.flow.caption[step], `no caption for ${step}`);
    const tech = FLOW_TECH[step];
    assert.ok(tech, `no technology for ${step}`);
    assert.ok(COPY.pipeline.rail.tech[tech], `no label for ${tech}`);
  }
  // The five the flow names after their technology are the five the product is
  // built on. If one of these moves, it moved for a reason.
  assert.equal(FLOW_TECH.world, 'world');
  assert.equal(FLOW_TECH.source, 'source');
  assert.equal(FLOW_TECH.review, 'dgx');
  assert.equal(FLOW_TECH.walrus, 'walrus');
  assert.equal(FLOW_TECH.arkiv, 'arkiv');
  assert.equal(FLOW_TECH.published, 'ens');
});

test('a step is done only when every stage it folds is', () => {
  // The source step folds four. Three of them being past is still in flight, and
  // a step that ticked early would be claiming the licence gate had answered.
  const onLicence = at('licence');
  assert.equal(flowPhase('source', onLicence, 'held'), 'active');
  assert.equal(flowPhase('review', onLicence, 'held'), 'pending');

  const onReview = at('reviewing');
  assert.equal(flowPhase('source', onReview, 'held'), 'done');
  assert.equal(flowPhase('review', onReview, 'held'), 'active');
  assert.equal(flowPhase('walrus', onReview, 'held'), 'pending');

  // Nothing reported: nothing has happened, including on the steps that fold four.
  for (const step of FLOW_STEPS) {
    if (step === 'world') continue;
    assert.equal(flowPhase(step, null, 'idle'), 'pending');
  }
});

test('a stopped stage stops its step, and the steps after it stay unreached', () => {
  const s = at('walrus', {}, { status: 'failed' });
  assert.equal(flowPhase('walrus', s, 'held'), 'stopped');
  assert.equal(flowPhase('arkiv', s, 'held'), 'pending');
  assert.equal(flowPhase('published', s, 'held'), 'pending');
  assert.equal(flowPhase('source', s, 'held'), 'done');
});

test('a finished run has ticked every step, including one the poll never saw', () => {
  const s = at('arkiv', {}, { status: 'done' });
  for (const step of FLOW_STEPS) {
    if (step === 'world') continue;
    assert.equal(flowPhase(step, s, 'held'), 'done', `${step} did not tick`);
  }
});

test('the panel starts on World, follows the run, and a pick wins', () => {
  // Before a submission exists the World step is the only one anything is
  // happening on, so it is where the panel sits — not a default, a true statement.
  assert.equal(shownStep(null, null), 'world');
  assert.equal(shownStep(null, at('resolving')), 'source');
  assert.equal(shownStep(null, at('licence')), 'source');
  assert.equal(shownStep(null, at('reviewing')), 'review');
  assert.equal(shownStep(null, at('done', {}, { status: 'done' })), 'published');
  assert.equal(shownStep('walrus', at('resolving')), 'walrus');
  assert.equal(shownStep('world', at('arkiv')), 'world');
});

test('the folded step describes the stage the run is actually on', () => {
  const trace = walk(at('resolving'), at('licence'));
  assert.equal(flowFocusStage('source', at('licence'), trace), 'licence');
  // Past the step entirely: the last of its stages the watch actually saw. Naming
  // one nobody reported would describe an event as though it had happened.
  assert.equal(flowFocusStage('source', at('reviewing'), trace), 'licence');
  // Nothing seen and nothing reported: the first, which is a true statement about
  // what happens rather than a claim that it has.
  assert.equal(flowFocusStage('source', null, {}), 'resolving');
  assert.equal(flowFocusStage('world', at('reviewing'), trace), null);
  assert.equal(flowFocusStage('review', at('reviewing'), trace), 'reviewing');
});

test('a stage the pipeline never emits is not folded in either', () => {
  // `starting` is reserved and never emitted by scripts/ingest-submission.mjs, so
  // the source step lists three sub-stages, not four — the same rule the rail
  // already followed, carried through the fold.
  assert.deepEqual(flowSubStages('source', {}), ['resolving', 'licence', 'fetching']);
  const started = walk(at('starting', { artifact: 'npm:acme-mcp@1.0.0' }));
  assert.deepEqual(flowSubStages('source', started), ['resolving', 'licence', 'fetching', 'starting']);
  assert.deepEqual(flowSubStages('world', started), []);
});

test('a step that reported nothing produces no facts at all', () => {
  for (const step of FLOW_STEPS) {
    assert.deepEqual(flowFacts(step, {}, null), [], `${step} invented a fact`);
  }
  // …and World has none even from a full run, because no stage reports for it.
  const full = walk(at('resolving', { repo: 'acme/acme-mcp' }), at('walrus', { blobId: 'b' }));
  assert.deepEqual(flowFacts('world', full, at('done', {}, { status: 'done' })), []);
});

test('folding merges the facts the stages reported, and cannot add one', () => {
  const trace = walk(
    at('resolving', { repo: 'acme/acme-mcp', commit: 'a'.repeat(40) }),
    at('licence', { spdx: 'MIT' }),
    at('fetching', { artifact: `github:acme/acme-mcp@${'a'.repeat(40)}` }),
  );
  const merged = flowFacts('source', trace, null);
  const labels = merged.map((f) => f.label);

  // The three things the step exists to show: the repo, the commit, the licence.
  assert.ok(labels.includes(COPY.pipeline.rail.fact.repo));
  assert.ok(labels.includes(COPY.pipeline.rail.fact.commit));
  assert.ok(labels.includes(COPY.pipeline.rail.fact.licence));

  // Nothing that `stageFacts` would not have produced on its own.
  const separately = FLOW_STAGES.source.flatMap((stage) => stageFacts(stage, trace, null));
  assert.deepEqual(
    merged.map((f) => `${f.label}=${f.value}`).sort(),
    [...new Set(separately.map((f) => `${f.label}=${f.value}`))].sort(),
  );
});

test('when two folded stages report the same label, the earlier stage wins', () => {
  // `fetching` and `starting` both carry an artifact. Pipeline order decides, so
  // the row cannot flip between polls depending on which stage answered last.
  const trace = walk(
    at('fetching', { artifact: 'npm:acme-mcp@1.0.0' }),
    at('starting', { artifact: 'npm:acme-mcp@9.9.9' }),
  );
  const artifacts = flowFacts('source', trace, null).filter(
    (f) => f.label === COPY.pipeline.rail.fact.artifact,
  );
  assert.equal(artifacts.length, 1, 'the same label rendered twice');
  assert.equal(artifacts[0].value, 'npm:acme-mcp@1.0.0');
});

test('the licence gate colours its step only once the whole step is past', () => {
  const trace = walk(at('licence', { spdx: 'MIT' }));
  // Still inside the step — it is running, whatever one of its stages answered.
  assert.equal(flowGatePassed('source', trace, at('fetching')), false);
  assert.equal(flowGatePassed('source', trace, at('licence')), false, 'still on the gate');
  // Out the other side, with a licence actually reported.
  assert.equal(flowGatePassed('source', trace, at('reviewing')), true);
  assert.equal(flowGatePassed('source', {}, at('reviewing')), false, 'no licence reported, no pass');
  for (const step of FLOW_STEPS) {
    if (step !== 'source') assert.equal(flowGatePassed(step, trace, at('done')), false);
  }
});

test('only the publisher-registered blob makes a step provisional', () => {
  const publisher = walk(at('walrus', { blobId: 'b', registeredBy: 'publisher' }));
  const ours = walk(at('walrus', { blobId: 'b', registeredBy: 'wallet' }));
  assert.equal(flowProvisional('walrus', publisher), true);
  assert.equal(flowProvisional('walrus', ours), false);
  for (const step of FLOW_STEPS) {
    if (step !== 'walrus') assert.equal(flowProvisional(step, publisher), false);
  }
});

test('every step draws a real mark, and no mark reaches the network', () => {
  /**
   * The logos are inlined, never linked. A page that hotlinks someone's CDN for a
   * logo makes a request to them from every reader on every render, and leaks who
   * is looking at a verdict — so the marks are `<svg>` in the component and this
   * reads the component as text to prove it stayed that way.
   */
  const source = readFileSync(new URL('../app/_components/StageRail.tsx', import.meta.url), 'utf8');
  const marks = source.slice(source.indexOf('function TechMark'), source.indexOf('export function StageRail'));

  for (const step of FLOW_STEPS) {
    assert.ok(marks.includes(`case '${FLOW_TECH[step]}':`), `no mark for ${step}`);
  }
  assert.ok(!/<img|xlink:href|url\(|https?:\/\//i.test(marks), 'a mark reaches outside the bundle');
  // `currentColor` throughout: the tile's colour is its phase, and a hard-coded
  // brand hex here would fight the one thing colour means in this product.
  assert.ok(!/fill="#|stroke="#/i.test(marks), 'a mark hard-codes a colour');
  assert.ok(marks.includes("fill: 'currentColor'"), 'the marks stopped inheriting the phase colour');
});

test('the World step ticks in words of its own, and never in the run’s', () => {
  // "not reached" is wrong for a step the reader is being asked to start, and
  // there is no run for it to be "past".
  const { worldPhase } = COPY.pipeline.rail.flow;
  assert.match(worldPhase.active, /check/i);
  assert.match(worldPhase.done, /proof/i);
  assert.ok(!/past/i.test(worldPhase.done), 'the World step has no run to be past');
  assert.equal(
    new Set(Object.values(worldPhase)).size,
    4,
    'the four World phases must not share wording',
  );
  const runWords = [
    COPY.pipeline.rail.phasePending,
    COPY.pipeline.rail.phaseActive,
    COPY.pipeline.rail.phaseDone,
    COPY.pipeline.rail.phaseStopped,
  ];
  for (const word of Object.values(worldPhase)) {
    assert.ok(!runWords.includes(word), `the World step reuses a run phase word: "${word}"`);
  }
});

test('the walls this page threw out do not come back', () => {
  /**
   * Deleted deliberately: a column of inert `◌` markers with no state behind them,
   * a four-point explainer of what happens to your code, and a six-panel essay
   * about what to do if the review finds something. The flow narrates all three,
   * step by step, from what the run actually reported. A key reappearing here is
   * the wall being rebuilt.
   */
  for (const key of [
    'stepHuman',
    'stepHumanNote',
    'stepRepo',
    'stepRepoNote',
    'stepRelease',
    'stepReleaseNote',
    'stepReview',
    'stepReviewNote',
    'whatHappensLabel',
    'whatHappens1',
    'whatHappens2',
    'whatHappens3',
    'whatHappens4',
    'outcomeLabel',
    'outcomeBody',
    'outcomeIs',
    'outcomeIsNot',
    'answerTitle',
    'fixTitle',
    'leaveTitle',
    'windowNote',
  ]) {
    assert.equal(COPY.submit[key], undefined, `COPY.submit.${key} is back`);
  }
  // …and the page is the flow plus the form, not a page of panels.
  const page = readFileSync(new URL('../app/submit/page.tsx', import.meta.url), 'utf8');
  assert.ok(!page.includes('◌'), 'the inert checklist is back');
  assert.ok(!/\bPanel\b/.test(page), 'the submit page is composing panels again');
});

test('nothing in the rail says the gate blocks', () => {
  // The stop is `permissionDecision: 'ask'`. Both halt the call; the difference is
  // who ends it, and "blocks" says the wrong one.
  const all = JSON.stringify(COPY.pipeline.rail);
  assert.ok(!/\bblocks?\b/i.test(all), 'the rail must not say the gate blocks');
  assert.match(COPY.pipeline.rail.stage.arkiv.body, /single query/i);
});
