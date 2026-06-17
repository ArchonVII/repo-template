// scripts/wiki/lint.mjs
//
// Wiki health check over the pages tier. Deterministic; exits non-zero on errors
// (missing/invalid frontmatter, broken page links), exits 0 with warnings noted.
// Rules: docs/LIBRARIAN.md "Page frontmatter" + "Operations" + "Links".
//
// hudson-bend supports BOTH link styles: Markdown links [text](file.md) in bodies
// (GitHub-friendly) and [[wikilinks]]. This lint resolves both; frontmatter
// relations (wikilinks) also count toward inbound so cross-referenced pages are
// not flagged as orphans.

import {
  repoRoot, walkMarkdown, isPage, parseFrontmatter, stripCode,
  extractWikilinks, extractMarkdownLinks,
  buildResolver, matchLink, STATUS_VALUES, CONFIDENCE_VALUES, TYPE_VALUES, parseFlags, toPosix,
} from './lib.mjs';
import fs from 'node:fs';

const root = repoRoot();
parseFlags(process.argv.slice(2));

const resolver = buildResolver(root);
const pages = walkMarkdown(root, { excludeRel: ['docs/memory'] }).filter((f) => isPage(f.rel));

const errors = [];
const warnings = [];
const inboundRels = new Set(); // concrete lowercased rels that something links to (orphan detection)
const fmByRel = new Map();

for (const page of pages) {
  const text = fs.readFileSync(page.full, 'utf8');
  const { data, hasFrontmatter } = parseFrontmatter(text);
  fmByRel.set(page.rel, data);

  // Frontmatter presence + required fields.
  if (!hasFrontmatter) {
    errors.push(`${page.rel}: missing frontmatter (need at least summary + status)`);
  } else {
    if (!data.summary || String(data.summary).trim() === '') errors.push(`${page.rel}: missing 'summary'`);
    if (!data.status) errors.push(`${page.rel}: missing 'status'`);
    else if (!STATUS_VALUES.includes(data.status)) errors.push(`${page.rel}: invalid status '${data.status}'`);
    if (data.confidence && !CONFIDENCE_VALUES.includes(data.confidence)) {
      errors.push(`${page.rel}: invalid confidence '${data.confidence}'`);
    }
    if (!data.confidence) warnings.push(`${page.rel}: missing 'confidence'`);
    if (!data.updated) warnings.push(`${page.rel}: missing 'updated'`);
    // `type` is optional (schema 1.1). An out-of-set value is allowed but unusual — warn,
    // never error, so producer-defined kinds stay valid (see docs/LIBRARIAN.md "Page type").
    if (data.type && !TYPE_VALUES.includes(data.type)) {
      warnings.push(`${page.rel}: type '${data.type}' is outside the recommended set (allowed, but unusual)`);
    }
  }

  const bodyNoCode = stripCode(text);

  // Broken wikilinks. A path link that does not resolve is an error; a bare-name link
  // that does not resolve is a warning (often a machine-local memory note, absent in CI).
  for (const target of extractWikilinks(bodyNoCode)) {
    const hit = matchLink(target, page.rel, resolver);
    if (hit === null) {
      if (target.includes('/')) errors.push(`${page.rel}: broken wikilink [[${target}]] (path does not resolve)`);
      else warnings.push(`${page.rel}: unresolved [[${target}]] (no matching note; may be a machine-local memory note)`);
    } else if (hit.endsWith('.md')) {
      inboundRels.add(hit); // a concrete page got linked
    }
  }

  // Broken Markdown links. Markdown links point at many asset kinds (HTML mockups,
  // images, the docs/ dir), so only an unresolved link that *looks like a page*
  // (ends in .md) is an error; anything else unresolved is a warning.
  for (const target of extractMarkdownLinks(bodyNoCode)) {
    const hit = matchLink(target, page.rel, resolver);
    if (hit === null) {
      if (/\.md$/i.test(target)) errors.push(`${page.rel}: broken link [...](${target}) (page does not resolve)`);
      else warnings.push(`${page.rel}: unresolved link [...](${target})`);
    } else if (hit.endsWith('.md')) {
      inboundRels.add(hit);
    }
  }

  // Frontmatter relations (relates / depends-on) count as inbound for orphan detection.
  for (const key of ['relates', 'depends-on']) {
    for (const rel of toArray(data[key])) {
      const tgt = String(rel).replace(/\[\[|\]\]/g, '').split('|')[0].split('#')[0].trim();
      if (!tgt) continue;
      const hit = matchLink(tgt, page.rel, resolver);
      if (hit && hit.endsWith('.md')) inboundRels.add(hit);
    }
  }
}

// One-sided supersession + orphan detection (warnings).
for (const page of pages) {
  const data = fmByRel.get(page.rel) || {};
  const baseName = toPosix(page.rel).split('/').pop().replace(/\.md$/i, '').toLowerCase();
  for (const sb of toArray(data['superseded-by'])) {
    const t = String(sb).replace(/\[\[|\]\]/g, '').split('|')[0].toLowerCase();
    const target = pages.find((p) => p.rel.toLowerCase().endsWith(`${t}.md`) || p.rel.toLowerCase().endsWith(`/${t}.md`));
    if (target) {
      const td = fmByRel.get(target.rel) || {};
      const back = toArray(td.supersedes).map((x) => String(x).replace(/\[\[|\]\]/g, '').split('|')[0].toLowerCase());
      if (!back.includes(baseName)) warnings.push(`${page.rel}: one-sided supersession (target '${t}' lacks supersedes back-link)`);
    }
  }
  if (!inboundRels.has(page.rel.toLowerCase()) && data.status !== 'CANON') {
    warnings.push(`${page.rel}: orphan (no inbound links)`);
  }
}

console.log(`wiki:lint — ${pages.length} pages checked`);
if (warnings.length) {
  console.log(`  warnings: ${warnings.length}`);
  for (const w of warnings) console.log(`    ~ ${w}`);
}
if (errors.length) {
  console.error(`  ERRORS: ${errors.length}`);
  for (const e of errors) console.error(`    x ${e}`);
  console.error('\nFix errors above (see docs/LIBRARIAN.md). Warnings do not fail the lint.');
  process.exit(1);
}
console.log('  No errors.');

function toArray(v) {
  if (v === undefined || v === null || v === '') return [];
  return Array.isArray(v) ? v : [v];
}
