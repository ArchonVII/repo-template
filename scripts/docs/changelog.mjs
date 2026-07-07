#!/usr/bin/env node
// `npm run docs:changelog` — fold CHANGELOG.md's `## [Unreleased]` from immutable
// git history (#124, S3). CHANGELOG.md is `class: release` in .agent/doc-map.yml:
// folded ONLY at release-cut from Conventional Commit subjects, never edited
// per-PR. This is deliberately NOT run by `docs:render` (that regenerates and
// drift-gates the `class: committed` surfaces in the PR hot path); a release-class
// doc whose input is volatile git history must never gate a PR (doc-system.md,
// "the volatility rule"). Standalone release-cut tool.
//
//   npm run docs:changelog              # regenerate the changelog-unreleased block
//   npm run docs:changelog -- --check   # drift gate: exit 1 if stale, write nothing
//   npm run docs:changelog -- --since <ref>   # override the range base
//
// Range base: --since <ref> wins; else the newest tag reachable from HEAD
// (`git describe --tags --abbrev=0`); else all history (repo-template has no
// release tags yet, so the first cut folds every commit).
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyGeneratedFile, parseGeneratorArgs } from './lib.mjs';

// Conventional Commit type -> Keep a Changelog section (owner decision, #124 S3,
// 2026-07-04): feat->Added, fix->Fixed, perf/refactor->Changed. docs/chore/test/
// style/ci/build are NOT user-facing and are omitted by default; a breaking
// change (`type!:` or a `!` after the scope) is always surfaced under Changed
// regardless of type. Keep a Changelog section order: Added, Changed, Fixed.
const TYPE_SECTION = { feat: 'Added', fix: 'Fixed', perf: 'Changed', refactor: 'Changed' };
const SECTION_ORDER = ['Added', 'Changed', 'Fixed'];
const UNRELEASED_BLOCK = 'changelog-unreleased';

// Parse one Conventional Commit subject: `type(scope)!: description`. Returns
// null for a non-conforming subject (the one pre-automation root/merge commit),
// which is intentionally dropped from the generated body — conservative by
// design so the changelog stays user-facing and deterministic for --check.
export function parseConventionalSubject(subject) {
  const match = /^([a-z]+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/.exec(String(subject || '').trim());
  if (!match) return null;
  const [, type, scope, bang, description] = match;
  return { type, scope: scope || null, breaking: Boolean(bang), description: description.trim() };
}

// Fold an ordered (newest-first) list of commit subjects into Keep-a-Changelog
// sections. Pure and deterministic so a fixture can assert exact output and
// --check is meaningful. `scaffoldEntry`, when provided, is appended to Added as
// the floor entry — it carries the pre-Conventional root commit ("Initial repo
// scaffold.") the owner asked to preserve across the S3 fold (2026-07-04).
export function foldSubjectsToSections(subjects, { scaffoldEntry = null } = {}) {
  const sections = { Added: [], Changed: [], Fixed: [] };
  for (const subject of subjects) {
    const parsed = parseConventionalSubject(subject);
    if (!parsed) continue;
    const section = parsed.breaking ? 'Changed' : TYPE_SECTION[parsed.type];
    if (!section) continue; // docs/chore/test/style/ci/build, non-breaking: omitted
    const line = parsed.breaking ? `**BREAKING:** ${parsed.description}` : parsed.description;
    sections[section].push(line);
  }
  if (scaffoldEntry) sections.Added.push(scaffoldEntry);
  return sections;
}

export function renderUnreleasedBody(sections) {
  const parts = [];
  for (const name of SECTION_ORDER) {
    const entries = sections[name] || [];
    if (entries.length === 0) continue;
    parts.push(`### ${name}`, '', ...entries.map((e) => `- ${e}`), '');
  }
  return parts.join('\n').replace(/\n+$/, '');
}

function git(args, root, { quiet = false } = {}) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    // Suppress stderr for probes that legitimately fail (e.g. `describe` with no
    // tags) so the tool output stays clean; callers still see the thrown error.
    stdio: ['ignore', 'pipe', quiet ? 'ignore' : 'inherit'],
  });
}

// The range base: an explicit --since ref, else the newest reachable tag, else
// nothing (fold all history — repo-template has no release tags yet).
function resolveSince(root, sinceArg) {
  if (sinceArg) return sinceArg;
  try {
    return git(['describe', '--tags', '--abbrev=0'], root, { quiet: true }).trim() || null;
  } catch {
    return null; // no tags reachable
  }
}

export function collectSubjects(root, since) {
  const range = since ? [`${since}..HEAD`] : ['HEAD'];
  const raw = git(['log', '--no-merges', '--format=%s', ...range], root);
  return raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

export function buildUnreleasedBody(root, { since = null } = {}) {
  const subjects = collectSubjects(root, since);
  // Seed "Initial repo scaffold." only on a full-history fold (no range base):
  // it preserves the one pre-Conventional root commit the owner asked to keep
  // across the S3 fold (2026-07-04). A later tag-bounded release cut omits it.
  const scaffoldEntry = since ? null : 'Initial repo scaffold.';
  return renderUnreleasedBody(foldSubjectsToSections(subjects, { scaffoldEntry }));
}

function main(argv) {
  const args = parseGeneratorArgs(argv);
  let since = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--since') since = argv[i + 1];
  }
  since = resolveSince(args.root, since);

  const body = buildUnreleasedBody(args.root, { since });
  const path = join(args.root, 'CHANGELOG.md');
  const { changed } = applyGeneratedFile({ path, blockId: UNRELEASED_BLOCK, body, check: args.check });

  if (args.check) {
    if (changed) {
      console.error('docs:changelog --check failed — CHANGELOG.md [Unreleased] is stale.');
      console.error('Regenerate with: npm run docs:changelog');
      process.exitCode = 1;
    } else {
      console.log('docs:changelog --check passed — CHANGELOG.md [Unreleased] is current.');
    }
  } else {
    console.log(changed ? 'regenerated  CHANGELOG.md [Unreleased]' : 'current  CHANGELOG.md [Unreleased]');
  }
}

// Entry-point guard mirrors scripts/close/scan-complete.mjs (robust on win32).
if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main(process.argv.slice(2));
}
