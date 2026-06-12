import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

test('startup baseline contract names canonical startup files and legacy plan path', async () => {
  const baseline = JSON.parse(await readFile(join(ROOT, '.agent', 'startup-baseline.json'), 'utf8'));
  assert.equal(baseline.version, '2026-06-12-close-scan-guard');
  for (const path of [
    'AGENTS.md',
    'docs/plans/README.md',
    '.agent/check-map.yml',
    '.agent/coordination/README.md',
    '.github/PULL_REQUEST_TEMPLATE.md',
    '.github/workflows/anomaly-triage.yml',
    'docs/repo-update-log.md',
    'package.json',
    'scripts/agent/lib.mjs',
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
    'docs/agent-process/doc-sweep.md',
  ]) {
    assert.ok(baseline.required.includes(path), `baseline required should include ${path}`);
  }
  for (const path of ['docs/plans/', 'docs/agent-process/', 'scripts/agent/', 'scripts/close/', 'scripts/doc-sweep/']) {
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
  assert.match(body, /scripts\/close\//);
  assert.match(body, /node <path-to-archon-setup>\/bin\/onboard\.mjs <repo> --audit/);
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
