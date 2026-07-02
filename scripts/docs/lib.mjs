// Shared plumbing for the self-maintaining docs system (#124, S1).
// Contract: docs/agent-process/doc-system.md. Spine: .agent/doc-map.yml.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Markers match the ecosystem-wide convention established by archon-setup's
// managed markdown blocks, so one convention covers AGENTS.md blocks and
// generated doc surfaces alike.
export function managedBlockMarkers(id) {
  return {
    begin: `<!-- BEGIN ARCHONVII MANAGED BLOCK: ${id} -->`,
    end: `<!-- END ARCHONVII MANAGED BLOCK: ${id} -->`,
  };
}

// Replace the content between the block markers. Throws when markers are
// absent: generators must never append blocks silently — a missing marker
// means the target file predates the docs system or was hand-mangled, and
// both need a human decision, not an auto-graft.
export function renderManagedBlock(content, id, body) {
  const { begin, end } = managedBlockMarkers(id);
  const text = String(content);
  const beginAt = text.indexOf(begin);
  if (beginAt === -1) {
    throw new Error(
      `managed block "${id}" BEGIN marker not found — add "${begin}" / "${end}" to the target file first`
    );
  }
  const endAt = text.indexOf(end, beginAt + begin.length);
  if (endAt === -1) {
    throw new Error(`managed block "${id}" has a BEGIN marker but no END marker ("${end}")`);
  }
  return `${text.slice(0, beginAt + begin.length)}\n${String(body).replace(/\n+$/, '')}\n${text.slice(endAt)}`;
}

// Regenerate one managed block in a file. check:true reports drift without
// writing (the docs:render --check drift gate); check:false writes in place.
// Drift is judged eol-normalized: a Windows autocrlf checkout materializes
// committed files with CRLF while generators emit LF, and that must not read
// as stale (or every fresh Windows checkout false-fails the gate — #124 L2).
export function applyGeneratedFile({ path, blockId, body, check = false }) {
  const before = readFileSync(path, 'utf8');
  const after = renderManagedBlock(before, blockId, body);
  const changed = after.replace(/\r\n/g, '\n') !== before.replace(/\r\n/g, '\n');
  if (changed && !check) writeFileSync(path, after, 'utf8');
  return { changed };
}

// ---------------------------------------------------------------------------
// .agent/doc-map.yml parser.
//
// repo-template has zero runtime deps, so this parses the documented doc-map
// subset of YAML directly (the same stance scripts/close takes for
// check-map.yml): top-level scalars, list-of-object sections, inline arrays,
// the required.base scalar list, and the code_roots string map. Anything the
// schema does not describe throws with a line number — the gate and
// onboarding derive behavior from this file, so silently dropping input is
// worse than failing (#124).
// ---------------------------------------------------------------------------

const LIST_SECTIONS = new Set(['generated', 'checked', 'human']);

// Strip a trailing ` # comment` outside quotes; full-line comments are
// filtered before this is called.
function stripTrailingComment(value) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble && /\s/.test(value[i - 1] || ' ')) {
      return value.slice(0, i).trimEnd();
    }
  }
  return value.trimEnd();
}

function unquote(value) {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function parseScalarOrArray(raw, lineNo) {
  const value = stripTrailingComment(raw).trim();
  if (value.startsWith('[')) {
    if (!value.endsWith(']')) throw new Error(`doc-map line ${lineNo}: unterminated inline array`);
    const inner = value.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((item) => unquote(item.trim()));
  }
  return unquote(value);
}

export function parseDocMap(text) {
  const map = { version: null, generated: [], checked: [], human: [], required: { base: [] }, code_roots: {} };
  const lines = String(text || '').split(/\r?\n/);

  let section = null; // current top-level key
  let item = null; // current list-section object
  let requiredKey = null; // current sub-key inside `required:` (only `base` is defined)

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const rawLine = lines[i];
    if (/^\s*(#|$)/.test(rawLine)) continue; // blank / full-line comment
    const indent = rawLine.match(/^[ \t]*/)[0].length;
    const line = stripTrailingComment(rawLine).trimEnd();
    const body = line.trim();

    if (indent === 0) {
      item = null;
      requiredKey = null;
      const top = body.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
      if (!top) throw new Error(`doc-map line ${lineNo}: expected a top-level "key:" line, got "${body}"`);
      const [, key, rest] = top;
      if (key === 'version') {
        map.version = Number(rest.trim());
        section = null;
      } else if (LIST_SECTIONS.has(key) || key === 'required' || key === 'code_roots') {
        if (rest.trim() !== '') throw new Error(`doc-map line ${lineNo}: section "${key}" must not have an inline value`);
        section = key;
      } else {
        throw new Error(`doc-map line ${lineNo}: unknown top-level section "${key}"`);
      }
      continue;
    }

    if (section === null) throw new Error(`doc-map line ${lineNo}: indented content outside any section`);

    if (LIST_SECTIONS.has(section)) {
      const startsItem = body.startsWith('- ');
      const kvText = startsItem ? body.slice(2) : body;
      const kv = kvText.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
      if (!kv) throw new Error(`doc-map line ${lineNo}: expected "key: value" in section "${section}"`);
      if (startsItem) {
        item = {};
        map[section].push(item);
      }
      if (!item) throw new Error(`doc-map line ${lineNo}: entry continuation before any "- " item`);
      item[kv[1]] = parseScalarOrArray(kv[2], lineNo);
      continue;
    }

    if (section === 'required') {
      if (body.startsWith('- ')) {
        if (requiredKey !== 'base') throw new Error(`doc-map line ${lineNo}: list item outside required.base`);
        map.required.base.push(unquote(body.slice(2)));
        continue;
      }
      const kv = body.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*$/);
      if (!kv || kv[1] !== 'base') throw new Error(`doc-map line ${lineNo}: required only defines "base:"`);
      requiredKey = 'base';
      continue;
    }

    if (section === 'code_roots') {
      const kv = body.match(/^([A-Za-z0-9_.-]+):\s*(.+)$/);
      if (!kv) throw new Error(`doc-map line ${lineNo}: expected "root: owning-doc" in code_roots`);
      map.code_roots[kv[1]] = unquote(kv[2]);
      continue;
    }

    throw new Error(`doc-map line ${lineNo}: unhandled content in section "${section}"`);
  }

  // Every list-section entry needs a path — a misspelled `paths:` key would
  // silently drop the entry from every guard it enables (#146 round 16).
  for (const [sectionName, entries] of [['generated', map.generated], ['checked', map.checked], ['human', map.human]]) {
    for (const entry of entries) {
      if (typeof entry.path !== 'string' || !entry.path.trim()) {
        throw new Error(`doc-map ${sectionName} entry is missing a path (keys: ${Object.keys(entry).join(', ') || 'none'})`);
      }
    }
  }

  // Scalar list fields (owns: scripts/**) are valid YAML — normalize them
  // ONCE here so no consumer can crash on .join/.map over a string
  // (#146 round 15; same lesson as scripts/close/lib.mjs toGlobList).
  const toArray = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? [v.trim()] : []);
  for (const entry of map.checked) {
    entry.owns = toArray(entry.owns);
    entry.checks = toArray(entry.checks);
  }
  for (const entry of map.human) {
    entry.heal_when = toArray(entry.heal_when);
  }
  for (const entry of map.generated) {
    entry.inputs = toArray(entry.inputs);
  }

  // generated[].class is schema, not decoration: a typo like 'commited' would
  // silently drop the entry from every consumer and disable the
  // generated-block gate (#146 round 13) — fail closed instead.
  for (const entry of map.checked) {
    const rules = Array.isArray(entry.checks) ? entry.checks : entry.checks ? [entry.checks] : [];
    for (const rule of rules) {
      if (!CHECKED_RULES.has(rule)) {
        throw new Error(
          `doc-map checked entry ${entry.path || '(no path)'}: unknown checks rule "${rule}" ` +
          `(known: ${[...CHECKED_RULES].join(', ')})`
        );
      }
    }
  }
  for (const entry of map.generated) {
    if (!GENERATED_CLASSES.has(entry.class)) {
      throw new Error(
        `doc-map generated entry ${entry.path || '(no path)'}: class must be one of ` +
        `${[...GENERATED_CLASSES].join('/')}, got "${entry.class ?? '(missing)'}"`
      );
    }
  }

  return map;
}

const GENERATED_CLASSES = new Set(['committed', 'rendered', 'release']);

// The deterministic per-doc rule vocabulary (doc-system.md contract): the
// blocking-capable rules plus the warning-only dashboard rules. An unknown
// name (checks: [link]) would silently disable the guard it misspells
// (#146 round 14) — the parser fails closed instead.
const CHECKED_RULES = new Set([
  'links',
  'path-refs',
  'last-reviewed',
  'placeholders',
  'stale-terms',
  'closed-issue-refs',
  'supersession',
]);

// The fixed surface each known committed block's generator manages — shared
// by docs:render and the doc-health render check so a declared path that
// mismatches its block fails closed everywhere (#146 rounds 7+13).
export const KNOWN_BLOCK_SURFACES = {
  'index-pages': 'docs/INDEX.md',
  nav: 'llms.txt',
  status: 'README.md',
};

export function docMapPath(root) {
  return join(root, '.agent', 'doc-map.yml');
}

export function readDocMap(root) {
  let text;
  try {
    text = readFileSync(docMapPath(root), 'utf8');
  } catch (err) {
    throw new Error(`could not read .agent/doc-map.yml under ${root}: ${err.message}`);
  }
  return parseDocMap(text);
}

// Shared CLI arg parsing for the generators: --repo <path> --check.
export function parseGeneratorArgs(argv) {
  const args = { root: process.cwd(), check: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--repo') args.root = argv[++i];
    else if (argv[i] === '--check') args.check = true;
  }
  return args;
}
