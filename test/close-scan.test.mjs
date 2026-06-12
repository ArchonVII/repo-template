import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCloseScanMarker,
  classifyCloseScanScope,
  evaluateChangelogDecision,
  evaluateCloseScanMarker,
  evaluateRequiredChecks,
} from '../scripts/close/lib.mjs';

test('classifyCloseScanScope requires local parity checks for code and workflow changes', () => {
  const result = classifyCloseScanScope({
    files: [
      'scripts/close/ci-guard.mjs',
      '.github/workflows/repo-required-gate.yml',
      '.githooks/pre-commit',
      '.agent/check-map.yml',
    ],
    labels: [],
    stack: 'node',
  });

  assert.equal(result.docsOnly, false);
  assert.equal(result.requiresChangelog, true);
  assert.deepEqual(result.requiredChecks.map((check) => check.name), [
    'pr-contract',
    'changelog',
    'node-test',
    'actionlint',
    'hook-syntax',
    'policy-validation',
  ]);
});

test('classifyCloseScanScope treats docs-only changes as PR contract only', () => {
  const result = classifyCloseScanScope({
    files: ['docs/plans/README.md', '.changelog/unreleased/28-close-scan-local-guard.md'],
    labels: [],
    stack: 'node',
  });

  assert.equal(result.docsOnly, true);
  assert.equal(result.requiresChangelog, false);
  assert.deepEqual(result.requiredChecks.map((check) => check.name), ['pr-contract']);
});

test('evaluateChangelogDecision requires an explicit fragment or no-changelog label for non-doc changes', () => {
  assert.equal(evaluateChangelogDecision({
    requiresChangelog: true,
    labels: [],
    changelogDecision: 'fragment .changelog/unreleased/28-close-scan-local-guard.md',
  }).ok, true);

  assert.equal(evaluateChangelogDecision({
    requiresChangelog: true,
    labels: ['no-changelog'],
    changelogDecision: 'no-changelog label applied because this is test-only',
  }).ok, true);

  const missing = evaluateChangelogDecision({
    requiresChangelog: true,
    labels: [],
    changelogDecision: 'none',
  });
  assert.equal(missing.ok, false);
  assert.match(missing.failures[0], /changelog/i);
});

test('evaluateRequiredChecks fails closed when the required gate is unavailable or not green', () => {
  assert.deepEqual(evaluateRequiredChecks({
    checkRuns: [{ name: 'repo-required-gate / decision', status: 'completed', conclusion: 'success' }],
  }), { ok: true, failures: [], matched: { name: 'repo-required-gate / decision', status: 'completed', conclusion: 'success' } });

  assert.equal(evaluateRequiredChecks({
    checkRuns: [{ name: 'repo-required-gate / decision', state: 'SUCCESS', conclusion: 'success' }],
  }).ok, true);

  assert.equal(evaluateRequiredChecks({ checkRuns: [] }).ok, false);
  assert.match(evaluateRequiredChecks({ checkRuns: [] }).failures[0], /unavailable/i);

  const pending = evaluateRequiredChecks({
    checkRuns: [{ name: 'repo-required-gate / decision', status: 'in_progress', conclusion: null }],
  });
  assert.equal(pending.ok, false);
  assert.match(pending.failures[0], /not completed/i);
});

test('buildCloseScanMarker records exact HEAD, decisions, checks, and timestamp', () => {
  const marker = buildCloseScanMarker({
    git: {
      branch: 'agent/codex/28-close-scan-local-guard',
      head: 'abc123',
      upstream: 'origin/agent/codex/28-close-scan-local-guard',
      upstreamHead: 'abc123',
    },
    pr: {
      number: 28,
      url: 'https://github.com/ArchonVII/repo-template/pull/79',
      branch: 'agent/codex/28-close-scan-local-guard',
    },
    scope: { requiredChecks: [{ name: 'pr-contract' }], docsOnly: false },
    decisions: {
      changelog: 'fragment .changelog/unreleased/28-close-scan-local-guard.md',
      findings: 'no findings file used',
      verification: 'npm test passed',
    },
    localChecks: [{ name: 'pr-contract', ok: true, summary: 'passed' }],
    timestamp: '2026-06-12T18:30:00.000Z',
  });

  assert.equal(marker.version, 1);
  assert.equal(marker.git.head, 'abc123');
  assert.equal(marker.decisions.verification, 'npm test passed');
  assert.equal(marker.timestamp, '2026-06-12T18:30:00.000Z');
  assert.deepEqual(marker.localChecks, [{ name: 'pr-contract', ok: true, summary: 'passed' }]);
});

test('evaluateCloseScanMarker accepts only a fresh marker bound to the current final HEAD', () => {
  const marker = buildCloseScanMarker({
    git: {
      branch: 'agent/codex/28-close-scan-local-guard',
      head: 'abc123',
      upstream: 'origin/agent/codex/28-close-scan-local-guard',
      upstreamHead: 'abc123',
    },
    pr: { number: 28, url: 'https://github.com/ArchonVII/repo-template/pull/79', branch: 'agent/codex/28-close-scan-local-guard' },
    scope: { requiredChecks: [{ name: 'pr-contract' }], docsOnly: false },
    decisions: {
      changelog: 'fragment .changelog/unreleased/28-close-scan-local-guard.md',
      findings: 'no findings file used',
      verification: 'npm test passed',
    },
    localChecks: [{ name: 'pr-contract', ok: true, summary: 'passed' }],
    timestamp: '2026-06-12T18:30:00.000Z',
  });

  const current = evaluateCloseScanMarker({
    marker,
    git: { branch: marker.git.branch, head: marker.git.head, upstream: marker.git.upstream, upstreamHead: marker.git.upstreamHead },
    pr: { number: 28, branch: marker.pr.branch },
  });
  assert.equal(current.ok, true);

  const stale = evaluateCloseScanMarker({
    marker,
    git: { branch: marker.git.branch, head: 'def456', upstream: marker.git.upstream, upstreamHead: marker.git.upstreamHead },
    pr: { number: 28, branch: marker.pr.branch },
  });
  assert.equal(stale.ok, false);
  assert.match(stale.failures.join('\n'), /HEAD/i);
});
