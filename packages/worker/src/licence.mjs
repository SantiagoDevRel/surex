// The licence gate — FR-16, tech spec §8.
//
// Runs before any source upload. Redistribution-permitting licences proceed to
// Walrus; everything else is written as `unreviewable` with `reason: 'licence'`
// and no source upload.
//
// The rule that matters most: **unmatched is ineligible, not permissive.** No
// licence found, a proprietary licence and an unmatchable custom text land in the
// same bucket, because a false positive writes someone else's code into
// content-addressed storage that has no delete. Refusing wrongly costs one extra
// `unreviewable` row.
//
// Resolution order, per spec:
//   1. the SPDX identifier declared in package.json (via the npm registry) or in
//      PyPI metadata;
//   2. failing that, a LICENSE / LICENCE / COPYING file from the repo, matched
//      against SPDX templates;
//   3. failing that, ineligible.

const UA = 'surex-worker/0.1 (ETHGlobal Lisbon 2026; licence gate)';

/**
 * The eligible set: exactly what tech spec §8 names — MIT, Apache-2.0, BSD-*, ISC,
 * MPL-2.0, the GPL family — and nothing more.
 *
 * Unlicense, CC0-1.0, Zlib and Python-2.0 are deliberately out despite permitting
 * redistribution. Widening a gate that writes third-party source into storage with
 * no delete is a decision for a person to make and record.
 */
const ELIGIBLE_PATTERNS = [
  /^MIT(-0)?$/i,
  /^Apache-2\.0$/i,
  /^0BSD$/i,
  /^BSD-[0-9]-Clause(-[A-Za-z]+)?$/i,
  /^ISC$/i,
  /^MPL-2\.0$/i,
  /^(GPL|LGPL|AGPL)-\d\.\d(\.\d)?(-only|-or-later)?\+?$/i,
];

/** Strings that positively declare "you may not redistribute this". */
const EXPLICIT_INELIGIBLE = [
  /^UNLICENSED$/i, // npm's own marker for "not licensed for reuse"
  /^SEE LICEN[CS]E IN /i,
  /proprietary/i,
  /all rights reserved/i,
  /commercial/i,
];

export function isEligibleSpdx(id) {
  const trimmed = String(id ?? '').trim();
  if (!trimmed) return false;
  return ELIGIBLE_PATTERNS.some((re) => re.test(trimmed));
}

/**
 * Evaluate an SPDX expression.
 *  · `A OR B`  → eligible if either side is (the consumer picks).
 *  · `A AND B` → eligible only if both are (the consumer must satisfy both).
 *  · `A WITH e` → judged on A; an exception cannot make a refused licence eligible.
 * Anything we cannot parse is ineligible, by the rule at the top of this file.
 */
export function classifySpdx(expression) {
  const raw = String(expression ?? '').trim();
  if (!raw) return { eligible: false, spdx: null, how: 'absent' };
  if (EXPLICIT_INELIGIBLE.some((re) => re.test(raw))) {
    return { eligible: false, spdx: raw, how: 'explicitly-ineligible' };
  }

  const evaluate = (text) => {
    const s = text.trim().replace(/^\((.*)\)$/s, '$1').trim();
    // OR binds loosest, so split on it first.
    const orParts = splitTop(s, 'OR');
    if (orParts.length > 1) {
      const results = orParts.map(evaluate);
      const winner = results.find((r) => r.eligible);
      return winner ?? { eligible: false, spdx: results.map((r) => r.spdx).join(' OR ') };
    }
    const andParts = splitTop(s, 'AND');
    if (andParts.length > 1) {
      const results = andParts.map(evaluate);
      return {
        eligible: results.every((r) => r.eligible),
        spdx: results.map((r) => r.spdx).join(' AND '),
      };
    }
    const withParts = splitTop(s, 'WITH');
    if (withParts.length > 1) {
      const base = evaluate(withParts[0]);
      return { eligible: base.eligible, spdx: s };
    }
    const id = normaliseKnownAlias(s);
    return { eligible: isEligibleSpdx(id), spdx: id };
  };

  const result = evaluate(raw);
  return { eligible: result.eligible, spdx: result.spdx, how: 'spdx-expression' };
}

/** Split on a top-level operator, respecting parentheses. */
function splitTop(text, op) {
  const parts = [];
  let depth = 0;
  let start = 0;
  const re = new RegExp(`\\b${op}\\b`, 'gi');
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (depth !== 0) continue;
    re.lastIndex = i;
    const m = re.exec(text);
    if (m && m.index === i) {
      parts.push(text.slice(start, i));
      i += m[0].length - 1;
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * Non-SPDX spellings common in real package.json files, unambiguous ones only.
 * Bare "BSD" is deliberately not here: it names a family, not a licence, and the
 * LICENSE-file matcher pins the actual variant.
 */
const ALIASES = new Map([
  ['mit license', 'MIT'],
  ['the mit license', 'MIT'],
  ['mit licence', 'MIT'],
  ['apache 2.0', 'Apache-2.0'],
  ['apache-2', 'Apache-2.0'],
  ['apache license 2.0', 'Apache-2.0'],
  ['apache license, version 2.0', 'Apache-2.0'],
  ['apache2', 'Apache-2.0'],
  ['gpl-3.0+', 'GPL-3.0-or-later'],
  ['gplv3', 'GPL-3.0'],
  ['gplv2', 'GPL-2.0'],
  ['agplv3', 'AGPL-3.0'],
  ['lgplv3', 'LGPL-3.0'],
  ['mozilla public license 2.0', 'MPL-2.0'],
  ['isc license', 'ISC'],
  ['bsd-3', 'BSD-3-Clause'],
  ['bsd 3-clause', 'BSD-3-Clause'],
  ['bsd-2', 'BSD-2-Clause'],
  ['bsd 2-clause', 'BSD-2-Clause'],
]);

export function normaliseKnownAlias(text) {
  const s = String(text ?? '').trim();
  return ALIASES.get(s.toLowerCase()) ?? s;
}

/**
 * SPDX template matching for a licence file. Each entry is the set of phrases only
 * that licence's real text contains, matched against whitespace-collapsed
 * lowercase; `not` clauses separate the near-identical BSD variants, where 2-Clause
 * and 3-Clause differ by one paragraph.
 */
const TEMPLATES = [
  {
    spdx: 'Apache-2.0',
    all: ['apache license', 'version 2.0, january 2004', 'licensed under the apache license'],
  },
  { spdx: 'Apache-2.0', all: ['apache license', 'version 2.0, january 2004'] },
  {
    spdx: 'MIT',
    all: [
      'permission is hereby granted, free of charge, to any person obtaining a copy',
      'the software is provided "as is", without warranty',
    ],
  },
  {
    spdx: 'MIT',
    all: [
      'permission is hereby granted, free of charge, to any person obtaining a copy',
      'without restriction, including without limitation the rights',
    ],
  },
  {
    spdx: 'ISC',
    all: ['permission to use, copy, modify, and/or distribute this software for any purpose'],
  },
  {
    spdx: 'BSD-3-Clause',
    all: [
      'redistribution and use in source and binary forms',
      'neither the name of',
      'may be used to endorse or promote products derived',
    ],
  },
  {
    spdx: 'BSD-2-Clause',
    all: [
      'redistribution and use in source and binary forms',
      'redistributions in binary form must reproduce the above copyright',
    ],
    not: ['neither the name of'],
  },
  { spdx: '0BSD', all: ['permission to use, copy, modify, and/or distribute this software for any purpose with or without fee'], not: ['disclaimer'] },
  { spdx: 'MPL-2.0', all: ['mozilla public license', 'version 2.0'] },
  { spdx: 'AGPL-3.0', all: ['gnu affero general public license', 'version 3'] },
  { spdx: 'LGPL-3.0', all: ['gnu lesser general public license', 'version 3'] },
  { spdx: 'LGPL-2.1', all: ['gnu lesser general public license', 'version 2.1'] },
  { spdx: 'GPL-3.0', all: ['gnu general public license', 'version 3'] },
  { spdx: 'GPL-2.0', all: ['gnu general public license', 'version 2'] },
];

export function matchLicenceText(text) {
  if (typeof text !== 'string' || text.length < 60) return null;
  const flat = text.toLowerCase().replace(/\s+/g, ' ');
  for (const t of TEMPLATES) {
    if (!t.all.every((p) => flat.includes(p))) continue;
    if (t.not?.some((p) => flat.includes(p))) continue;
    return t.spdx;
  }
  return null;
}

/** Filenames worth trying, in the order a human would look. */
export const LICENCE_FILENAMES = [
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
  'LICENCE',
  'LICENCE.md',
  'LICENCE.txt',
  'COPYING',
  'COPYING.txt',
  'LICENSE-MIT',
  'LICENSE-APACHE',
];

/** raw.githubusercontent / gitlab raw URLs for one candidate filename. */
export function rawUrlsFor(repoUrl, filename) {
  let url;
  try {
    url = new URL(repoUrl);
  } catch {
    return [];
  }
  const path = url.pathname.replace(/^\/+/, '').replace(/\.git$/, '').replace(/\/+$/, '');
  const host = url.hostname.toLowerCase();
  if (host.endsWith('github.com')) {
    return [`https://raw.githubusercontent.com/${path}/HEAD/${filename}`];
  }
  if (host.endsWith('gitlab.com')) {
    return [
      `https://gitlab.com/${path}/-/raw/HEAD/${filename}`,
      `https://gitlab.com/${path}/-/raw/main/${filename}`,
    ];
  }
  return [];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch a file and say why it failed. Never collapse the two failures into `null`:
 * a 404 is a real negative (that file is not in that repo, try the next name), but
 * a timeout, 429 or 5xx is no answer at all. Treating the second as the first makes
 * the gate publish `unreviewable`/`licence` — "no licence permits us to store this
 * source" — about somebody else's correctly licensed package, because of a rate
 * limit. `transport: true` marks that case for the caller.
 */
export async function fetchWithReason(url, { timeoutMs = 8000, attempts = 3 } = {}) {
  let why = 'unknown';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { 'user-agent': UA } });
      if (res.ok) return { ok: true, text: await res.text() };
      // 404 is an answer. Everything else is the server declining to give one.
      if (res.status === 404) return { ok: false, why: 'not-found' };
      why = `http-${res.status}`;
    } catch (err) {
      why = err?.name === 'AbortError' ? 'timeout' : 'network';
    } finally {
      clearTimeout(timer);
    }
    if (attempt < attempts) await sleep(300 * attempt);
  }
  return { ok: false, why, transport: true };
}

async function getText(url, { timeoutMs = 8000 } = {}) {
  const got = await fetchWithReason(url, { timeoutMs });
  return got.ok ? got.text : null;
}

async function getJson(url, { timeoutMs = 8000 } = {}) {
  const text = await getText(url, { timeoutMs });
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * npm registry metadata for one version. Carries `dist.integrity` — the sha512 of
 * the published tarball that makes Tier A reachable later (FR-18) — recorded now
 * because it is unobtainable once the version is unpublished.
 */
export async function npmVersionMeta(name, version) {
  const encoded = String(name).replace('/', '%2f');
  const v = version ? encodeURIComponent(version) : 'latest';
  const meta = await getJson(`https://registry.npmjs.org/${encoded}/${v}`);
  if (!meta) return null;
  return {
    name: meta.name,
    version: meta.version,
    // The npm `license` field is package.json's own, which is what the spec points at.
    license: typeof meta.license === 'string' ? meta.license : meta.license?.type ?? null,
    integrity: meta.dist?.integrity ?? null,
    shasum: meta.dist?.shasum ?? null,
    repository: typeof meta.repository === 'string' ? meta.repository : meta.repository?.url ?? null,
    deprecated: meta.deprecated ?? null,
  };
}

export async function pypiVersionMeta(name, version) {
  const base = `https://pypi.org/pypi/${encodeURIComponent(name)}`;
  const meta = await getJson(version ? `${base}/${encodeURIComponent(version)}/json` : `${base}/json`);
  if (!meta?.info) return null;
  const classifier = (meta.info.classifiers ?? []).find((c) => c.startsWith('License :: OSI Approved ::'));
  return {
    name: meta.info.name,
    version: meta.info.version,
    // license_expression is the modern SPDX field; `license` is free text; the
    // trove classifier is a last resort and is mapped, not trusted verbatim.
    license: meta.info.license_expression || meta.info.license || null,
    classifier: classifier ?? null,
  };
}

/** Trove classifiers → SPDX, only where the mapping is unambiguous. */
const CLASSIFIER_TO_SPDX = new Map([
  ['License :: OSI Approved :: MIT License', 'MIT'],
  ['License :: OSI Approved :: Apache Software License', 'Apache-2.0'],
  ['License :: OSI Approved :: ISC License (ISCL)', 'ISC'],
  ['License :: OSI Approved :: Mozilla Public License 2.0 (MPL 2.0)', 'MPL-2.0'],
  ['License :: OSI Approved :: BSD License', null], // family, not a licence — refuse
  ['License :: OSI Approved :: GNU General Public License v3 (GPLv3)', 'GPL-3.0'],
  ['License :: OSI Approved :: GNU General Public License v2 (GPLv2)', 'GPL-2.0'],
  ['License :: OSI Approved :: GNU Affero General Public License v3', 'AGPL-3.0'],
  ['License :: OSI Approved :: GNU Lesser General Public License v3 (LGPLv3)', 'LGPL-3.0'],
]);

/**
 * The gate itself.
 *
 * @param {Object} candidate  one resolved seed candidate (see registry.mjs)
 * @returns {Promise<{eligible:boolean, spdx:string|null, source:string, detail:string,
 *                    integrity:string|null, resolvedVersion:string|null}>}
 */
export async function licenceGate(candidate, { fetchRepoFiles = true } = {}) {
  const trail = [];
  let integrity = null;
  let resolvedVersion = null;

  // 1. Declared SPDX id, from the package's own metadata.
  const pkg = candidate.pkg;
  if (pkg?.registryType === 'npm') {
    const meta = await npmVersionMeta(pkg.identifier, pkg.version);
    if (meta) {
      integrity = meta.integrity;
      resolvedVersion = meta.version;
      trail.push(`npm ${meta.name}@${meta.version} license=${meta.license ?? 'none'}`);
      const verdict = classifySpdx(meta.license);
      if (verdict.eligible) {
        return {
          eligible: true,
          spdx: verdict.spdx,
          source: 'package.json',
          detail: trail.join(' · '),
          integrity,
          resolvedVersion,
        };
      }
    } else {
      trail.push(`npm ${pkg.identifier}@${pkg.version ?? 'latest'} not resolvable`);
    }
  } else if (pkg?.registryType === 'pypi') {
    const meta = await pypiVersionMeta(pkg.identifier, pkg.version);
    if (meta) {
      resolvedVersion = meta.version;
      trail.push(`pypi ${meta.name}@${meta.version} license=${meta.license ?? 'none'}`);
      const verdict = classifySpdx(meta.license);
      if (verdict.eligible) {
        return {
          eligible: true,
          spdx: verdict.spdx,
          source: 'pypi-metadata',
          detail: trail.join(' · '),
          integrity,
          resolvedVersion,
        };
      }
      if (meta.classifier && CLASSIFIER_TO_SPDX.has(meta.classifier)) {
        const mapped = CLASSIFIER_TO_SPDX.get(meta.classifier);
        trail.push(`classifier ${meta.classifier} → ${mapped ?? 'ambiguous'}`);
        if (mapped && isEligibleSpdx(mapped)) {
          return {
            eligible: true,
            spdx: mapped,
            source: 'pypi-classifier',
            detail: trail.join(' · '),
            integrity,
            resolvedVersion,
          };
        }
      }
    } else {
      trail.push(`pypi ${pkg.identifier} not resolvable`);
    }
  } else if (pkg) {
    trail.push(`${pkg.registryType} package: no metadata API used`);
  }

  // 2. A LICENSE file in the repo, matched against SPDX templates.
  //
  // `undetermined` tracks a candidate that failed for a reason that is not an
  // answer. No licence found and something unreachable → refuse to claim
  // ineligibility (see the return at the bottom): ineligible is a public statement
  // about somebody's package, "we could not tell" is not.
  let undetermined = null;
  if (fetchRepoFiles && candidate.repo?.url) {
    for (const filename of LICENCE_FILENAMES) {
      for (const url of rawUrlsFor(candidate.repo.url, filename)) {
        const got = await fetchWithReason(url);
        if (!got.ok) {
          if (got.transport) undetermined = `${filename}: ${got.why}`;
          continue;
        }
        const text = got.text;
        const spdx = matchLicenceText(text);
        trail.push(`${filename} → ${spdx ?? 'unmatched'}`);
        if (spdx && isEligibleSpdx(spdx)) {
          return {
            eligible: true,
            spdx,
            source: `repo:${filename}`,
            detail: trail.join(' · '),
            integrity,
            resolvedVersion,
          };
        }
        // A file that exists but does not match is the "custom text" case —
        // ineligible, and stop looking: a repo whose LICENSE we cannot read is not
        // made eligible by a second file with a friendlier name.
        if (!spdx) {
          return {
            eligible: false,
            spdx: null,
            source: `repo:${filename}`,
            detail: `${trail.join(' · ')} · unmatched licence text is treated as ineligible`,
            integrity,
            resolvedVersion,
          };
        }
      }
    }
    trail.push('no licence file found in repo');
  } else if (!candidate.repo?.url) {
    trail.push('no repository url to check');
  }

  // Nothing matched. Was that an answer, or a failure to get one?
  if (undetermined) {
    return {
      eligible: false,
      undetermined: true,
      spdx: null,
      source: 'unreachable',
      detail: `${trail.join(' · ')} · could not read the repository licence (${undetermined}) — refusing to call this ineligible on a failed request`,
      integrity,
      resolvedVersion,
    };
  }

  return {
    eligible: false,
    spdx: null,
    source: 'none',
    detail: trail.join(' · ') || 'no licence signal at all',
    integrity,
    resolvedVersion,
  };
}
