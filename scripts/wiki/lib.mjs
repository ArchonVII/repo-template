// scripts/wiki/lib.mjs
//
// Shared helpers for the agent-neutral wiki operations (`npm run wiki:*`).
// Zero-dependency Node ESM — no build step, no node_modules.
//
// The semantic rules these scripts enforce live in docs/LIBRARIAN.md; this file
// only implements the deterministic mechanics (frontmatter parse, link
// resolution, repo walk). Ported from jma-history's Librarian; adapted for
// repo-template: the wiki ships in the template so new repos inherit it. npm
// (not pnpm), and BOTH link styles (Markdown links AND [[wikilinks]]) per
// docs/LIBRARIAN.md "Links". Pre-existing template doc trees that do not yet
// carry wiki frontmatter are listed as non-page tiers below; bring them under
// the schema incrementally.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// The Librarian schema version this tooling implements. `<major>.<minor>`: a minor bump is a
// backward-compatible addition (new optional key, new recommended vocabulary); a major bump is
// a breaking change (renaming/removing a required key, changing required semantics). It is an
// informational drift signal — many repos inherit this schema via a pinned snapshot and fall
// behind — surfaced by wiki:doctor; it is never a gate. Source: docs/LIBRARIAN.md "Schema
// versioning" (this repo); modeled on OKF's `okf_version`
// (https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md).
export const SCHEMA_VERSION = '1.1';

// Allowed label vocabularies — source: docs/LIBRARIAN.md "Page frontmatter".
export const STATUS_VALUES = ['CANON', 'CURRENT', 'APPROVED', 'EXPERIMENTAL', 'PROPOSED', 'DEPRECATED', 'SUPERSEDED'];
export const CONFIDENCE_VALUES = ['EXTRACTED', 'INFERRED', 'AMBIGUOUS', 'UNVERIFIED'];

// The canonical first-reads every agent must be pointed at — source: llms.txt / AGENTS.md.
export const REQUIRED_FIRST_READS = ['AGENTS.md', 'docs/CANON.md', 'docs/LIBRARIAN.md', 'docs/INDEX.md', 'docs/project-status.md'];

// The shared operation surface — source: docs/LIBRARIAN.md "Operations".
export const WIKI_COMMANDS = ['start', 'ingest', 'query', 'lint', 'crystallize', 'compact-save', 'doctor'];

// Directories never walked for wiki content (build / vcs / editor state).
const DIR_EXCLUDES = new Set([
  'node_modules', '.git', 'dist', 'build', '.vite', '.cache', '.pnpm-store',
  '.obsidian', 'coverage', 'target', 'gen', '.html-artifacts',
]);

// Tiers that are not "pages": memory is a machine-local junction; raw is immutable
// intake; audits/log are transient. Link-checking and frontmatter rules skip these.
// Paths are repo-root-relative, forward-slashed.
export const NON_PAGE_PREFIXES = [
  'docs/memory/', 'docs/raw/', 'docs/audits/',
  // The repo update log's per-PR fragments are operational ledger entries, not
  // wiki pages (repo-template#89 convention; the single repo-update-log.md is frozen).
  'docs/repo-update-log/',
  // Pre-existing template doc trees not yet under the wiki schema. A repo brings
  // these in incrementally: add frontmatter to a tree's pages, then remove it here.
  'docs/adr/', 'docs/agent-process/', 'docs/plans/', 'docs/superpowers/',
];
// Append-only logs + standalone template docs are not pages.
export const NON_PAGE_FILES = [
  'docs/log.md',
  'docs/repo-update-log.md',
  'docs/decisions/decision-log.md',
  'docs/template-library-inventory.md',
];

export function repoRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  }
}

export function toPosix(p) {
  return p.split(path.sep).join('/');
}

// Recursively collect markdown files under `root`. `excludeRel` is a list of
// repo-root-relative posix paths to skip (e.g. ['docs/memory']).
export function walkMarkdown(root, { excludeRel = [] } = {}) {
  const rootResolved = path.resolve(root);
  const out = [];
  const skip = new Set(excludeRel);
  (function rec(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = toPosix(path.relative(rootResolved, full));
      if (e.isDirectory()) {
        if (DIR_EXCLUDES.has(e.name)) continue;
        if (skip.has(rel)) continue;
        rec(full);
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        out.push({ full, rel });
      }
    }
  })(rootResolved);
  return out;
}

export function isPage(rel) {
  if (NON_PAGE_FILES.includes(rel)) return false;
  if (!rel.startsWith('docs/')) return false;
  return !NON_PAGE_PREFIXES.some((p) => rel.startsWith(p));
}

// Minimal frontmatter reader. Supports `key: scalar`, inline flow arrays
// (`key: ["[[a]]"]`), and Obsidian block lists (`key:` then indented `- item`).
// Sufficient for the fields defined in docs/LIBRARIAN.md; not a full YAML parser.
export function parseFrontmatter(text) {
  if (!text.startsWith('---')) return { data: {}, body: text, hasFrontmatter: false };
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: text, hasFrontmatter: false };
  const lines = m[1].split(/\r?\n/);
  const body = text.slice(m[0].length);
  const data = {};
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let rest = kv[2].trim();
    if (rest === '') {
      const items = [];
      let j = i + 1;
      while (j < lines.length && /^\s*-\s+/.test(lines[j])) {
        items.push(stripQuotes(lines[j].replace(/^\s*-\s+/, '').trim()));
        j += 1;
      }
      data[key] = items; // possibly empty
      i = j - 1;
      continue;
    }
    if (rest.startsWith('[') && rest.endsWith(']')) {
      try {
        data[key] = JSON.parse(rest);
      } catch {
        data[key] = rest.slice(1, -1).split(',').map((s) => stripQuotes(s.trim())).filter(Boolean);
      }
      continue;
    }
    data[key] = stripQuotes(rest);
  }
  return { data, body, hasFrontmatter: true };
}

function stripQuotes(s) {
  return s.replace(/^["']/, '').replace(/["']$/, '');
}

// Remove fenced and inline code so example links inside code (e.g. the schema
// samples in docs/LIBRARIAN.md) are not mistaken for real links.
export function stripCode(text) {
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
}

// All `[[target]]` link targets in `text` (alias and #anchor stripped).
export function extractWikilinks(text) {
  const links = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const target = m[1].split('|')[0].split('#')[0].trim();
    if (target) links.push(target);
  }
  return links;
}

// All Markdown link targets `[text](target)` in `text` — the GitHub-friendly link
// style hudson-bend uses. Image embeds `![]()`, external `http(s)://` links, mailto,
// and pure `#anchor` links are skipped; an optional "title" and trailing #anchor are
// stripped. This is the "both link styles" enabler (see docs/LIBRARIAN.md "Links").
export function extractMarkdownLinks(text) {
  const links = [];
  // (?<!\!) — not an image embed. Capture the (...) target up to the first space or ).
  const re = /(?<!\!)\[[^\]]*\]\(\s*([^)\s]+)(?:\s+[^)]*)?\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let target = m[1].trim();
    if (/^(https?:|mailto:|tel:)/i.test(target)) continue; // external
    target = target.split('#')[0]; // drop anchor
    target = decodeURIComponent(target);
    if (target) links.push(target);
  }
  return links;
}

// Build a vault-wide resolver from every tracked markdown file (memory excluded).
export function buildResolver(root) {
  const files = walkMarkdown(root, { excludeRel: ['docs/memory'] });
  const byRel = new Set();
  const byBasename = new Map();
  for (const f of files) {
    const low = f.rel.toLowerCase();
    byRel.add(low);
    byRel.add(low.replace(/\.md$/, ''));
    const base = path.posix.basename(low).replace(/\.md$/, '');
    if (!byBasename.has(base)) byBasename.set(base, []);
    byBasename.get(base).push(f.rel);
  }
  return { files, byRel, byBasename, root };
}

// Extensions tried when a link points at a non-markdown file (code pointers, assets,
// HTML mockups). Original case is preserved for case-sensitive CI filesystems. The
// empty string '' matches a target that already carries its own extension (e.g. .html).
const LINK_FILE_EXTS = ['', '.ts', '.tsx', '.mjs', '.js', '.cjs', '.json', '.md', '.html', '.png', '.svg', '.jpg', '.jpeg', '.webp', '.csv', '.yml', '.yaml'];

// Resolve a link target (wikilink or Markdown) from `fromRel` to a concrete
// lowercased file rel, or a sentinel ('memory' / 'external' / 'self' / 'file'), or
// null if broken. Obsidian-style: path-relative-to-file, then vault-root-relative,
// then bare basename.
export function matchLink(target, fromRel, resolver) {
  const t = target.trim();
  const low = t.toLowerCase();
  if (!t) return 'self';
  if (low === 'memory' || low.startsWith('memory/') || low.startsWith('docs/memory/')) return 'memory'; // machine-local tier
  if (/^https?:\/\//.test(low)) return 'external';
  const fromDir = path.posix.dirname(toPosix(fromRel));
  // Original-case resolved paths (for case-sensitive fs checks) and their lowercased keys.
  const raw = [path.posix.normalize(path.posix.join(fromDir, t)), path.posix.normalize(t)];
  // 1. Markdown index: path match (with/without .md), then bare basename.
  for (const rc of raw) {
    const lc = rc.toLowerCase();
    if (resolver.byRel.has(lc)) return lc.endsWith('.md') ? lc : `${lc}.md`;
    if (resolver.byRel.has(`${lc}.md`)) return `${lc}.md`;
  }
  const base = path.posix.basename(t).replace(/\.md$/, '').toLowerCase();
  const hit = resolver.byBasename.get(base);
  if (hit && hit.length) return hit[0].toLowerCase();
  // 2. Real file on disk (code pointers, assets, HTML mockups). Stays inside the repo.
  for (const rc of raw) {
    if (rc.startsWith('..')) continue; // never resolve outside the vault
    for (const ext of LINK_FILE_EXTS) {
      try {
        const abs = path.join(resolver.root, rc + ext);
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return 'file';
      } catch { /* ignore and keep trying */ }
    }
  }
  return null;
}

// Boolean convenience wrapper.
export function resolveLink(target, fromRel, resolver) {
  return matchLink(target, fromRel, resolver) !== null;
}

// Tiny flag parser. Returns { agent, failOpen, subagent, positionals }.
export function parseFlags(argv) {
  const out = { agent: 'manual', failOpen: false, subagent: false, positionals: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--agent') { out.agent = argv[i + 1] || 'manual'; i += 1; }
    else if (a === '--fail-open') out.failOpen = true;
    else if (a === '--subagent') out.subagent = true;
    else if (!a.startsWith('--')) out.positionals.push(a);
  }
  return out;
}

export function readIfExists(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

export function listFiles(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}

// Append a line to the gitignored ops log. Best-effort; never throws.
export function appendLog(root, line) {
  try {
    fs.appendFileSync(path.join(root, 'docs', 'log.md'), `${line}\n`);
  } catch { /* fail-open: the log is a convenience, not a gate */ }
}

export const SECTION = (title) => `\n=== ${title} ===`;
