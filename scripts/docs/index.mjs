// docs/INDEX.md `index-pages` generator (#124, S1; committed class).
// Walks docs/**/*.md frontmatter and regenerates the managed block so INDEX
// never rots by hand. Deterministic: inputs are the docs tree at HEAD only.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseDocMetadata, readText, walkFiles } from '../doc-health/lib.mjs';
import { applyGeneratedFile } from './lib.mjs';

// Tiers excluded from the index, with the reason each is out:
// - docs/raw/            immutable intake sources (LIBRARIAN wiki tiers) — not durable pages
// - docs/repo-update-log/ per-PR fragment ledger — machine-consumed, retired in #124 S3
// - docs/INDEX.md        the index itself
// - docs/log.md          append-only ops log (gitignored where present)
const EXCLUDED_PREFIXES = ['docs/raw/', 'docs/repo-update-log/'];
const EXCLUDED_FILES = new Set(['docs/INDEX.md', 'docs/log.md']);

export function collectIndexDocs(root) {
  const docs = [];
  for (const file of walkFiles(join(root, 'docs'))) {
    const rel = `docs/${file.rel}`;
    if (!rel.endsWith('.md')) continue;
    if (EXCLUDED_FILES.has(rel)) continue;
    if (EXCLUDED_PREFIXES.some((prefix) => rel.startsWith(prefix))) continue;
    const meta = parseDocMetadata(readText(file.abs));
    docs.push({
      rel,
      summary: meta.frontmatter.summary ?? null,
      status: meta.status ?? null,
    });
  }
  docs.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return docs;
}

// Status values come from arbitrary source-doc frontmatter: strip trailing
// YAML comments and cap the length so one verbose doc cannot un-scannable the
// whole index. 48 chars keeps the longest real status in this repo intact
// ("Design approved with amendments (2026-06-02)") while cutting run-ons.
const STATUS_DISPLAY_MAX = 48;
export function displayStatus(status) {
  if (!status) return null;
  let value = String(status).replace(/\s+#.*$/, '').trim();
  if (value.length > STATUS_DISPLAY_MAX) value = `${value.slice(0, STATUS_DISPLAY_MAX - 1).trimEnd()}…`;
  return value || null;
}

// Pure: [{rel, summary, status}] -> markdown for the index-pages block.
// Grouped root-first, then per-subdirectory; links are INDEX-relative.
export function renderIndexBlock(docs) {
  const groups = new Map();
  for (const doc of docs) {
    const inner = doc.rel.slice('docs/'.length);
    const slash = inner.indexOf('/');
    const group = slash === -1 ? '' : `${inner.slice(0, slash)}/`;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({ ...doc, href: inner, name: inner.slice(inner.lastIndexOf('/') + 1) });
  }
  const orderedGroups = [...groups.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a < b ? -1 : 1));

  const lines = ['_Generated from docs/**/*.md frontmatter by `npm run docs:render` — do not edit by hand._'];
  for (const group of orderedGroups) {
    lines.push('');
    if (group !== '') lines.push(`### ${group}`, '');
    for (const doc of groups.get(group).sort((a, b) => (a.href < b.href ? -1 : 1))) {
      const summary = doc.summary ? ` — ${doc.summary}` : '';
      const status = displayStatus(doc.status);
      lines.push(`- [${doc.name}](${doc.href})${summary}${status ? ` \`${status}\`` : ''}`);
    }
  }
  return lines.join('\n');
}

export function runIndex({ root, check = false }) {
  return applyGeneratedFile({
    path: join(root, 'docs', 'INDEX.md'),
    blockId: 'index-pages',
    body: renderIndexBlock(collectIndexDocs(root)),
    check,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { parseGeneratorArgs } = await import('./lib.mjs');
  const args = parseGeneratorArgs(process.argv.slice(2));
  const { changed } = runIndex(args);
  if (args.check && changed) {
    console.error('docs/INDEX.md index-pages block is stale — run: npm run docs:render');
    process.exitCode = 1;
  }
}
