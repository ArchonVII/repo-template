import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  applyGeneratedFile,
  parseDocMap,
  readDocMap,
  renderManagedBlock,
} from '../scripts/docs/lib.mjs';
import { collectIndexDocs, displayStatus, renderIndexBlock, runIndex } from '../scripts/docs/index.mjs';
import { renderNavBlock, renderReadmeStatusBlock } from '../scripts/docs/nav.mjs';
import { buildStatusModel, renderStatusMarkdown } from '../scripts/docs/status.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

function tempRoot(prefix = 'docs-system-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

// The committed spine is the parser's primary fixture: if the real file and the
// parser ever disagree, S1 must fail loudly, not silently drop sections (#124).
test('parseDocMap parses the committed .agent/doc-map.yml spine', () => {
  const map = parseDocMap(readFileSync(join(REPO_ROOT, '.agent', 'doc-map.yml'), 'utf8'));

  assert.equal(map.version, 1);

  const index = map.generated.find((d) => d.path === 'docs/INDEX.md');
  assert.equal(index.class, 'committed');
  assert.equal(index.generator, 'docs:render');
  assert.equal(index.block, 'index-pages');
  assert.deepEqual(index.inputs, ['docs/**/*.md']);

  const status = map.generated.find((d) => d.path === 'docs/STATUS.md');
  assert.equal(status.class, 'rendered');
  assert.equal(status.generator, 'docs:status');

  const canon = map.checked.find((d) => d.path === 'docs/CANON.md');
  assert.deepEqual(canon.owns, ['scripts/**', 'schemas/**', 'docs/adr/**']);
  assert.ok(canon.checks.includes('links'));

  const vision = map.human.find((d) => d.path === 'VISION.md');
  assert.deepEqual(vision.heal_when, []);

  assert.ok(map.required.base.includes('AGENTS.md'));
  assert.ok(map.required.base.includes('.agent/doc-map.yml'));

  assert.equal(map.code_roots.scripts, 'docs/CANON.md');
  assert.equal(map.code_roots.test, 'unmapped_ok');
  assert.equal(map.code_roots.docs, 'self');
});

test('parseDocMap strips trailing comments and quotes, fails closed on unknown structure', () => {
  const map = parseDocMap([
    'version: 1',
    'generated:',
    '  - path: docs/INDEX.md   # trailing comment',
    '    class: committed',
    '    generator: docs:render',
    '    block: index-pages',
    '    inputs: ["docs/**/*.md", \'llms.txt\']',
    'required:',
    '  base:',
    '    - AGENTS.md',
    'code_roots:',
    '  scripts: docs/CANON.md',
  ].join('\n'));
  assert.equal(map.generated[0].path, 'docs/INDEX.md');
  assert.deepEqual(map.generated[0].inputs, ['docs/**/*.md', 'llms.txt']);
  assert.deepEqual(map.required.base, ['AGENTS.md']);

  // Unknown top-level section: refuse rather than silently ignore — the gate
  // and onboarding derive behavior from this file (#124).
  assert.throws(() => parseDocMap('version: 1\nmystery:\n  - path: x\n'), /line 2/i);
  // A list entry outside any section is malformed.
  assert.throws(() => parseDocMap('- path: x\n'), /line 1/i);
});

test('readDocMap reads the map from a repo root', () => {
  const root = tempRoot();
  try {
    mkdirSync(join(root, '.agent'), { recursive: true });
    writeFileSync(join(root, '.agent', 'doc-map.yml'), 'version: 1\nrequired:\n  base:\n    - AGENTS.md\n');
    assert.deepEqual(readDocMap(root).required.base, ['AGENTS.md']);
    assert.throws(() => readDocMap(join(root, 'nope')), /doc-map/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('renderManagedBlock replaces only the marked region and is idempotent', () => {
  const before = [
    'hand prose above',
    '<!-- BEGIN ARCHONVII MANAGED BLOCK: nav -->',
    'stale',
    '<!-- END ARCHONVII MANAGED BLOCK: nav -->',
    'hand prose below',
  ].join('\n');
  const once = renderManagedBlock(before, 'nav', 'fresh line 1\nfresh line 2');
  assert.ok(once.includes('fresh line 1\nfresh line 2'));
  assert.ok(!once.includes('stale'));
  assert.ok(once.startsWith('hand prose above'));
  assert.ok(once.endsWith('hand prose below'));
  assert.equal(renderManagedBlock(once, 'nav', 'fresh line 1\nfresh line 2'), once);
});

test('renderManagedBlock throws when markers are missing (never appends silently)', () => {
  assert.throws(() => renderManagedBlock('no markers here', 'nav', 'body'), /nav/);
  const onlyBegin = '<!-- BEGIN ARCHONVII MANAGED BLOCK: nav -->\nx';
  assert.throws(() => renderManagedBlock(onlyBegin, 'nav', 'body'), /END/);
});

test('collectIndexDocs walks docs/, skipping raw intake, fragment ledger, and INDEX itself', () => {
  const root = tempRoot();
  try {
    mkdirSync(join(root, 'docs', 'adr'), { recursive: true });
    mkdirSync(join(root, 'docs', 'raw'), { recursive: true });
    mkdirSync(join(root, 'docs', 'repo-update-log'), { recursive: true });
    writeFileSync(join(root, 'docs', 'INDEX.md'), '# index\n');
    writeFileSync(
      join(root, 'docs', 'CANON.md'),
      '---\nsummary: Ground truth.\nstatus: CANON\n---\n# CANON\n'
    );
    writeFileSync(join(root, 'docs', 'adr', '0001-thing.md'), '---\nsummary: An ADR.\nstatus: CURRENT\n---\n');
    writeFileSync(join(root, 'docs', 'adr', 'no-frontmatter.md'), '# bare\n');
    writeFileSync(join(root, 'docs', 'raw', 'intake.md'), 'raw import\n');
    writeFileSync(join(root, 'docs', 'repo-update-log', '2026-01-01-x.md'), 'fragment\n');

    const docs = collectIndexDocs(root);
    const rels = docs.map((d) => d.rel);
    assert.deepEqual(rels, ['docs/CANON.md', 'docs/adr/0001-thing.md', 'docs/adr/no-frontmatter.md']);
    assert.equal(docs[0].summary, 'Ground truth.');
    assert.equal(docs[0].status, 'CANON');
    assert.equal(docs[2].summary, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Rendered-class docs (doc-map) are never committed, so indexing one links a
// file absent at HEAD — and a local `docs:status` run would leave the
// `docs:render --check` drift gate failing (#144 self-review).
test('runIndex excludes rendered-class docs declared in the doc-map', () => {
  const root = tempRoot();
  try {
    mkdirSync(join(root, '.agent'), { recursive: true });
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(
      join(root, '.agent', 'doc-map.yml'),
      ['version: 1', 'generated:', '  - path: docs/STATUS.md', '    class: rendered', '    generator: docs:status', ''].join('\n')
    );
    writeFileSync(join(root, 'docs', 'STATUS.md'), '# status dashboard\n');
    writeFileSync(join(root, 'docs', 'real-page.md'), '---\nsummary: Durable.\n---\n# real\n');
    writeFileSync(
      join(root, 'docs', 'INDEX.md'),
      '# index\n\n<!-- BEGIN ARCHONVII MANAGED BLOCK: index-pages -->\nstale\n<!-- END ARCHONVII MANAGED BLOCK: index-pages -->\n'
    );

    runIndex({ root });
    const index = readFileSync(join(root, 'docs', 'INDEX.md'), 'utf8');
    assert.ok(index.includes('real-page.md'));
    assert.ok(!index.includes('STATUS.md'), 'rendered-class docs must not enter the committed index');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('renderIndexBlock groups by directory, sorts deterministically, carries summaries', () => {
  const block = renderIndexBlock([
    { rel: 'docs/CANON.md', summary: 'Ground truth.', status: 'CANON' },
    { rel: 'docs/adr/0002-b.md', summary: 'Second.', status: 'CURRENT' },
    { rel: 'docs/adr/0001-a.md', summary: null, status: null },
  ]);
  const lines = block.split('\n');
  const canonLine = lines.findIndex((l) => l.includes('[CANON.md](CANON.md)'));
  const adrHeading = lines.findIndex((l) => l === '### adr/');
  assert.ok(canonLine >= 0, 'root-level docs listed');
  assert.ok(adrHeading > canonLine, 'root docs before subdirectory groups');
  assert.ok(block.indexOf('0001-a.md') < block.indexOf('0002-b.md'), 'entries sorted within group');
  assert.ok(block.includes('— Ground truth. `CANON`'));
  assert.ok(block.includes('- [0001-a.md](adr/0001-a.md)'));
  // Deterministic: no timestamps in committed-class output.
  assert.doesNotMatch(block, /\b20\d\d-\d\d-\d\d\b/);
});

test('displayStatus strips frontmatter comment tails and caps run-on statuses', () => {
  assert.equal(displayStatus('CANON'), 'CANON');
  assert.equal(displayStatus('intake          # intake | active | paused'), 'intake');
  const long = displayStatus('Design approved with amendments (2026-06-02); hardened after an adversarial pass');
  assert.ok(long.length <= 48);
  assert.ok(long.endsWith('…'));
  assert.equal(displayStatus(null), null);
});

test('renderNavBlock and renderReadmeStatusBlock are deterministic doc-map projections', () => {
  const map = parseDocMap(readFileSync(join(REPO_ROOT, '.agent', 'doc-map.yml'), 'utf8'));
  const nav = renderNavBlock(map, 'High-density register of repo truth.');
  assert.ok(nav.includes('.agent/doc-map.yml'));
  assert.ok(nav.includes('docs/INDEX.md'));
  assert.ok(nav.includes('committed'));
  assert.ok(nav.includes('rendered'));
  assert.doesNotMatch(nav, /\b20\d\d-\d\d-\d\d\b/, 'committed-class output must carry no dates');

  const status = renderReadmeStatusBlock(map);
  assert.ok(status.includes('docs:render'));
  assert.ok(status.includes('docs:status'));
  assert.ok(status.includes(String(map.generated.filter((d) => d.class === 'committed').length)));
  assert.doesNotMatch(status, /\b20\d\d-\d\d-\d\d\b/, 'committed-class output must carry no dates');
});

test('applyGeneratedFile check mode reports drift without writing; write mode writes', () => {
  const root = tempRoot();
  try {
    const target = join(root, 'INDEX.md');
    const stale = '<!-- BEGIN ARCHONVII MANAGED BLOCK: x -->\nold\n<!-- END ARCHONVII MANAGED BLOCK: x -->';
    writeFileSync(target, stale);

    const checked = applyGeneratedFile({ path: target, blockId: 'x', body: 'new', check: true });
    assert.equal(checked.changed, true);
    assert.equal(readFileSync(target, 'utf8'), stale, 'check mode must not write');

    const written = applyGeneratedFile({ path: target, blockId: 'x', body: 'new', check: false });
    assert.equal(written.changed, true);
    assert.ok(readFileSync(target, 'utf8').includes('\nnew\n'));

    const clean = applyGeneratedFile({ path: target, blockId: 'x', body: 'new', check: true });
    assert.equal(clean.changed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('status model summarizes volatile inputs and renders with an injected timestamp', () => {
  const model = buildStatusModel({
    prs: [
      { number: 143, title: 'fix(close): honor check-map', isDraft: false, url: 'https://x/143' },
      { number: 999, title: 'draft thing', isDraft: true, url: 'https://x/999' },
    ],
    issues: [{ number: 124, title: 'Epic: docs system', labels: [{ name: 'epic' }], url: 'https://x/124' }],
    // doc-health.v1 report shape — what scripts/doc-health/health.mjs --json
    // actually emits (findings, not warnings/errors arrays; #144 review).
    docHealth: {
      schemaVersion: 'doc-health.v1',
      summary: { findings: 2, warnings: 1, blocking: 1 },
      findings: [
        {
          severity: 'warning',
          code: 'charter-overbudget',
          path: 'README.md',
          line: 1,
          message: 'README.md has 161 lines; charter budget is 150.',
        },
        { severity: 'blocking', code: 'doc-health-run', path: 'scripts/doc-health/health.mjs', message: 'boom' },
      ],
    },
    now: '2026-07-02T00:00:00.000Z',
  });
  assert.equal(model.openPrs.length, 2);
  assert.equal(model.draftPrCount, 1);
  assert.equal(model.openIssues.length, 1);
  assert.equal(model.docWarningCount, 1);
  assert.equal(model.docErrorCount, 1);

  const md = renderStatusMarkdown(model);
  assert.ok(md.includes('2026-07-02T00:00:00.000Z'));
  assert.ok(md.includes('#143'));
  assert.ok(md.includes('rendered, not committed'), 'dashboard must declare its class');
  assert.ok(md.includes('charter-overbudget'));
  assert.ok(md.includes('README.md:1'));
  assert.ok(md.includes('1 blocking, 1 warning'));
});

// The live producer is the fixture (#124 spine principle): if health.mjs and
// the status consumer ever disagree on shape, this fails loudly instead of the
// dashboard silently rendering "0 warnings" (#144 review).
test('status model must not drop findings from the live doc-health producer', () => {
  let raw;
  try {
    raw = execFileSync(
      process.execPath,
      [join(REPO_ROOT, 'scripts', 'doc-health', 'health.mjs'), '--repo', REPO_ROOT, '--json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (err) {
    raw = err.stdout; // health.mjs exits non-zero on blocking findings but still prints its report
  }
  const report = JSON.parse(raw);
  const model = buildStatusModel({ prs: [], issues: [], docHealth: report, now: 'x' });
  assert.equal(model.docWarningCount, report.summary.warnings);
  assert.equal(model.docWarningCount + model.docErrorCount, report.summary.findings);
});

test('status render surfaces gh snapshot failures instead of reporting zero open work', () => {
  const model = buildStatusModel({
    prs: [],
    issues: [],
    prsError: 'gh: To get started with GitHub CLI, please run: gh auth login',
    issuesError: 'gh: To get started with GitHub CLI, please run: gh auth login',
    docHealth: { findings: [] },
    now: 'x',
  });
  const md = renderStatusMarkdown(model);
  assert.ok(md.includes('unavailable'), 'failed snapshots must say so');
  assert.ok(md.includes('gh auth login'), 'the gh error must reach the reader');
  assert.ok(!md.includes('Open PRs (0'), 'a failed snapshot must not read as zero open PRs');
  assert.ok(!md.includes('Open issues (0'), 'a failed snapshot must not read as zero open issues');
});
