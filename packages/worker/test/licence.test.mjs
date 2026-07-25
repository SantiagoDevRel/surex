// The licence gate, offline. No network: these are the decisions, not the fetches.
//
// The test that matters most is the last group — UNMATCHED IS INELIGIBLE. A false
// positive here writes someone else's code into storage that has no delete, so
// "we could not tell" must never resolve to "go ahead".

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isEligibleSpdx,
  classifySpdx,
  matchLicenceText,
  normaliseKnownAlias,
  rawUrlsFor,
} from '../src/licence.mjs';

test('the spec list is eligible', () => {
  for (const id of [
    'MIT',
    'Apache-2.0',
    'ISC',
    'MPL-2.0',
    '0BSD',
    'BSD-2-Clause',
    'BSD-3-Clause',
    'BSD-3-Clause-Clear',
    'GPL-2.0',
    'GPL-3.0-only',
    'GPL-3.0-or-later',
    'LGPL-2.1-or-later',
    'AGPL-3.0',
  ]) {
    assert.equal(isEligibleSpdx(id), true, `${id} should be eligible`);
  }
});

test('anything outside the spec list is ineligible, including permissive-looking ones', () => {
  // Unlicense/CC0/Zlib really are redistribution-permitting. They are refused on
  // purpose: widening this gate is a human decision, and the cost of refusing is
  // one `unreviewable` row while the cost of a false positive is unrecoverable.
  for (const id of ['Unlicense', 'CC0-1.0', 'Zlib', 'Python-2.0', 'Elastic-2.0', 'BUSL-1.1', 'SSPL-1.0', 'BSD']) {
    assert.equal(isEligibleSpdx(id), false, `${id} should NOT be eligible`);
  }
});

test('explicit non-redistribution markers are refused', () => {
  for (const raw of ['UNLICENSED', 'SEE LICENSE IN LICENSE.md', 'Proprietary', 'All Rights Reserved']) {
    const v = classifySpdx(raw);
    assert.equal(v.eligible, false, raw);
    assert.equal(v.how, 'explicitly-ineligible');
  }
});

test('expressions: OR needs one side, AND needs both, WITH judges the base', () => {
  assert.equal(classifySpdx('(MIT OR Apache-2.0)').eligible, true);
  assert.equal(classifySpdx('(BUSL-1.1 OR MIT)').eligible, true);
  assert.equal(classifySpdx('(BUSL-1.1 OR SSPL-1.0)').eligible, false);
  assert.equal(classifySpdx('MIT AND Apache-2.0').eligible, true);
  assert.equal(classifySpdx('MIT AND BUSL-1.1').eligible, false);
  assert.equal(classifySpdx('Apache-2.0 WITH LLVM-exception').eligible, true);
  assert.equal(classifySpdx('BUSL-1.1 WITH some-exception').eligible, false);
});

test('absent licence is absent, not permissive', () => {
  for (const v of [undefined, null, '', '   ']) {
    const r = classifySpdx(v);
    assert.equal(r.eligible, false);
    assert.equal(r.how, 'absent');
  }
});

test('only unambiguous aliases are normalised — bare "BSD" is left alone', () => {
  assert.equal(normaliseKnownAlias('MIT License'), 'MIT');
  assert.equal(normaliseKnownAlias('Apache License 2.0'), 'Apache-2.0');
  assert.equal(normaliseKnownAlias('BSD'), 'BSD'); // a family, not a licence
  assert.equal(isEligibleSpdx(normaliseKnownAlias('BSD')), false);
});

const MIT_TEXT = `MIT License

Copyright (c) 2026 Someone

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.`;

const BSD3_TEXT = `Copyright (c) 2026 Someone. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice.
2. Redistributions in binary form must reproduce the above copyright notice.
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS "AS IS".`;

const BSD2_TEXT = BSD3_TEXT.replace(
  /3\. Neither the name[\s\S]*?this software\.\n/,
  '',
);

test('template matching pins the actual variant', () => {
  assert.equal(matchLicenceText(MIT_TEXT), 'MIT');
  assert.equal(matchLicenceText(BSD3_TEXT), 'BSD-3-Clause');
  assert.equal(matchLicenceText(BSD2_TEXT), 'BSD-2-Clause');
  assert.equal(
    matchLicenceText('Apache License\nVersion 2.0, January 2004\nhttp://www.apache.org/licenses/'),
    'Apache-2.0',
  );
});

test('custom text does not match, and a stub is too short to match', () => {
  assert.equal(matchLicenceText('You may look at this code but not use it. Contact us for terms.'), null);
  assert.equal(matchLicenceText('LICENSE'), null);
  assert.equal(matchLicenceText(''), null);
  assert.equal(matchLicenceText(null), null);
});

test('raw URLs are built for github and gitlab, and nowhere else', () => {
  assert.deepEqual(rawUrlsFor('https://github.com/acme/thing', 'LICENSE'), [
    'https://raw.githubusercontent.com/acme/thing/HEAD/LICENSE',
  ]);
  assert.deepEqual(rawUrlsFor('https://github.com/acme/thing.git', 'LICENSE'), [
    'https://raw.githubusercontent.com/acme/thing/HEAD/LICENSE',
  ]);
  assert.equal(rawUrlsFor('https://gitlab.com/acme/thing', 'LICENSE').length, 2);
  assert.deepEqual(rawUrlsFor('https://example.invalid/acme/thing', 'LICENSE'), []);
  assert.deepEqual(rawUrlsFor('not a url', 'LICENSE'), []);
});
