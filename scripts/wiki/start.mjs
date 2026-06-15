// scripts/wiki/start.mjs
//
// Session-start briefing: print the required reading order, open audits, the
// docs/raw/ ingest queue, and a quick page-frontmatter health count. Informational
// and fail-open — always exits 0. Source: docs/LIBRARIAN.md "wiki:start".

import path from 'node:path';
import {
  repoRoot, REQUIRED_FIRST_READS, listFiles, walkMarkdown, isPage,
  parseFrontmatter, parseFlags, appendLog,
} from './lib.mjs';
import fs from 'node:fs';

const root = repoRoot();
const { agent } = parseFlags(process.argv.slice(2));

console.log(`wiki:start — agent=${agent}`);

console.log('\nRead first (canonical layer):');
for (const f of REQUIRED_FIRST_READS) console.log(`  - ${f}`);

// Open audits: docs/audits/*.md except README.md and archive/.
const auditsDir = path.join(root, 'docs', 'audits');
const openAudits = listFiles(auditsDir)
  .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md') && e.name.toLowerCase() !== 'readme.md')
  .map((e) => `docs/audits/${e.name}`);
console.log(`\nOpen audits: ${openAudits.length}`);
for (const a of openAudits) console.log(`  ! ${a}`);
if (openAudits.length) console.log('  Resolve these first, then move each to docs/audits/archive/.');

// Ingest queue: docs/raw/*.md (or any file) except README.md.
const rawDir = path.join(root, 'docs', 'raw');
const rawQueue = listFiles(rawDir)
  .filter((e) => e.isFile() && e.name.toLowerCase() !== 'readme.md')
  .map((e) => `docs/raw/${e.name}`);
console.log(`\nUnprocessed sources (docs/raw/): ${rawQueue.length}`);
for (const r of rawQueue) console.log(`  + ${r}  ->  npm run wiki:ingest -- ${r}`);

// Quick health: count pages missing frontmatter summary/status.
let missing = 0;
const pages = walkMarkdown(root, { excludeRel: ['docs/memory'] }).filter((f) => isPage(f.rel));
for (const p of pages) {
  const { data, hasFrontmatter } = parseFrontmatter(fs.readFileSync(p.full, 'utf8'));
  if (!hasFrontmatter || !data.summary || !data.status) missing += 1;
}
console.log(`\nPages: ${pages.length} (missing summary/status: ${missing}). Run 'npm run wiki:lint' for detail.`);

appendLog(root, `## [${stamp()}] start | agent=${agent} | audits=${openAudits.length} raw=${rawQueue.length} pages=${pages.length}`);

function stamp() {
  // Local date only; the log is a per-machine convenience, not a determinism gate.
  return new Date().toISOString().slice(0, 10);
}
