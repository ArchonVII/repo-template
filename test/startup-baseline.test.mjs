import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

test('startup baseline contract names canonical startup files and legacy plan path', async () => {
  const baseline = JSON.parse(await readFile(join(ROOT, '.agent', 'startup-baseline.json'), 'utf8'));
  assert.equal(baseline.version, '2026-06-08-agent-start-map');
  for (const path of [
    'AGENTS.md',
    'docs/plans/README.md',
    '.agent/check-map.yml',
    '.agent/coordination/README.md',
    '.github/PULL_REQUEST_TEMPLATE.md',
    'docs/repo-update-log.md',
    'package.json',
    'scripts/agent/lib.mjs',
    'scripts/agent/start-task.mjs',
    'scripts/agent/status.mjs',
    'scripts/agent/prune.mjs',
    'scripts/agent/pr-body.mjs',
    'scripts/doc-sweep/lib.mjs',
    'scripts/doc-sweep/git.mjs',
    'scripts/doc-sweep/sweep.mjs',
    'docs/agent-process/doc-sweep.md',
  ]) {
    assert.ok(baseline.required.includes(path), `baseline required should include ${path}`);
  }
  for (const path of ['docs/plans/', 'docs/agent-process/', 'scripts/agent/', 'scripts/doc-sweep/']) {
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
  assert.match(body, /node <path-to-archon-setup>\/bin\/onboard\.mjs <repo> --audit/);
});
