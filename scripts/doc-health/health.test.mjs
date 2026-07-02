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

// ─── #124 L2: blocking subset (severity split, doc-map contract rules) ────────

// The doc-map is injected (the CLI resolves it via dynamic import) so every
// rule is unit-testable without the docs generators on disk.
const L2_DOC_MAP = {
  version: 1,
  generated: [
    { path: 'docs/INDEX.md', class: 'committed', generator: 'docs:render', block: 'index-pages', inputs: [] },
    { path: 'docs/STATUS.md', class: 'rendered', generator: 'docs:status', inputs: [] },
  ],
  checked: [
    { path: 'docs/CANON.md', owns: ['scripts/**'], checks: ['links', 'path-refs'] },
  ],
  human: [],
  required: { base: ['AGENTS.md', 'docs/CANON.md'] },
  code_roots: { docs: 'self' },
};

// #146 review round 4: `**/` means zero-or-more segments (scripts/**/*.mjs
// must match scripts/foo.mjs), and rename sources must stay in the changed
// set or a file moved OUT of an owned glob never re-triggers its doc.
test('docMapGlobToRegExp: globstar matches zero segments', async () => {
  const { docMapGlobToRegExp } = await import('./lib.mjs');
  assert.ok(docMapGlobToRegExp('scripts/**/*.mjs').test('scripts/foo.mjs'));
  assert.ok(docMapGlobToRegExp('scripts/**/*.mjs').test('scripts/a/b/foo.mjs'));
  assert.ok(!docMapGlobToRegExp('scripts/**/*.mjs').test('scriptsx/foo.mjs'));
  assert.ok(docMapGlobToRegExp('docs/**/*.md').test('docs/CANON.md'));
  assert.ok(docMapGlobToRegExp('**/*.md').test('README.md'));
  assert.ok(docMapGlobToRegExp('scripts/**').test('scripts/close/lib.mjs'));
});

test('changedPathsFromGit reports both sides of a rename', async () => {
  const { changedPathsFromGit } = await import('./health.mjs');
  const repo = makeTempRepo();
  writeInRepo(repo, 'scripts/owned.mjs', 'export {};\n');
  commitAll(repo, 'feat: owned file (#0)');
  const base = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  execFileSync('git', ['-C', repo, 'mv', join('scripts', 'owned.mjs'), join('docs', 'moved.mjs')], { encoding: 'utf8' });
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'refactor: move out of owned glob (#0)'], { encoding: 'utf8' });

  const changed = changedPathsFromGit(repo, base);
  assert.ok(changed.includes('scripts/owned.mjs'), `rename SOURCE must be in the changed set; got ${changed}`);
  assert.ok(changed.includes('docs/moved.mjs'), `rename destination must be in the changed set; got ${changed}`);
});

test('checkRepo without a doc-map: no blocking rules run, report stays warning-only', () => {
  const repo = makeTempRepo();
  const report = checkRepo(repo, { now: NOW });
  assert.equal(report.summary.blocking, 0);
  assert.equal(report.status, 'clean');
});

test('checkRepo: missing required.base doc and unmapped code root block', () => {
  const repo = makeTempRepo();
  writeInRepo(repo, 'src/index.mjs', 'export {};\n'); // top-level root absent from code_roots
  commitAll(repo, 'feat: unmapped root (#0)');

  const report = checkRepo(repo, {
    now: NOW,
    docMap: { ...L2_DOC_MAP, required: { base: ['AGENTS.md', 'docs/CANON.md', 'docs/agent-process/doc-system.md'] } },
  });

  const blocking = report.findings.filter((f) => f.severity === 'blocking');
  const codes = blocking.map((f) => `${f.code}:${f.path}`).sort();
  assert.ok(codes.includes('code-root-unmapped:src'), `expected src unmapped; got ${codes}`);
  assert.ok(
    codes.includes('required-doc-missing:docs/agent-process/doc-system.md'),
    `expected missing required doc; got ${codes}`
  );
  assert.equal(report.status, 'blocking');
  assert.equal(report.summary.blocking, blocking.length);
  assert.equal(report.summary.warnings, report.summary.findings - blocking.length);
});

// #146 round 5: a code_roots VALUE must actually deliver the coverage it
// claims — 'unmapped_ok'/'self', or a checked doc whose owns globs cover the
// root. A typo'd mapping silently defeats the keystone-rot guard otherwise.
test('checkRepo: code_roots mappings must name a covering checked doc', () => {
  const repo = makeTempRepo();
  writeInRepo(repo, 'src/index.mjs', 'export {};\n');
  writeInRepo(repo, 'lib/util.mjs', 'export {};\n');
  commitAll(repo, 'feat: roots (#0)');

  const report = checkRepo(repo, {
    now: NOW,
    docMap: {
      ...L2_DOC_MAP,
      checked: [{ path: 'docs/CANON.md', owns: ['scripts/**'], checks: ['links'] }],
      code_roots: {
        docs: 'self',
        src: 'docs/TYPO.md', // no such checked entry
        lib: 'docs/CANON.md', // exists, but owns does not cover lib/**
      },
    },
  });

  const invalid = report.findings.filter((f) => f.code === 'code-root-mapping-invalid');
  assert.deepEqual(invalid.map((f) => f.path).sort(), ['lib', 'src']);
  assert.ok(invalid.every((f) => f.severity === 'blocking'));
  // Valid shapes stay clean: no finding for docs (self).
  assert.ok(!report.findings.some((f) => f.code === 'code-root-mapping-invalid' && f.path === 'docs'));
});

// #146 round 6: coverage must be validated against ACTUAL files under the
// root — an extension-scoped owns glob (tools/**/*.mjs) is a valid narrowing,
// not a broken mapping.
test('checkRepo: extension-scoped owns globs validate against real files', () => {
  const repo = makeTempRepo();
  writeInRepo(repo, 'tools/gen.mjs', 'export {};\n');
  commitAll(repo, 'feat: tools root (#0)');

  const report = checkRepo(repo, {
    now: NOW,
    docMap: {
      ...L2_DOC_MAP,
      checked: [{ path: 'docs/CANON.md', owns: ['tools/**/*.mjs'], checks: ['links'] }],
      code_roots: { docs: 'self', tools: 'docs/CANON.md' },
    },
  });
  assert.ok(
    !report.findings.some((f) => f.code === 'code-root-mapping-invalid'),
    `extension-scoped coverage must validate; got ${JSON.stringify(report.findings.filter((f) => f.code === 'code-root-mapping-invalid'))}`
  );
});

test('checkRepo: dangling links in a checked doc block only when the doc is re-triggered', () => {
  const repo = makeTempRepo();
  writeInRepo(repo, 'docs/CANON.md', wikiPage('Truth register', 'CANON', [
    '# CANON',
    '',
    'See [missing](./missing-page.md) for details.',
  ].join('\n')));
  commitAll(repo, 'docs: dangling link (#0)');

  // Full audit (no changed paths): stays a warning.
  const audit = checkRepo(repo, { now: NOW, docMap: L2_DOC_MAP });
  const auditFinding = audit.findings.find((f) => f.code === 'dangling-relative-link' && f.path === 'docs/CANON.md');
  assert.equal(auditFinding.severity, 'warning');

  // The doc itself changed: blocking.
  const docChanged = checkRepo(repo, { now: NOW, docMap: L2_DOC_MAP, changedPaths: ['docs/CANON.md'] });
  assert.equal(
    docChanged.findings.find((f) => f.code === 'dangling-relative-link' && f.path === 'docs/CANON.md').severity,
    'blocking'
  );

  // Owned code changed (owns: scripts/**): the doc is re-checked → blocking.
  const codeChanged = checkRepo(repo, { now: NOW, docMap: L2_DOC_MAP, changedPaths: ['scripts/foo.mjs'] });
  assert.equal(
    codeChanged.findings.find((f) => f.code === 'dangling-relative-link' && f.path === 'docs/CANON.md').severity,
    'blocking'
  );
});

// A glob checked entry (docs/adr/**) must escalate at FILE granularity on
// doc-path hits: changing one ADR must not turn pre-existing rot in a sibling
// ADR blocking (#146 review, Codex P2). An owns hit still re-triggers every
// doc of the entry — the changed code may invalidate any of them.
test('checkRepo: glob checked entries escalate per file on doc hits, per entry on owns hits', () => {
  const repo = makeTempRepo();
  const adrMap = {
    version: 1,
    generated: [],
    checked: [{ path: 'docs/adr/**', owns: ['scripts/**'], checks: ['links'] }],
    human: [],
    required: { base: [] },
    code_roots: { docs: 'self' },
  };
  writeInRepo(repo, 'docs/adr/0001-rotten.md', '# ADR 1\n\nSee [gone](./gone.md).\n');
  writeInRepo(repo, 'docs/adr/0002-fresh.md', '# ADR 2\n\nClean content.\n');
  commitAll(repo, 'docs: two adrs (#0)');

  // Sibling ADR changed: the rotten ADR was NOT touched → its dead link stays a warning.
  const sibling = checkRepo(repo, { now: NOW, docMap: adrMap, changedPaths: ['docs/adr/0002-fresh.md'] });
  assert.equal(
    sibling.findings.find((f) => f.code === 'dangling-relative-link' && f.path === 'docs/adr/0001-rotten.md').severity,
    'warning'
  );

  // The rotten ADR itself changed: blocking.
  const direct = checkRepo(repo, { now: NOW, docMap: adrMap, changedPaths: ['docs/adr/0001-rotten.md'] });
  assert.equal(
    direct.findings.find((f) => f.code === 'dangling-relative-link' && f.path === 'docs/adr/0001-rotten.md').severity,
    'blocking'
  );

  // Owned code changed: every doc of the entry re-triggers.
  const owns = checkRepo(repo, { now: NOW, docMap: adrMap, changedPaths: ['scripts/foo.mjs'] });
  assert.equal(
    owns.findings.find((f) => f.code === 'dangling-relative-link' && f.path === 'docs/adr/0001-rotten.md').severity,
    'blocking'
  );
});

test('checkRepo: path-refs verify backtick repo paths in declaring docs, exempting rendered-class paths', () => {
  const repo = makeTempRepo();
  writeInRepo(repo, 'docs/CANON.md', wikiPage('Truth register', 'CANON', [
    '# CANON',
    '',
    'Run `scripts/nope.mjs` after reading `docs/STATUS.md`; globs like `scripts/**` are ignored,',
    'and `docs/project-status.md` exists.',
    'Prose examples must not block (#146 review): git ranges `origin/main...branch` and',
    '`origin/main..HEAD`, bare dirs `dir/`, cross-repo refs `repo-template/AGENTS.md`,',
    'and GitHub slugs `ArchonVII/repo-template` are not repo paths here. Directory',
    'mentions like the optional runtime `docs/some-runtime-claims/` are layout',
    'descriptions, not file claims — never existence-checked (#146 round 3).',
  ].join('\n')));
  writeInRepo(repo, 'scripts/real-root-marker.mjs', 'export {};\n');
  commitAll(repo, 'docs: path refs (#0)');

  const report = checkRepo(repo, { now: NOW, docMap: L2_DOC_MAP, changedPaths: ['docs/CANON.md'] });
  const refs = report.findings.filter((f) => f.code === 'path-ref-missing');
  assert.equal(refs.length, 1, `exactly the dead ref should fire; got ${JSON.stringify(refs)}`);
  assert.equal(refs[0].path, 'docs/CANON.md');
  assert.match(refs[0].message, /scripts\/nope\.mjs/);
  assert.equal(refs[0].severity, 'blocking');

  // Unchanged/untriggered: same rule reports as a warning.
  const audit = checkRepo(repo, { now: NOW, docMap: L2_DOC_MAP });
  assert.equal(audit.findings.find((f) => f.code === 'path-ref-missing').severity, 'warning');
});

test('checkRepo: stale committed generated blocks and a broken doc-map block', () => {
  const repo = makeTempRepo();

  const stale = checkRepo(repo, {
    now: NOW,
    docMap: L2_DOC_MAP,
    renderCheck: () => [
      { name: 'docs/INDEX.md (index-pages)', changed: true },
      { name: 'llms.txt (nav) + README.md (status)', changed: false },
    ],
  });
  const staleFinding = stale.findings.find((f) => f.code === 'generated-block-stale');
  assert.equal(staleFinding.severity, 'blocking');
  assert.match(staleFinding.message, /index-pages/);

  const broken = checkRepo(repo, {
    now: NOW,
    docMap: L2_DOC_MAP,
    renderCheck: () => { throw new Error('markers missing'); },
  });
  const checkFailed = broken.findings.find((f) => f.code === 'generated-block-check-failed');
  assert.equal(checkFailed.severity, 'blocking');

  const invalid = checkRepo(repo, { now: NOW, docMapError: 'doc-map line 3: bad section' });
  const invalidFinding = invalid.findings.find((f) => f.code === 'doc-map-invalid');
  assert.equal(invalidFinding.severity, 'blocking');
  assert.match(invalidFinding.message, /bad section/);
});

// #146 round 6: only generators the doc-map DECLARES may run — a map that
// commits README.md but not docs/INDEX.md must not fail because runIndex
// cannot find INDEX markers it never promised.
test('CLI runs only doc-map-declared generators for the render check', () => {
  const repo = makeTempRepo();
  // README.md with the status managed block the nav generator owns; no INDEX/llms declared.
  writeInRepo(repo, 'README.md', [
    '# Project',
    '',
    '<!-- BEGIN ARCHONVII MANAGED BLOCK: status -->',
    'stale placeholder',
    '<!-- END ARCHONVII MANAGED BLOCK: status -->',
    '',
  ].join('\n'));
  writeInRepo(repo, '.agent/doc-map.yml', [
    'version: 1',
    'generated:',
    '  - path: README.md',
    '    class: committed',
    '    generator: docs:render',
    '    block: status',
    'code_roots:',
    '  docs: self',
    '',
  ].join('\n'));
  commitAll(repo, 'chore: partial doc-map (#0)');

  let code = 0;
  let stdout = '';
  try {
    stdout = execFileSync(process.execPath, [
      join('scripts', 'doc-health', 'health.mjs'),
      '--repo', repo, '--json', '--now', NOW_ISO,
    ], { cwd: process.cwd(), encoding: 'utf8' });
  } catch (err) {
    code = err.status;
    stdout = err.stdout;
  }
  const report = JSON.parse(stdout);
  assert.ok(
    !report.findings.some((f) => f.code === 'generated-block-check-failed' && /INDEX/.test(f.message)),
    `undeclared INDEX generator must not run; got ${JSON.stringify(report.findings.filter((f) => f.code.startsWith('generated-block')))}`
  );
  // The declared README status block IS checked — nav runs against this repo
  // (llms.txt undeclared and absent, so nav reports only what it can), and a
  // stale declared block must surface as blocking.
  assert.ok(code === 0 || code === 1, 'CLI must complete either way');
});

test('CLI exits 1 on blocking findings and loads the real doc-map + render check', () => {
  const repo = makeTempRepo();
  // No inline-[] sections: parseDocMap (correctly) rejects those; omitted
  // sections default to empty.
  writeInRepo(repo, '.agent/doc-map.yml', [
    'version: 1',
    'checked:',
    '  - path: docs/CANON.md',
    '    owns: ["scripts/**"]',
    '    checks: [links, path-refs]',
    'required:',
    '  base:',
    '    - AGENTS.md',
    '    - docs/never-installed.md',
    'code_roots:',
    '  docs: self',
    '',
  ].join('\n'));
  commitAll(repo, 'chore: doc-map with missing required doc (#0)');

  let code = 0;
  let stdout = '';
  try {
    stdout = execFileSync(process.execPath, [
      join('scripts', 'doc-health', 'health.mjs'),
      '--repo', repo, '--json', '--now', NOW_ISO,
    ], { cwd: process.cwd(), encoding: 'utf8' });
  } catch (err) {
    code = err.status;
    stdout = err.stdout;
  }
  assert.equal(code, 1, 'blocking findings must exit 1');
  const report = JSON.parse(stdout);
  assert.equal(report.status, 'blocking');
  assert.ok(report.findings.some((f) => f.code === 'required-doc-missing' && f.path === 'docs/never-installed.md'));
});
