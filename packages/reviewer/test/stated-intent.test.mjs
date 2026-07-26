// The stated-intent block, and the one distinction in it that decides whether this
// system manufactures accusations.
//
// A review's sharpest question is "does the code do more than the tools say", and
// asking it requires the tools. Most of the MCP servers people actually run — github,
// gitlab, brave-search, slack — refuse to start without an API key, so the harness
// cannot enumerate them and hands the model an empty list. Rendered as
// `declared tools: (none supplied)` that reads as *this server declares nothing*,
// everything the code does looks undeclared, and the review flags a property of the
// harness rather than of the package. The block must say which of the two situations
// it is, and that the absence is not itself a finding.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  renderStatedIntent,
  buildPrompt,
  MCP_SURFACE_RULE,
  PROMPT_VERSION,
  SCOPE_RULE,
  VARIANTS,
} from '../src/prompt.mjs';

test('an enumerated tool list is rendered as declarations', () => {
  const text = renderStatedIntent({
    name: 'x',
    toolSource: 'tools/list',
    tools: [{ name: 'search', description: 'Search the web.' }],
  });
  assert.match(text, /declared tools:/);
  assert.match(text, /search/);
  assert.doesNotMatch(text, /NOT AVAILABLE/);
});

test('a server that could not be started says so, and says it is not a finding', () => {
  const text = renderStatedIntent({
    name: 'x',
    toolSource: 'not-enumerated:exited:1',
    tools: [],
    readme: 'Reads BRAVE_API_KEY and queries the Brave Search API.',
  });
  assert.match(text, /NOT AVAILABLE/, 'the model must not read this as "declares nothing"');
  assert.match(text, /exited:1/, 'and it must say why, so the verdict can repeat it');
  assert.match(text, /not itself a finding/i, 'the absence of a list must not become the accusation');
  assert.match(text, /README/);
});

test('a genuinely empty declaration is still distinguishable from a failure to ask', () => {
  // No toolSource at all: nothing claims the list was obtained, so the old
  // neutral wording stands. The two cases must not collapse into one string.
  const silent = renderStatedIntent({ name: 'x', tools: [] });
  const unasked = renderStatedIntent({ name: 'x', tools: [], toolSource: 'not-enumerated:timeout' });
  assert.notEqual(silent, unasked);
  assert.match(silent, /none supplied/);
});

test('the prompt version is stamped and is not rv-1', () => {
  // rv-1 could not tell "declares nothing" from "we could not ask", so any verdict
  // carrying it was produced by a prompt that conflated the two.
  //
  // This pin is meant to FAIL when the prompt changes. Every published verdict
  // records the version it was produced under, so a prompt edit that kept the old
  // number would silently mix two reviewers' answers under one label. Bump it here
  // and recalibrate against the fixture set — never just here.
  assert.equal(PROMPT_VERSION, 'rv-7');
  const built = buildPrompt({ variant: 'a', statedIntent: { name: 'x', tools: [] }, files: [] });
  assert.equal(built.promptVersion, PROMPT_VERSION);
});

test('BOTH variants know MCP has three surfaces, not just tools', () => {
  // A tool is one of three primitives: a server also serves prompt templates and
  // resources, whose text lands in the calling model's context the same way, without
  // even the "the user chose to call this" framing that bounds a tool. A reviewer
  // that reads only tool descriptions is blind to the cheapest place in the protocol
  // to hide an injection.
  //
  // Asserted on BOTH variants for the reason SCOPE_RULE is: a vector only one of them
  // knows about produces a systematic disagreement, not a second opinion.
  for (const variant of VARIANTS) {
    const [system] = buildPrompt({ variant, statedIntent: { name: 'x', tools: [] }, files: [] }).messages;
    assert.ok(system.content.includes(MCP_SURFACE_RULE), `variant ${variant} is missing MCP_SURFACE_RULE`);
  }
});

test('BOTH variants carry the scope rule, verbatim', () => {
  // When only variant A knew that a declared capability is not a finding, variant B
  // answered a different question — "is this code hardened by general standards" —
  // and the pair disagreed systematically on real packages. A paraphrase that changes
  // what is being looked for is not a paraphrase.
  for (const variant of VARIANTS) {
    const [system] = buildPrompt({ variant, statedIntent: { name: 'x', tools: [] }, files: [] }).messages;
    assert.ok(system.content.includes(SCOPE_RULE), `variant ${variant} is missing SCOPE_RULE`);
  }
});

test('the scope rule states the four exclusions that cost us a run', () => {
  assert.match(SCOPE_RULE, /is NOT a finding, however broad it is/, 'declared capability');
  assert.match(SCOPE_RULE, /not auditing code quality or hardening/i, 'general audit');
  assert.match(SCOPE_RULE, /already control the machine, the environment/i, 'attacker-owns-env threat models');
  assert.match(SCOPE_RULE, /never a finding/i, 'a missing tool list is not evidence');
});
