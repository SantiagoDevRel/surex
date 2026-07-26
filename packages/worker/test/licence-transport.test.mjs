// The licence gate must not turn a failed request into a public claim.
//
// `unreviewable` with reason `licence` renders on the site as "no licence permits
// us to store this source" — a statement about somebody else's package. It may only
// be made when the licence was READ and found wanting, never because
// raw.githubusercontent rate-limited us mid-loop.
//
// The distinction being tested: 404 is an answer, 429 / 5xx / timeout is not.

import test from 'node:test';
import assert from 'node:assert/strict';

import { licenceGate } from '../src/licence.mjs';

const MIT = `MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.`;

/** Swap global fetch for the duration of one case. */
async function withFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  async text() { return body; },
  async json() { return JSON.parse(body); },
});

const CANDIDATE = {
  name: 'x',
  pkg: { registryType: 'npm', identifier: 'x', version: '1.0.0' },
  repo: { url: 'https://github.com/o/r' },
};

// npm says "SEE LICENSE IN LICENSE" — no SPDX — so everything hinges on the repo
// file, which is the case that bit us.
const NPM_META = JSON.stringify({ name: 'x', version: '1.0.0', license: 'SEE LICENSE IN LICENSE', dist: {} });

test('a readable MIT licence file is eligible', async () => {
  const gate = await withFetch(
    async (url) => (String(url).includes('registry.npmjs.org') ? reply(200, NPM_META) : reply(200, MIT)),
    () => licenceGate(CANDIDATE, { fetchRepoFiles: true }),
  );
  assert.equal(gate.eligible, true);
  assert.equal(gate.spdx, 'MIT');
  assert.ok(!gate.undetermined);
});

test('404 on every candidate is an ANSWER: ineligible, not undetermined', async () => {
  const gate = await withFetch(
    async (url) => (String(url).includes('registry.npmjs.org') ? reply(200, NPM_META) : reply(404, '')),
    () => licenceGate(CANDIDATE, { fetchRepoFiles: true }),
  );
  assert.equal(gate.eligible, false);
  assert.ok(!gate.undetermined, 'a repo with genuinely no licence file is a real negative');
});

test('429 is NOT an answer: the gate refuses to claim ineligibility', async () => {
  const gate = await withFetch(
    async (url) => (String(url).includes('registry.npmjs.org') ? reply(200, NPM_META) : reply(429, 'slow down')),
    () => licenceGate(CANDIDATE, { fetchRepoFiles: true }),
  );
  assert.equal(gate.eligible, false, 'still not eligible — we did not read a licence');
  assert.equal(gate.undetermined, true, 'but the caller must not publish "no licence permits this"');
  assert.match(gate.detail, /could not read the repository licence/i);
});

test('a network error is NOT an answer either', async () => {
  const gate = await withFetch(
    async (url) => {
      if (String(url).includes('registry.npmjs.org')) return reply(200, NPM_META);
      throw Object.assign(new Error('socket hang up'), { name: 'TypeError' });
    },
    () => licenceGate(CANDIDATE, { fetchRepoFiles: true }),
  );
  assert.equal(gate.undetermined, true);
});

test('a transient 429 that clears on retry still resolves the licence', async () => {
  let hits = 0;
  const gate = await withFetch(
    async (url) => {
      if (String(url).includes('registry.npmjs.org')) return reply(200, NPM_META);
      hits += 1;
      return hits === 1 ? reply(429, 'slow down') : reply(200, MIT);
    },
    () => licenceGate(CANDIDATE, { fetchRepoFiles: true }),
  );
  assert.equal(gate.eligible, true, 'one rate limit must not cost a package its licence');
  assert.equal(gate.spdx, 'MIT');
});
