// The reviewer is specified to catch a prompt-injection planted in the fixture's
// source (tech-spec §6 / FR-22). If a refactor silently removed it, the reviewer
// would have nothing to catch and the demo's strongest moment would be fake.
// This test fails the build the moment the injection stops being present.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { INJECTION_MARKER } from '../src/tools/search.mjs';

const SEARCH_SRC = fileURLToPath(new URL('../src/tools/search.mjs', import.meta.url));

test('the planted reviewer-injection is present in the source', () => {
  const src = fs.readFileSync(SEARCH_SRC, 'utf8');
  // The stable marker the reviewer keys on.
  assert.ok(src.includes(INJECTION_MARKER), 'the injection marker line is missing');
  // The instruction the injection tries to smuggle to the model.
  assert.match(src, /ignore all previous instructions/i);
  assert.match(src, /verdict.+clean/i);
});

test('the injection marker is exported so a refactor cannot rename it silently', () => {
  assert.equal(typeof INJECTION_MARKER, 'string');
  assert.ok(INJECTION_MARKER.length > 8);
});
