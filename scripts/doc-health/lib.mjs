import fs from 'node:fs';
import path from 'node:path';

export const CHARTER_BUDGETS = {
  'README.md': 150,
  'AGENTS.md': 300,
  'VISION.md': 120,
};

export const TOOL_STUB_BUDGETS = {
  'CLAUDE.md': 25,
  'GEMINI.md': 25,
};

export const REVIEW_STALE_MS = 90 * 24 * 60 * 60 * 1000;
export const ACTIVE_PLAN_STALE_MS = 30 * 24 * 60 * 60 * 1000;

const DIR_EXCLUDES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.html-artifacts',
]);

export function toPosix(p) {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '');
}

export function normalizeRel(p) {
  return path.posix.normalize(toPosix(p)).replace(/^\.\//, '');
}

export function walkFiles(root) {
  const out = [];
  const base = path.resolve(root);
  function rec(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = toPosix(path.relative(base, abs));
      if (entry.isDirectory()) {
        if (DIR_EXCLUDES.has(entry.name)) continue;
        rec(abs);
      } else if (entry.isFile()) {
        out.push({ abs, rel });
      }
    }
  }
  rec(base);
  return out;
}

export function readText(abs) {
  return fs.readFileSync(abs, 'utf8');
}

export function lineCount(text) {
  if (text.length === 0) return 0;
  return text.replace(/\r\n/g, '\n').split('\n').length;
}

export function stripCode(text) {
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
}

export function parseFrontmatter(text) {
  if (!text.startsWith('---')) return { hasFrontmatter: false, data: {}, body: text };
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { hasFrontmatter: false, data: {}, body: text };
  const data = {};
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const rest = kv[2].trim();
    if (rest === '') {
      const items = [];
      let j = i + 1;
      while (j < lines.length && /^\s*-\s+/.test(lines[j])) {
        items.push(stripOuterQuotes(lines[j].replace(/^\s*-\s+/, '').trim()));
        j += 1;
      }
      data[key] = items;
      i = j - 1;
    } else if (rest.startsWith('[') && rest.endsWith(']')) {
      data[key] = rest.slice(1, -1).split(',').map((v) => stripOuterQuotes(v.trim())).filter(Boolean);
    } else {
      data[key] = stripOuterQuotes(rest);
    }
  }
  return { hasFrontmatter: true, data, body: text.slice(match[0].length) };
}

function stripOuterQuotes(value) {
  return String(value).replace(/^["']/, '').replace(/["']$/, '');
}

export function parseDocMetadata(text) {
  const frontmatter = parseFrontmatter(text);
  const top = text.split(/\r?\n/).slice(0, 40).join('\n');
  const header = {};
  const headerRe = /^>\s*\*\*([^:*]+):\*\*\s*(.*?)\s*$/gmi;
  let m;
  while ((m = headerRe.exec(top)) !== null) {
    header[m[1].trim().toLowerCase()] = m[2].trim();
  }
  const plainStatus = top.match(/^Status:\s*(.*?)\s*$/im)?.[1]?.trim();

  const status = frontmatter.data.status ?? header.status ?? plainStatus ?? null;
  return {
    hasFrontmatter: frontmatter.hasFrontmatter,
    frontmatter: frontmatter.data,
    body: frontmatter.body,
    status,
    statusNorm: normalizeStatus(status),
    sourceOfTruth: frontmatter.data['source-of-truth'] ?? frontmatter.data.source_of_truth ?? header['source of truth'] ?? null,
    lastReviewed: frontmatter.data['last-reviewed'] ?? frontmatter.data.last_reviewed ?? header['last reviewed'] ?? null,
    updated: frontmatter.data.updated ?? null,
    supersededBy: frontmatter.data['superseded-by'] ?? header['superseded by'] ?? null,
  };
}

export function normalizeStatus(status) {
  if (status == null) return '';
  return String(status).trim().toLowerCase();
}

export function isActiveDoc(meta) {
  return meta?.statusNorm === 'active';
}

export function isOperationalActiveDoc(meta) {
  return ['active', 'current', 'canon', 'approved', 'accepted'].includes(meta?.statusNorm);
}

export function isSupersededDoc(meta) {
  return meta?.statusNorm === 'superseded' || meta?.statusNorm?.startsWith('superseded');
}

export function hasSupersededByPointer(value) {
  if (value == null) return false;
  const values = Array.isArray(value) ? value : [value];
  return values.some((v) => {
    const s = String(v).trim();
    return s !== '' && s !== '[]' && !/^none$/i.test(s);
  });
}

export function isCurrentTruthRegister(rel, meta) {
  const p = toPosix(rel).toLowerCase();
  if (p === 'docs/canon.md' || p === 'docs/project-status.md') return true;
  if (meta.statusNorm === 'canon') return true;
  return /^yes\b/i.test(String(meta.sourceOfTruth ?? '').trim());
}

export function markdownFiles(root) {
  return walkFiles(root).filter((f) => f.rel.toLowerCase().endsWith('.md'));
}

export function extractMarkdownLinks(text) {
  const links = [];
  const re = /(?<!!)\[[^\]]*]\(\s*([^)\s]+)(?:\s+[^)]*)?\)/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    let target = match[1].trim();
    if (!target || /^(https?:|mailto:|tel:)/i.test(target)) continue;
    if (target.startsWith('#')) continue;
    target = target.split('#')[0].split('?')[0];
    try {
      target = decodeURIComponent(target);
    } catch {
      // Keep the raw target if decoding fails; resolution will mark it dangling.
    }
    if (target) links.push({ target, index: match.index });
  }
  return links;
}

export function lineForIndex(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

export function resolveRelativeTarget(root, fromRel, target) {
  const fromDir = path.posix.dirname(toPosix(fromRel));
  const rawCandidates = [];
  if (target.startsWith('/')) {
    rawCandidates.push(target.replace(/^\/+/, ''));
  } else {
    rawCandidates.push(path.posix.normalize(path.posix.join(fromDir, target)));
    rawCandidates.push(path.posix.normalize(target));
  }
  for (const candidate of rawCandidates) {
    if (!candidate || candidate.startsWith('..')) continue;
    const variants = [candidate];
    if (!path.posix.extname(candidate)) variants.push(`${candidate}.md`, path.posix.join(candidate, 'README.md'), path.posix.join(candidate, 'index.md'));
    for (const variant of variants) {
      const abs = path.join(root, ...variant.split('/'));
      if (fs.existsSync(abs)) return { ok: true, rel: normalizeRel(variant) };
    }
  }
  return { ok: false };
}

export function linkTargetsFromMarkdown(root, fromRel, text) {
  const targets = new Set();
  for (const link of extractMarkdownLinks(stripCode(text))) {
    const hit = resolveRelativeTarget(root, fromRel, link.target);
    if (hit.ok) targets.add(hit.rel);
  }
  return targets;
}

export function isDurableIndexedDoc(rel, meta) {
  if (!rel.startsWith('docs/')) return false;
  if (rel === 'docs/INDEX.md') return false;
  return meta.hasFrontmatter;
}

export function earliestTokenLine(text, tokens) {
  let best = null;
  const clean = stripCode(text);
  for (const token of tokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'i');
    const match = clean.match(re);
    if (!match || match.index == null) continue;
    const line = lineForIndex(clean, match.index);
    if (best == null || line < best) best = line;
  }
  return best ?? 1;
}

// ─── #124 L2: doc-map contract helpers ─────────────────────────────────────────

// Top-level directories the code-root coverage rule must account for: visible
// dirs only, minus the same junk walkFiles skips — dot-dirs (.github/.agent/
// .changelog are config, not code roots) and DIR_EXCLUDES.
export function topLevelDirs(root) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !DIR_EXCLUDES.has(e.name))
    .map((e) => e.name)
    .sort();
}

// Minimal glob for the doc-map's owns/heal_when/path vocabulary — third copy
// of the ecosystem's zero-dep converter (twins in scripts/close/lib.mjs and
// scripts/doc-sweep/lib.mjs): `**` spans segments, `*` stays within one,
// everything else is literal, anchored both ends. The NUL placeholder cannot
// appear in a real glob.
export function docMapGlobToRegExp(glob) {
  const escaped = String(glob)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${escaped}$`);
}

// Backtick tokens that read as repo paths, for the path-refs rule. Deliberately
// conservative — a false "missing path" blocking a PR is worse than a missed
// one: requires a '/', bans whitespace, glob metachars, URLs/anchors/windows
// drives (':'), placeholders ('<'), flags ('--'), and leading '/' or '#'; each
// segment is word-ish. Returns [{ token, line }], deduped per token per doc.
export function extractPathRefTokens(text) {
  const out = [];
  const seen = new Set();
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    for (const match of lines[i].matchAll(/`([^`]+)`/g)) {
      const token = match[1].trim();
      if (seen.has(token)) continue;
      if (!token.includes('/')) continue;
      if (/[\s*?{}[\]<>:]/.test(token)) continue;
      if (token.startsWith('/') || token.startsWith('#') || token.startsWith('--')) continue;
      const segments = token.replace(/\/$/, '').split('/');
      if (!segments.every((seg) => /^[\w.@-]+$/.test(seg))) continue;
      seen.add(token);
      out.push({ token, line: i + 1 });
    }
  }
  return out;
}
