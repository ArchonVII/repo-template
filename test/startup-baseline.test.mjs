import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

test('startup baseline contract names canonical startup files and legacy plan path', async () => {
  const baseline = JSON.parse(await readFile(join(ROOT, '.agent', 'startup-baseline.json'), 'utf8'));
  assert.equal(baseline.version, '2026-07-19-doc-system-runtime');
  for (const path of [
    'AGENTS.md',
    'docs/plans/README.md',
    'docs/agent-process/document-policy.md',
    'docs/agent-process/message-protocol.md',
    'docs/agent-process/doc-health.md',
    'docs/agent-process/doc-system.md',
    '.agent/doc-map.yml',
    'docs/CANON.md',
    'docs/INDEX.md',
    '.agent/check-map.yml',
    '.agent/coordination/README.md',
    '.github/PULL_REQUEST_TEMPLATE.md',
    '.github/workflows/anomaly-triage.yml',
    'package.json',
    'scripts/agent/lib.mjs',
    'scripts/agent/carry.mjs',
    'scripts/agent/start-task.mjs',
    'scripts/agent/status.mjs',
    'scripts/agent/prune.mjs',
    'scripts/agent/pr-body.mjs',
    'scripts/close/lib.mjs',
    'scripts/close/scan-complete.mjs',
    'scripts/close/ci-guard.mjs',
    'scripts/doc-sweep/lib.mjs',
    'scripts/doc-sweep/git.mjs',
    'scripts/doc-sweep/sweep.mjs',
    'scripts/doc-health/lib.mjs',
    'scripts/doc-health/health.mjs',
    'scripts/docs/lib.mjs',
    'scripts/docs/index.mjs',
    'scripts/docs/nav.mjs',
    'scripts/docs/render.mjs',
    'scripts/docs/status.mjs',
    'scripts/docs/changelog.mjs',
    'docs/agent-process/doc-sweep.md',
  ]) {
    assert.ok(baseline.required.includes(path), `baseline required should include ${path}`);
  }
  for (const path of ['docs/plans/', 'docs/agent-process/', 'scripts/agent/', 'scripts/close/', 'scripts/doc-sweep/', 'scripts/doc-health/', 'scripts/docs/']) {
    assert.ok(baseline.expectedDirectories.includes(path), `baseline directories should include ${path}`);
  }
  assert.ok(baseline.legacy.includes('docs/superpowers/plans/'));
});

test('plans README declares the canonical plan location and legacy directory policy', async () => {
  const body = await readFile(join(ROOT, 'docs', 'plans', 'README.md'), 'utf8');
  assert.match(body, /docs\/plans\/YYYY-MM-DD-<slug>\.md/);
  assert.match(body, /docs\/superpowers\/plans\//);
  assert.match(body, /legacy\/history only/i);
});

test('AGENTS exposes the startup map before workflow details', async () => {
  const body = await readFile(join(ROOT, 'AGENTS.md'), 'utf8');
  const startupIndex = body.indexOf('## Agent Start Map');
  const workflowIndex = body.indexOf('## Workflow');
  assert.ok(startupIndex > -1, 'AGENTS.md should include Agent Start Map');
  assert.ok(workflowIndex > -1, 'AGENTS.md should include Workflow');
  assert.ok(startupIndex < workflowIndex, 'Agent Start Map should appear before workflow details');
  assert.match(body, /docs\/plans\//);
  assert.match(body, /docs\/agent-process\/document-policy\.md/);
  assert.match(body, /docs\/agent-process\/doc-health\.md/);
  assert.match(body, /scripts\/doc-health\//);
  assert.match(body, /scripts\/close\//);
  assert.match(body, /node bin\/onboard\.mjs <path-to-this-repo> --audit/);
});

test('AGENTS doc-health contract is report-only and points to the runner', async () => {
  const body = await readFile(join(ROOT, 'AGENTS.md'), 'utf8');
  assert.match(body, /## Doc Health/);
  assert.match(body, /scripts\/doc-health\/health\.mjs/);
  assert.match(body, /report-only/);
  assert.match(body, /never edits docs/);
});

test('VISION template satisfies the owner-intent charter', async () => {
  const body = await readFile(join(ROOT, 'VISION.md'), 'utf8');
  assert.match(body, /^> \*\*Status:\*\* draft$/m);
  assert.match(body, /^> \*\*Owner:\*\* human$/m);
  assert.match(body, /^> \*\*Last reviewed:\*\* YYYY-MM-DD$/m);

  const sections = [
    '## Experience',
    '## North Star',
    '## Scope',
    '### Must-Have',
    '### Nice-To-Have',
    '### Explicitly Not',
    '## Current Horizon',
    '## Drift Tripwires',
  ];
  let previous = -1;
  for (const section of sections) {
    const index = body.indexOf(section);
    assert.ok(index > previous, `${section} should appear in charter order`);
    previous = index;
  }
});

test('decision log template satisfies the append-only owner-intent charter', async () => {
  const body = await readFile(join(ROOT, 'docs', 'decisions', 'decision-log.md'), 'utf8');
  assert.match(body, /^> \*\*Status:\*\* active$/m);
  assert.match(body, /^> \*\*Owner:\*\* human, agent-appended$/m);
  assert.match(body, /Append owner intent decisions below, newest first\./);
  assert.match(body, /^## YYYY-MM-DD - <decision title>$/m);
  assert.match(body, /^- \*\*Decision:\*\* <one line>$/m);
  assert.match(body, /^- \*\*Lane:\*\* <issue\/PR URL>$/m);
  assert.match(body, /^- \*\*Why:\*\* <one line>$/m);
});

test('AGENTS declares vision drift duties and stacked docs review scope', async () => {
  const body = await readFile(join(ROOT, 'AGENTS.md'), 'utf8');
  assert.match(body, /## Vision Drift Duties/);
  assert.match(body, /read `VISION\.md` when present/);
  assert.match(body, /Scope \/ explicitly-not/);
  assert.match(body, /`docs\/decisions\/decision-log\.md`/);
  assert.match(body, /For stacked docs PRs, review `origin\/main\.\.HEAD`, not only the narrow PR diff; guidance only, not a gate\./);
});

test('AGENTS managed start map includes the friction ledger instruction', async () => {
  const body = await readFile(join(ROOT, 'AGENTS.md'), 'utf8');
  const start = body.indexOf('<!-- BEGIN MANAGED AGENT START MAP -->');
  const end = body.indexOf('<!-- END MANAGED AGENT START MAP -->');
  assert.ok(start > -1, 'AGENTS.md should include the managed start-map start marker');
  assert.ok(end > start, 'AGENTS.md should include the managed start-map end marker');

  const managed = body.slice(start, end);
  assert.match(managed, /`\.claude\/friction\.md`/);
  assert.match(managed, /do not fix it mid-task/i);
  assert.match(managed, /keep working/i);
  assert.match(managed, /bugs\/security.*`\.archon\/anomalies-thispr\.md`/i);
  assert.match(managed, /non-bug workflow hiccup/i);
});

test('anomaly triage contract uses the canonical ledger path and installed caller', async () => {
  const agents = await readFile(join(ROOT, 'AGENTS.md'), 'utf8');
  assert.match(agents, /`\.archon\/anomalies-thispr\.md`/);
  assert.match(agents, /`\.github\/workflows\/anomaly-triage\.yml`/);
  assert.doesNotMatch(agents, /workflow input/i);

  const workflow = await readFile(join(ROOT, '.github', 'workflows', 'anomaly-triage.yml'), 'utf8');
  assert.match(workflow, /uses: ArchonVII\/github-workflows\/\.github\/workflows\/anomaly-triage\.yml@v1/);
  assert.match(workflow, /\.archon\/anomalies-thispr\.md/);

  const permissionsStart = workflow.indexOf('permissions:');
  const jobsStart = workflow.indexOf('jobs:');
  assert.ok(permissionsStart > -1, 'caller should declare workflow permissions');
  assert.ok(permissionsStart < jobsStart, 'caller permissions should apply before jobs');
  assert.equal(
    workflow.slice(permissionsStart, jobsStart).replaceAll('\r\n', '\n').trim(),
    ['permissions:', '  contents: read', '  pull-requests: write', '  issues: write'].join('\n'),
  );
});

// #124 S3: the repo-update-log fragment ledger + its caller workflow are
// retired; the caller must be ABSENT (its former presence test is deleted).
test('repo update log fragment caller is retired (#124 S3)', async () => {
  const { existsSync } = await import('node:fs');
  assert.equal(
    existsSync(join(ROOT, '.github', 'workflows', 'repo-update-log-fragment.yml')),
    false,
    'repo-update-log-fragment.yml caller must be removed in S3',
  );
  assert.equal(existsSync(join(ROOT, 'docs', 'repo-update-log')), false, 'docs/repo-update-log/ ledger dir must be removed in S3');
});

test('gitignore keeps archon local state ignored while allowing the anomaly ledger', async () => {
  const body = await readFile(join(ROOT, '.gitignore'), 'utf8');
  assert.match(body, /^\.archon\/\*$/m);
  assert.match(body, /^!\.archon\/anomalies-thispr\.md$/m);
});

test('gitignore keeps claude local state ignored while allowing the friction ledger', async () => {
  const body = await readFile(join(ROOT, '.gitignore'), 'utf8');
  assert.match(body, /^\.claude\/\*$/m);
  assert.match(body, /^!\.claude\/friction\.md$/m);
  assert.doesNotMatch(body, /^\.claude\/$/m);
});

test('friction ledger starts with the exact machine-parseable contract header', async () => {
  const body = await readFile(join(ROOT, '.claude', 'friction.md'), 'utf8');
  const meaningfulLines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('<!--'));

  assert.equal(meaningfulLines[0], '| date | category | what happened | cost | suggested fix |');
  assert.equal(meaningfulLines[1], '|---|---|---|---|---|');
  assert.match(body, /tooling \| docs \| skill \| hook \| ci \| env/);
  assert.match(body, /rerun \| blocked \| context-burn \| none/);
});
