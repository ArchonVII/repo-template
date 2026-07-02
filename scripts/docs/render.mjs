#!/usr/bin/env node
// `npm run docs:render` — regenerate every committed-class doc surface in one
// pass (#124, S1). `--check` is the drift gate: exit 1 when any block would
// change, write nothing (P1 wires this under repo-required-gate / decision).
import { KNOWN_BLOCK_SURFACES, parseGeneratorArgs, readDocMap } from './lib.mjs';
import { runIndex } from './index.mjs';
import { runNav } from './nav.mjs';

const args = parseGeneratorArgs(process.argv.slice(2));
// Only the doc-map's declared committed blocks run — the remediation command
// the blocking gate points at must not ENOENT on surfaces a partial consumer
// never declared (repo-template#146 round 12). Same mapping the doc-health
// render check uses; a declared path that mismatches its block's fixed
// surface refuses to run rather than mutate an undeclared file (round 13).
const committed = (readDocMap(args.root).generated || []).filter((g) => g.class === 'committed');
for (const entry of committed) {
  // Unknown or missing block ids are unverifiable declarations — refusing
  // keeps render in agreement with doc-health, which blocks the same map
  // (#146 round 14).
  const expected = entry.block ? KNOWN_BLOCK_SURFACES[entry.block] : undefined;
  if (!expected) {
    console.error(
      `docs:render refused: committed entry ${entry.path || '(no path)'} declares ` +
      `${entry.block ? `unknown block "${entry.block}"` : 'no block id'} — no known generator manages it.`
    );
    process.exit(2);
  }
  if (entry.path !== expected) {
    console.error(
      `docs:render refused: doc-map declares block ${entry.block} at ${entry.path}, but its generator manages ${expected}.`
    );
    process.exit(2);
  }
}
const declared = new Set(committed.map((g) => g.block).filter(Boolean));
const results = [];
if (declared.has('index-pages')) {
  results.push({ name: 'docs/INDEX.md (index-pages)', ...runIndex(args) });
}
const navSurfaces = ['nav', 'status'].filter((b) => declared.has(b));
if (navSurfaces.length > 0) {
  results.push({
    name: `nav surfaces (${navSurfaces.join('+')})`,
    ...runNav({ root: args.root, check: args.check, surfaces: navSurfaces }),
  });
}

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
