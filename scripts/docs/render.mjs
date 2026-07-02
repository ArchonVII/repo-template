#!/usr/bin/env node
// `npm run docs:render` — regenerate every committed-class doc surface in one
// pass (#124, S1). `--check` is the drift gate: exit 1 when any block would
// change, write nothing (P1 wires this under repo-required-gate / decision).
import { parseGeneratorArgs } from './lib.mjs';
import { runIndex } from './index.mjs';
import { runNav } from './nav.mjs';

const args = parseGeneratorArgs(process.argv.slice(2));
const results = [
  { name: 'docs/INDEX.md (index-pages)', ...runIndex(args) },
  { name: 'llms.txt (nav) + README.md (status)', ...runNav(args) },
];

const stale = results.filter((r) => r.changed);
if (args.check) {
  if (stale.length > 0) {
    console.error('docs:render --check failed — stale generated blocks:');
    for (const r of stale) console.error(`- ${r.name}`);
    console.error('Regenerate with: npm run docs:render');
    process.exitCode = 1;
  } else {
    console.log('docs:render --check passed — all generated blocks current.');
  }
} else {
  for (const r of results) console.log(`${r.changed ? 'regenerated' : 'current'}  ${r.name}`);
}
