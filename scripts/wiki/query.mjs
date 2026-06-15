// scripts/wiki/query.mjs
//
// Orchestrator: deterministic retrieval over the pages tier. Scans page bodies for the
// query terms and prints the best-matching pages with their one-line summaries. The
// agent then synthesizes a cited answer and (per docs/LIBRARIAN.md) may file it back as
// a new page. A node script does not author the answer.

import fs from 'node:fs';
import { repoRoot, parseFlags, walkMarkdown, isPage, parseFrontmatter } from './lib.mjs';

const root = repoRoot();
const { positionals, agent } = parseFlags(process.argv.slice(2));
const query = positionals.join(' ').trim();

console.log(`wiki:query — agent=${agent}`);
if (!query) {
  console.error('  usage: npm run wiki:query -- "<question or keywords>"');
  process.exit(1);
}
const terms = (query.toLowerCase().match(/[a-z0-9]{3,}/g) || []);
const pages = walkMarkdown(root, { excludeRel: ['docs/memory'] }).filter((f) => isPage(f.rel));

const ranked = pages.map((p) => {
  const text = fs.readFileSync(p.full, 'utf8');
  const { data } = parseFrontmatter(text);
  const hay = text.toLowerCase();
  let score = 0;
  for (const t of terms) score += hay.split(t).length - 1;
  return { rel: p.rel, score, summary: data.summary || '' };
}).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);

console.log(`\n  Candidate pages for: "${query}"`);
if (!ranked.length) {
  console.log('    (no matches — try broader terms, or this is a gap worth a new page)');
} else {
  for (const r of ranked) {
    console.log(`    - ${r.rel}  (${r.score})`);
    if (r.summary) console.log(`        ${r.summary}`);
  }
  console.log('\n  Read these, synthesize a cited answer, and consider filing it back as a new page.');
}
