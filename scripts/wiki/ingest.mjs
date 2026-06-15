// scripts/wiki/ingest.mjs
//
// Orchestrator: prepares a docs/raw/ source for ingestion. It validates the source,
// runs a cheap secret/PII scan, prints the ingest checklist and likely-impacted pages,
// and suggests a target page path. It does NOT write wiki pages — a node script cannot
// extract durable claims; the agent does the semantic pass per docs/LIBRARIAN.md.

import fs from 'node:fs';
import path from 'node:path';
import { repoRoot, parseFlags, walkMarkdown, isPage } from './lib.mjs';

const root = repoRoot();
const { positionals, agent } = parseFlags(process.argv.slice(2));
const target = positionals[0];

console.log(`wiki:ingest — agent=${agent}`);
if (!target) {
  console.error('  usage: npm run wiki:ingest -- <path-under-docs/raw>');
  process.exit(1);
}
const abs = path.isAbsolute(target) ? target : path.join(root, target);
if (!fs.existsSync(abs)) {
  console.error(`  source not found: ${target}`);
  process.exit(1);
}
const text = fs.readFileSync(abs, 'utf8');

// Cheap secret/PII scan — warn, don't block.
const SECRET_PATTERNS = [
  [/AKIA[0-9A-Z]{16}/g, 'AWS access key id'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, 'private key block'],
  [/\bsk-[A-Za-z0-9]{20,}\b/g, 'OpenAI-style secret key'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, 'GitHub token'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, 'Slack token'],
  [/(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{8,}['"]/gi, 'inline credential'],
];
const hits = [];
for (const [re, label] of SECRET_PATTERNS) if (re.test(text)) hits.push(label);
if (hits.length) {
  console.log(`\n  ! possible sensitive data — review before committing: ${hits.join(', ')}`);
}

// Suggest a target page by keyword overlap with existing page basenames.
const words = new Set((text.toLowerCase().match(/[a-z]{4,}/g) || []).slice(0, 400));
const pages = walkMarkdown(root, { excludeRel: ['docs/memory'] }).filter((f) => isPage(f.rel));
const ranked = pages.map((p) => {
  const name = p.rel.toLowerCase();
  let score = 0;
  for (const w of words) if (name.includes(w)) score += 1;
  return { rel: p.rel, score };
}).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);

console.log('\n  Likely-impacted pages (keyword overlap):');
if (ranked.length) for (const r of ranked) console.log(`    - ${r.rel}`);
else console.log('    (none obvious — this may warrant a new page)');

console.log('\n  Ingest checklist (you perform the extraction — see docs/LIBRARIAN.md):');
console.log('    1. Read the source; note key takeaways.');
console.log('    2. Update/create page(s); mark claims EXTRACTED vs INFERRED.');
console.log('    3. Add typed relations + summary/status frontmatter.');
console.log('    4. Update docs/INDEX.md and append to docs/log.md.');
console.log('    5. Leave the source in docs/raw/ unchanged (immutable).');
