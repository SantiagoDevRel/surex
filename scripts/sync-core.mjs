#!/usr/bin/env node
// Vendors packages/core into the plugin.
//
// The plugin is installed with `/plugin marketplace add` straight from a git
// repo. There is no npm install step on the user's machine, so the plugin
// cannot have a single runtime dependency — including a workspace one. The
// copies are committed so the repo is directly installable, and `--check`
// fails the build if they have drifted from the source of truth.
//
//   node scripts/sync-core.mjs           write the copies
//   node scripts/sync-core.mjs --check   fail if they differ

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'packages', 'core', 'src');
const DEST = join(ROOT, 'packages', 'plugin', 'lib', 'core');

const FILES = ['sxf1.mjs', 'verdict.mjs', 'contract.mjs', 'copy.mjs', 'blob.mjs'];

const BANNER = `// AUTO-GENERATED — do not edit.
// Vendored from packages/core/src by scripts/sync-core.mjs, because the plugin
// runs on a user's machine with nothing installed. Edit the original and re-run
// \`pnpm sync:core\`.
`;

const check = process.argv.includes('--check');
mkdirSync(DEST, { recursive: true });

let drift = 0;
for (const file of FILES) {
  const want = BANNER + readFileSync(join(SRC, file), 'utf8');
  const target = join(DEST, file);
  const have = existsSync(target) ? readFileSync(target, 'utf8') : null;
  if (have === want) continue;
  if (check) {
    console.error(`drift: packages/plugin/lib/core/${file} differs from packages/core/src/${file}`);
    drift++;
  } else {
    writeFileSync(target, want);
    console.log(`synced ${file}`);
  }
}

const indexPath = join(DEST, 'index.mjs');
const indexWant = BANNER + FILES.map((f) => `export * from './${f}';`).join('\n') + '\n';
if (!existsSync(indexPath) || readFileSync(indexPath, 'utf8') !== indexWant) {
  if (check) { console.error('drift: packages/plugin/lib/core/index.mjs'); drift++; }
  else { writeFileSync(indexPath, indexWant); console.log('synced index.mjs'); }
}

if (check && drift) {
  console.error(`\n${drift} file(s) out of sync. Run: pnpm sync:core`);
  process.exit(1);
}
if (check) console.log('plugin core copies are in sync');
