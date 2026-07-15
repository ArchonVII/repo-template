import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDocMap } from '../scripts/docs/lib.mjs';
import {
  generateStartupBaseline,
  readCapabilitySnapshot,
  runStartupBaseline,
} from '../scripts/docs/startup-baseline.mjs';

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

test('startup baseline is generated from doc-map required.base plus the pinned capability projection', async () => {
  const baseline = JSON.parse(await readFile(join(ROOT, '.agent', 'startup-baseline.json'), 'utf8'));
  const docMap = readDocMap(ROOT);
  const capabilities = await readCapabilitySnapshot(ROOT);
  const generated = generateStartupBaseline({ docMap, capabilities });

  assert.deepEqual(baseline, generated);
  assert.match(capabilities.source.commit, /^[0-9a-f]{40}$/);
  assert.equal(capabilities.source.repository, 'ArchonVII/archon-setup');
  assert.equal(capabilities.source.featuresPath, 'src/registry/features.json');
  assert.equal(capabilities.source.profilesPath, 'src/registry/profiles.json');
  assert.equal(capabilities.effectiveProfile, 'agent-standard');

  const selected = new Set(capabilities.profile.features);
  const capabilityFloor = capabilities.features
    .filter((feature) => selected.has(feature.id))
    .flatMap((feature) => feature.installs)
    .filter((install) => install.contract === 'required')
    .map((install) => install.path);
  const expectedRequired = [...new Set([...docMap.required.base, ...capabilityFloor])].sort();
  assert.deepEqual(generated.required, expectedRequired);
  assert.deepEqual(generated.legacy, ['docs/superpowers/plans/']);
});

test('startup baseline generator recreates a missing output while check mode stays read-only', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'repo-template-baseline-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.agent'), { recursive: true });
  await copyFile(join(ROOT, '.agent', 'doc-map.yml'), join(root, '.agent', 'doc-map.yml'));
  await copyFile(
    join(ROOT, '.agent', 'archon-capabilities.json'),
    join(root, '.agent', 'archon-capabilities.json'),
  );

  assert.deepEqual(runStartupBaseline({ root, check: true }), { changed: true });
  assert.deepEqual(runStartupBaseline({ root }), { changed: true });
  const written = JSON.parse(await readFile(join(root, '.agent', 'startup-baseline.json'), 'utf8'));
  assert.deepEqual(
    written,
    generateStartupBaseline({
      docMap: readDocMap(root),
      capabilities: readCapabilitySnapshot(root),
    }),
  );
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

test('AGENTS stays within the document-policy line budget', async () => {
  const body = await readFile(join(ROOT, 'AGENTS.md'), 'utf8');
  const lineCount = body.split(/\r?\n/).length;
  assert.ok(lineCount <= 300, `AGENTS.md should be <=300 lines; got ${lineCount}`);
});

test('VISION template satisfies the owner-intent charter', async () => {
  const body = await readFile(join(ROOT, 'VISION.md'), 'utf8');
  const lineCount = body.split(/\r?\n/).length;
  assert.ok(lineCount <= 120, `VISION.md should be <=120 lines; got ${lineCount}`);
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
