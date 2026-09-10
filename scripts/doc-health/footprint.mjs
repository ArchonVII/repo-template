#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDocMap } from '../docs/lib.mjs';
import { docMapGlobToRegExp, isOperationalActiveDoc, parseDocMetadata } from './lib.mjs';

const ROOT_INSTRUCTIONS = ['AGENTS.md', 'AGENTS.override.md', 'CLAUDE.md', 'GEMINI.md', 'CODEX.md'];
const isDoc = (rel) => /\.(md|mdx|txt)$/i.test(rel);
const words = (text) => (text.match(/\S+/g) || []).length;
const list = (value) => Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
const sorted = (values) => [...new Set(values)].sort();
const empty = () => ({ files: 0, words: 0 });
const inside = (rel) => rel !== '..' && !rel.startsWith('../') && !path.posix.isAbsolute(rel) && !/^[A-Za-z]:/.test(rel);

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
}
function baseTexts(root, commit) {
  const entries = git(root, ['ls-tree', '-rz', '--full-tree', commit]).split('\0').filter(Boolean).flatMap((record) => {
    const [header, rel] = [record.slice(0, record.indexOf('\t')), record.slice(record.indexOf('\t') + 1)];
    return header.startsWith('100') && isDoc(rel) ? [{ rel, oid: header.split(' ')[2] }] : [];
  });
  if (!entries.length) return new Map();
  // Batch immutable blobs: Git's index flags may suppress a working-tree diff.
  const output = execFileSync('git', ['-C', root, 'cat-file', '--batch'], {
    input: entries.map((e) => e.oid).join('\n') + '\n', maxBuffer: 32 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let offset = 0;
  return new Map(entries.map(({ rel }) => {
    const end = output.indexOf(10, offset);
    const header = output.subarray(offset, end).toString('utf8').match(/^[a-f0-9]+ blob (\d+)$/);
    if (!header) throw new Error(`Cannot read base blob for ${rel}`);
    const size = Number(header[1]);
    const body = output.subarray(end + 1, end + 1 + size).toString('utf8').replace(/\r\n/g, '\n');
    offset = end + size + 2;
    return [rel, body];
  }));
}
function state(rel, text) {
  const meta = parseDocMetadata(text);
  if (/^docs\/plans\/\d{4}-\d{2}-\d{2}-[^/]+\.md$/i.test(rel)) {
    return meta.statusNorm === 'active' && /^yes\b/i.test(String(meta.sourceOfTruth ?? '').trim())
      ? 'active' : 'historical';
  }
  if (isOperationalActiveDoc(meta)) return 'active';
  if (/^(archived|superseded|closed|complete|completed|done|historical)\b/.test(meta.statusNorm)
    || /(^|\/)(archive|archives|history)(\/|$)/i.test(rel)
    || rel.startsWith('docs/superpowers/plans/')) return 'historical';
  return 'unclassified';
}
function summarize(texts) {
  const result = { total: empty(), active: empty(), historical: empty(), unclassified: empty() };
  for (const [rel, text] of texts) {
    if (!isDoc(rel)) continue;
    for (const group of ['total', state(rel, text)]) {
      result[group].files++;
      result[group].words += words(text);
    }
  }
  return result;
}
function imports(text) {
  // Import syntax only: links and code examples are not unconditional reads.
  let fence = null;
  let paragraph = false;
  const prose = text.replace(/<!--[^]*?-->/g, '').split(/\r?\n/).filter((line) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      return false;
    }
    if (marker) { fence = marker[1]; paragraph = false; return false; }
    if (!line.trim()) { paragraph = false; return true; }
    // An indented code block cannot interrupt an existing paragraph.
    if (/^( {4}|\t)/.test(line) && !paragraph) return false;
    paragraph = !/^ {0,3}(#{1,6}(\s|$)|([-*_]\s*){3,}$)/.test(line);
    return true;
  }).join('\n').replace(/(`+)[^]*?\1/g, '');
  return [...prose.matchAll(/(?:^|\s)@([^\s<>"'`]+\.(?:md|mdx|txt))(?=$|[\s.,;:)])/gim)].map((m) => m[1]);
}
function instructionFootprint(texts) {
  const files = new Map();
  const unresolved = [];
  function visit(rel, from, target) {
    if (!inside(rel) || !texts.has(rel)) {
      unresolved.push({ from, target, reason: inside(rel) ? 'missing, ignored, or not a regular repository text file' : 'outside repository' });
      return;
    }
    if (files.has(rel)) return;
    const text = texts.get(rel);
    files.set(rel, { path: rel, words: words(text) });
    for (const target of sorted(imports(text))) {
      const normalized = target.replace(/\\/g, '/');
      const imported = path.posix.isAbsolute(normalized) || /^[A-Za-z]:|^~/.test(normalized)
        ? '../external' : path.posix.normalize(path.posix.join(path.posix.dirname(rel), normalized));
      visit(imported, rel, target);
    }
  }
  for (const rel of ROOT_INSTRUCTIONS) if (texts.has(rel)) visit(rel, null, rel);
  const entries = [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
  return {
    scope: 'Union of root instruction files and explicit local @ imports; not the full agent runtime context.',
    total: { files: entries.length, words: entries.reduce((sum, f) => sum + f.words, 0) },
    files: entries,
    unresolved,
  };
}
function affectedDocs(map, changedPaths, documentPaths) {
  const affected = new Map();
  const covered = new Set();
  const add = (rel, changedPath, rule) => {
    if (!affected.has(rel)) affected.set(rel, []);
    const reasons = affected.get(rel);
    if (!reasons.some((r) => r.changedPath === changedPath && r.rule === rule)) reasons.push({ changedPath, rule });
    covered.add(changedPath);
  };
  for (const rel of changedPaths) if (isDoc(rel)) add(rel, rel, 'document changed');
  for (const [section, field] of [['checked', 'owns'], ['human', 'heal_when']]) {
    for (const entry of map?.[section] || []) {
      const matchingDocs = documentPaths.filter((rel) => docMapGlobToRegExp(entry.path).test(rel));
      // Preserve a literal missing doc as an actionable selection, not a silent omission.
      if (!matchingDocs.length && typeof entry.path === 'string' && !entry.path.includes('*')) matchingDocs.push(entry.path);
      for (const pattern of list(entry[field])) {
        for (const changedPath of changedPaths.filter((rel) => docMapGlobToRegExp(pattern).test(rel))) {
          for (const rel of matchingDocs) add(rel, changedPath, `${field}: ${pattern}`);
        }
      }
    }
  }
  return {
    affected: [...affected].sort(([a], [b]) => a.localeCompare(b)).map(([path, reasons]) => ({ path, reasons })),
    unmapped: changedPaths.filter((rel) => !covered.has(rel)),
  };
}

export function reportFootprint(repoRoot, { base = null } = {}) {
  const root = fs.realpathSync(repoRoot);
  if (fs.realpathSync(git(root, ['rev-parse', '--show-toplevel']).trim()) !== root) throw new Error('--repo must be the repository root');
  const tracked = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean);
  const current = new Map();
  for (const rel of sorted(tracked.filter(isDoc))) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs) || !fs.lstatSync(abs).isFile()) continue;
    if (!inside(path.relative(root, fs.realpathSync(abs)).replace(/\\/g, '/'))) continue;
    current.set(rel, fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n'));
  }
  let map = null;
  if (fs.existsSync(path.join(root, '.agent/doc-map.yml'))) {
    map = readDocMap(root);
    if (map?.version !== 1) throw new Error('doc-map must have version 1');
  }
  const documents = summarize(current);
  const instructions = instructionFootprint(current);
  let comparisonBase = null;
  let delta = null;
  let changes = [];
  let changedPaths = [];
  if (base !== null) {
    try { comparisonBase = git(root, ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]).trim(); }
    catch { throw new Error(`Invalid or unavailable base: ${base}`); }
    // Docs are compared directly below, but Git can hide other working-tree edits.
    const hidden = git(root, ['ls-files', '-v', '-z']).split('\0')
      .filter((record) => /^[a-zS] /.test(record)).map((record) => record.slice(2)).filter((rel) => !isDoc(rel));
    if (hidden.length) throw new Error(`Cannot evaluate impact with index-hidden non-document paths: ${hidden.join(', ')}. Clear assume-unchanged/skip-worktree flags or omit --base for counts only.`);
    changedPaths = sorted([
      ...git(root, ['diff', '--no-renames', '--name-only', '-z', comparisonBase, '--']).split('\0'),
      ...git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0'),
    ].filter(Boolean));
    const before = baseTexts(root, comparisonBase);
    const oldSummary = summarize(before);
    const difference = (a, b) => ({ files: a.files - b.files, words: a.words - b.words });
    delta = Object.fromEntries(Object.keys(documents).map((group) => [group, difference(documents[group], oldSummary[group])]));
    delta.instructions = difference(instructions.total, instructionFootprint(before).total);
    changes = sorted([...before.keys(), ...current.keys()].filter(isDoc)).filter((rel) => before.get(rel) !== current.get(rel)).map((rel) => {
      const wordsBefore = words(before.get(rel) || '');
      const wordsAfter = words(current.get(rel) || '');
      return {
        path: rel, change: !before.has(rel) ? 'added' : !current.has(rel) ? 'deleted' : 'modified',
        wordsBefore, wordsAfter, wordsDelta: wordsAfter - wordsBefore,
        stateBefore: before.has(rel) ? state(rel, before.get(rel)) : null,
        stateAfter: current.has(rel) ? state(rel, current.get(rel)) : null,
      };
    });
    changedPaths = sorted([...changedPaths, ...changes.map((c) => c.path)]);
  }
  return {
    schemaVersion: 'doc-footprint.v1', comparisonBase, documents, instructions, delta, changes,
    ...affectedDocs(map, changedPaths, [...current.keys()].filter(isDoc)),
  };
}

export function formatFootprint(report) {
  const signed = (n) => n >= 0 ? `+${n}` : String(n);
  const lines = ['Documentation footprint (words include markup and code):'];
  for (const [group, total] of Object.entries(report.documents)) {
    const d = report.delta?.[group];
    lines.push(`  ${group}: ${total.files} files, ${total.words} words${d ? ` (${signed(d.files)} files, ${signed(d.words)} words)` : ''}`);
  }
  const instructionDelta = report.delta?.instructions;
  lines.push(`Instruction union: ${report.instructions.total.files} files, ${report.instructions.total.words} words${instructionDelta ? ` (${signed(instructionDelta.files)} files, ${signed(instructionDelta.words)} words)` : ''}`);
  lines.push(report.instructions.scope);
  for (const u of report.instructions.unresolved) lines.push(`  unresolved ${u.from}: @${u.target} (${u.reason})`);
  for (const c of report.changes) lines.push(`  ${c.change} ${c.path}: ${signed(c.wordsDelta)} words (${c.stateBefore ?? 'absent'} -> ${c.stateAfter ?? 'absent'})`);
  if (!report.comparisonBase) lines.push('No base supplied; change impact and growth were not evaluated.');
  else {
    lines.push('Affected reads (map selection, not proof of completeness):');
    for (const d of report.affected) lines.push(`  ${d.path}: ${d.reasons.map((r) => `${r.changedPath} [${r.rule}]`).join('; ')}`);
    if (report.unmapped.length) lines.push(`Unmapped changes: ${report.unmapped.join(', ')}`);
  }
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    let repo = process.cwd(), base = null, json = false;
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--json') json = true;
      else if (args[i] === '--repo' || args[i] === '--base') {
        const flag = args[i];
        const value = args[++i];
        if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
        if (flag === '--repo') repo = value; else base = value;
      } else throw new Error(`Unknown argument: ${args[i]}`);
    }
    const report = reportFootprint(repo, { base });
    process.stdout.write((json ? JSON.stringify(report, null, 2) : formatFootprint(report)) + '\n');
  } catch (error) {
    process.stderr.write(`doc-footprint: ${error.message}\nUsage: node scripts/doc-health/footprint.mjs [--repo <root>] [--base <git-ref>] [--json]\n`);
    process.exitCode = 2;
  }
}
