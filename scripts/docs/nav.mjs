// llms.txt `nav` + README `status` generators (#124, S1; committed class).
// Both are pure projections of .agent/doc-map.yml + docs/CANON.md frontmatter,
// so re-rendering at any commit with the same inputs is byte-identical —
// committed-class blocks must never embed volatile state (dates, live gh data).
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseDocMetadata, readText } from '../doc-health/lib.mjs';
import { applyGeneratedFile, readDocMap } from './lib.mjs';

// Pure: doc-map + CANON summary -> llms.txt nav block body.
export function renderNavBlock(docMap, canonSummary) {
  const lines = [
    'Doc system (generated from .agent/doc-map.yml by `npm run docs:render`):',
    `- docs/CANON.md — ${canonSummary || 'ground-truth register'}`,
    '',
    'Generated surfaces (never hand-edit inside managed blocks):',
  ];
  for (const doc of docMap.generated) {
    lines.push(`- ${doc.path} [${doc.class}] regenerate: ${doc.generator}`);
  }
  lines.push('', 'Machine-checked docs (re-verified when owned paths change):');
  for (const doc of docMap.checked) {
    lines.push(`- ${doc.path} owns: ${doc.owns.join(', ')}`);
  }
  lines.push('', 'Required base docs (every repo carries these):');
  for (const doc of docMap.required.base) {
    lines.push(`- ${doc}`);
  }
  return lines.join('\n');
}

// Pure: doc-map -> README "## Status" block body.
export function renderReadmeStatusBlock(docMap) {
  const committed = docMap.generated.filter((d) => d.class === 'committed').length;
  const rendered = docMap.generated.filter((d) => d.class === 'rendered').length;
  return [
    'Docs are maintained by the self-maintaining docs system (`.agent/doc-map.yml`):',
    `${committed} committed generated surfaces (regenerate with \`npm run docs:render\`),`,
    `${rendered} rendered dashboard(s) (\`npm run docs:status\` — rendered, not committed),`,
    `${docMap.checked.length} machine-checked docs. Contract: docs/agent-process/doc-system.md.`,
  ].join('\n');
}

// `surfaces` selects which of the two nav-owned blocks to touch — a partial
// doc-map that declares only README's status block must not fail on llms.txt
// markers it never promised (repo-template#146 round 6). Default: both.
export function runNav({ root, check = false, surfaces = ['nav', 'status'] }) {
  const docMap = readDocMap(root);
  const canon = parseDocMetadata(readText(join(root, 'docs', 'CANON.md')));
  let changed = false;
  if (surfaces.includes('nav')) {
    changed = applyGeneratedFile({
      path: join(root, 'llms.txt'),
      blockId: 'nav',
      body: renderNavBlock(docMap, canon.frontmatter.summary ?? null),
      check,
    }).changed || changed;
  }
  if (surfaces.includes('status')) {
    changed = applyGeneratedFile({
      path: join(root, 'README.md'),
      blockId: 'status',
      body: renderReadmeStatusBlock(docMap),
      check,
    }).changed || changed;
  }
  return { changed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { parseGeneratorArgs } = await import('./lib.mjs');
  const args = parseGeneratorArgs(process.argv.slice(2));
  const { changed } = runNav(args);
  if (args.check && changed) {
    console.error('llms.txt nav / README status blocks are stale — run: npm run docs:render');
    process.exitCode = 1;
  }
}
