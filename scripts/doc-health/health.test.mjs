import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { checkRepo } from './health.mjs';

const NOW_ISO = '2026-06-15T12:00:00.000Z';
const NOW = Date.parse(NOW_ISO);

function makeTempRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'doc-health-test-'));
  const g = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test Agent');
  g('config', 'core.autocrlf', 'false');
  writeCleanRepo(repo);
  commitAll(repo, 'chore: clean fixture (#0)');
  return repo;
}

function writeCleanRepo(repo) {
  const files = {
    'AGENTS.md': '# Agents\n\n## Doc Health\n\nSee `docs/agent-process/doc-health.md`.\n',
    'README.md': '# Project\n\nSmall README.\n',
    'CLAUDE.md': '# Claude\n\nRead [`AGENTS.md`](./AGENTS.md) first.\n',
    'GEMINI.md': '# Gemini\n\nRead [`AGENTS.md`](./AGENTS.md) first.\n',
    'docs/INDEX.md': wikiPage('Map', 'CANON', [
      '# INDEX',
      '',
      '- [CANON](CANON.md)',
      '- [project-status](project-status.md)',
    ].join('\n')),
    'docs/CANON.md': wikiPage('Truth register', 'CANON', [
      '# CANON',
      '',
      'Current truth is recorded here.',
    ].join('\n')),
    'docs/project-status.md': wikiPage('Project status', 'CURRENT', [
      '# Project Status',
      '',
      'Active workstreams are summarized here.',
    ].join('\n')),
    'docs/adr/README.md': '# Architecture Decision Records\n\n## Decisions\n\n',
    'docs/agent-process/document-policy.md': policyDoc({
      title: 'Document Policy',
      status: 'active',
      lastReviewed: '2026-06-15',
      supersededBy: 'none',
      body: 'Doc policy rules live here.\n',
    }),
    '.agent/startup-baseline.json': JSON.stringify({
      version: 'test',
      required: [
        'AGENTS.md',
        'README.md',
        'docs/INDEX.md',
        'docs/CANON.md',
        'docs/project-status.md',
        'docs/agent-process/document-policy.md',
      ],
      expectedDirectories: [
        'docs/',
        'docs/agent-process/',
      ],
      legacy: [],
    }, null, 2) + '\n',
  };
  for (const [rel, body] of Object.entries(files)) writeInRepo(repo, rel, body);
}

function wikiPage(summary, status, body) {
  return [
    '---',
    `summary: ${summary}`,
    `status: ${status}`,
    'confidence: EXTRACTED',
    'updated: 2026-06-15',
    'relates: []',
    'depends-on: []',
    'supersedes: []',
    'superseded-by: []',
    'contradicts: []',
    '---',
    '',
    body,
    '',
  ].join('\n');
}

function policyDoc({ title, status, lastReviewed, supersededBy, body }) {
  return [
    `# ${title}`,
    '',
    `> **Status:** ${status}`,
    '> **Owner:** agent',
    '> **Scope:** repo-local',
    '> **Source of truth:** yes',
    `> **Last reviewed:** ${lastReviewed}`,
    '> **Supersedes:** none',
    `> **Superseded by:** ${supersededBy}`,
    '',
    body,
  ].join('\n');
}

function writeInRepo(repo, rel, content) {
  const abs = join(repo, ...rel.split('/'));
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

function commitAll(repo, message) {
  const untracked = execFileSync('git', ['-C', repo, 'ls-files', '--others', '--exclude-standard', '-z'], {
    encoding: 'buffer',
  }).toString('utf8').split('\0').filter(Boolean);
  const modified = execFileSync('git', ['-C', repo, 'diff', '--name-only', '-z'], {
    encoding: 'buffer',
  }).toString('utf8').split('\0').filter(Boolean);
  const paths = [...new Set([...untracked, ...modified])];
  if (paths.length) execFileSync('git', ['-C', repo, 'add', '--', ...paths], { encoding: 'utf8' });
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', message], { encoding: 'utf8' });
}

function setOldMtime(repo, rel, iso) {
  const when = new Date(iso);
  utimesSync(join(repo, ...rel.split('/')), when, when);
}

function findingKeys(report) {
  return report.findings
    .map((f) => `${f.code}:${f.path}`)
    .sort();
}

test('checkRepo: clean repo returns zero findings and zero issue payloads', () => {
  const repo = makeTempRepo();
  const report = checkRepo(repo, { now: NOW });

  assert.equal(report.status, 'clean');
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.issues, []);
});

test('checkRepo: seeded violations produce exact findings for every deterministic check', () => {
  const repo = makeTempRepo();

  writeInRepo(repo, 'README.md', ['# Project', ...Array.from({ length: 151 }, (_, i) => `line ${i}`)].join('\n'));
  writeInRepo(repo, 'CLAUDE.md', ['# Claude', ...Array.from({ length: 26 }, (_, i) => `line ${i}`)].join('\n'));
  writeInRepo(repo, 'docs/agent-process/stale-review.md', policyDoc({
    title: 'Stale Review',
    status: 'active',
    lastReviewed: '2026-01-01',
    supersededBy: 'none',
    body: 'Still active.\n',
  }));
  writeInRepo(repo, 'docs/plans/2026-01-01-live-plan.md', policyDoc({
    title: 'Live Plan',
    status: 'active',
    lastReviewed: '2026-06-15',
    supersededBy: 'none',
    body: 'Still live.\n',
  }));
  setOldMtime(repo, 'docs/plans/2026-01-01-live-plan.md', '2026-04-01T00:00:00.000Z');
  writeInRepo(repo, 'docs/old.md', policyDoc({
    title: 'Old Doc',
    status: 'superseded',
    lastReviewed: '2026-06-15',
    supersededBy: 'none',
    body: 'Historical doc.\n',
  }));
  writeInRepo(repo, 'docs/CANON.md', wikiPage('Truth register', 'CANON', [
    '# CANON',
    '',
    'This points at [missing](missing.md).',
  ].join('\n')));
  writeInRepo(repo, 'docs/agent-process/active-placeholder.md', policyDoc({
    title: 'Active Placeholder',
    status: 'active',
    lastReviewed: '2026-06-15',
    supersededBy: 'none',
    body: 'TODO: replace this active placeholder.\n',
  }));
  writeInRepo(repo, '.agent/startup-baseline.json', JSON.stringify({
    version: 'test',
    required: ['missing-required.md'],
    expectedDirectories: ['missing-dir/'],
    legacy: [],
  }, null, 2) + '\n');
  writeInRepo(repo, 'docs/design.md', wikiPage('Design', 'CURRENT', '# Design\n\nCurrent design.\n'));
  writeInRepo(repo, 'docs/adr/002-new.md', wikiPage('ADR 002', 'CURRENT', '# ADR 002\n\nDecision.\n'));
  writeInRepo(repo, 'docs/INDEX.md', wikiPage('Map', 'CANON', [
    '# INDEX',
    '',
    '- [CANON](CANON.md)',
    '- [project-status](project-status.md)',
    '- [ADR 002](adr/002-new.md)',
    '- [Roadmap](plans/2026-06-13-roadmap.md)',
  ].join('\n')));
  writeInRepo(repo, 'docs/plans/2026-06-13-roadmap.md', wikiPage('Roadmap', 'CURRENT', [
    '# Roadmap',
    '',
    'Issue #170 is next and deployment remains pending.',
  ].join('\n')));

  const report = checkRepo(repo, {
    now: NOW,
    changedPaths: ['docs/CANON.md'],
  });

  assert.equal(report.status, 'warnings');
  assert.deepEqual(findingKeys(report), [
    'active-placeholder-token:docs/agent-process/active-placeholder.md',
    'active-plan-stale:docs/plans/2026-01-01-live-plan.md',
    'adr-index-missing:docs/adr/002-new.md',
    'charter-overbudget:README.md',
    'dangling-relative-link:docs/CANON.md',
    'index-missing-doc:docs/design.md',
    'last-reviewed-stale:docs/agent-process/stale-review.md',
    'stale-active-doc-term:docs/plans/2026-06-13-roadmap.md',
    'startup-baseline-missing-directory:.agent/startup-baseline.json',
    'startup-baseline-missing-path:.agent/startup-baseline.json',
    'superseded-without-pointer:docs/old.md',
    'tool-stub-overbudget:CLAUDE.md',
  ]);
  assert.equal(report.findings.every((f) => f.severity === 'warning'), true);
  assert.equal(report.issues.length, report.findings.length);
});

test('checkRepo: Hudson Bend #216/#218 drift fixture surfaces exactly the three §8.2 warnings', () => {
  const repo = makeTempRepo();
  writeInRepo(repo, 'docs/CANON.md', wikiPage('Truth register', 'CANON', [
    '# CANON',
    '',
    'The backend is not deployed and remaining production smoke is pending.',
  ].join('\n')));
  writeInRepo(repo, 'docs/plans/2026-06-13-coi-cove-roadmap.md', wikiPage('COI Cove roadmap', 'CURRENT', [
    '# COI Cove Roadmap',
    '',
    'Issue #170 is next; tenant call-through is pending.',
  ].join('\n')));
  writeInRepo(repo, 'docs/adr/002-platform-coordination-plane.md', wikiPage('ADR 002', 'CURRENT', [
    '# 002. Platform coordination plane',
    '',
    'Central coordination plane decision.',
  ].join('\n')));
  writeInRepo(repo, 'docs/adr/README.md', [
    '# Architecture Decision Records',
    '',
    '## Decisions',
    '',
    '- [ADR 002](002-platform-coordination-plane.md)',
    '',
  ].join('\n'));
  writeInRepo(repo, 'docs/INDEX.md', wikiPage('Map', 'CANON', [
    '# INDEX',
    '',
    '- [CANON](CANON.md)',
    '- [project-status](project-status.md)',
    '- [Roadmap](plans/2026-06-13-coi-cove-roadmap.md)',
  ].join('\n')));

  const report = checkRepo(repo, {
    now: NOW,
    changedPaths: ['docs/CANON.md'],
  });

  assert.deepEqual(findingKeys(report), [
    'index-missing-doc:docs/adr/002-platform-coordination-plane.md',
    'stale-active-doc-term:docs/CANON.md',
    'stale-active-doc-term:docs/plans/2026-06-13-coi-cove-roadmap.md',
  ]);
});

test('CLI writes only the requested report path and exits zero for warnings', () => {
  const repo = makeTempRepo();
  writeInRepo(repo, 'README.md', ['# Project', ...Array.from({ length: 151 }, (_, i) => `line ${i}`)].join('\n'));
  commitAll(repo, 'docs: seed overbudget readme (#0)');

  const reportPath = join(repo, 'doc-health-report.json');
  const stdout = execFileSync(process.execPath, [
    join('scripts', 'doc-health', 'health.mjs'),
    '--repo', repo,
    '--report', reportPath,
    '--json',
    '--now', NOW_ISO,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  const stdoutReport = JSON.parse(stdout);
  const fileReport = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.equal(stdoutReport.findings.length, 1);
  assert.deepEqual(fileReport.findings, stdoutReport.findings);

  const status = execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' })
    .trim()
    .replace(/\\/g, '/');
  assert.equal(status, '?? doc-health-report.json');
});
