import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildCloseScanMarker,
  classifyCloseScanScope,
  evaluateChangelogDecision,
  evaluateCloseScanMarker,
  evaluateRepoUpdateLogDecision,
  evaluateRequiredChecks,
  parseRequiredGateCheckName,
  readRequiredGateCheckName,
} from '../scripts/close/lib.mjs';
import {
  checkHookSyntax,
  decideNodeTest,
  parseNameStatus,
  toBashPath,
  validatePolicyFiles,
} from '../scripts/close/scan-complete.mjs';

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
    'repo-update-log',
    'changelog',
    'node-test',
    'actionlint',
    'hook-syntax',
    'policy-validation',
  ]);
});

test('classifyCloseScanScope treats docs-only changes as PR contract plus repo-update-log check', () => {
  const result = classifyCloseScanScope({
    files: ['docs/plans/README.md', '.changelog/unreleased/28-close-scan-local-guard.md'],
    labels: [],
    stack: 'node',
  });

  assert.equal(result.docsOnly, true);
  assert.equal(result.requiresChangelog, false);
  assert.deepEqual(result.requiredChecks.map((check) => check.name), ['pr-contract', 'repo-update-log']);
});

test('evaluateRepoUpdateLogDecision requires fragments for code changes', () => {
  const result = evaluateRepoUpdateLogDecision({
    files: ['scripts/close/lib.mjs'],
    body: '## Docs / Changelog\n\nChangelog fragment added.',
  });

  assert.equal(result.ok, false);
  assert.match(result.failures[0], /repo-update-log/i);

  assert.equal(evaluateRepoUpdateLogDecision({
    files: [
      'scripts/close/lib.mjs',
      'docs/repo-update-log/2026-06-20-111-close-scan.md',
    ],
    body: '## Docs / Changelog\n\nRepo update log fragment added.',
  }).ok, true);
});

test('evaluateRepoUpdateLogDecision permits ledger-only backfills without a second fragment', () => {
  const result = evaluateRepoUpdateLogDecision({
    files: [
      'docs/repo-update-log/2026-06-20-244-coi-extraction.md',
      'docs/repo-update-log/2026-06-20-245-field-extraction.md',
    ],
    body: 'Backfill pointer-only operational ledger fragments.',
  });

  assert.equal(result.ok, true);
});

test('evaluateRepoUpdateLogDecision requires a body note for unprotected doc-only skips', () => {
  assert.equal(evaluateRepoUpdateLogDecision({
    files: ['docs/plans/operator-copy.md'],
    body: 'Repo-update-log not required: doc-only typo fix.',
  }).ok, true);

  const missing = evaluateRepoUpdateLogDecision({
    files: ['docs/plans/operator-copy.md'],
    body: 'Small wording cleanup.',
  });
  assert.equal(missing.ok, false);
  assert.match(missing.failures[0], /doc-only/i);
});

test('evaluateRepoUpdateLogDecision still requires fragments for protected docs', () => {
  const missing = evaluateRepoUpdateLogDecision({
    files: ['AGENTS.md'],
    body: 'Repo-update-log not required: doc-only typo fix.',
  });

  assert.equal(missing.ok, false);
  assert.match(missing.failures[0], /repo-update-log/i);
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

// #142 (archon-setup#302): the guard and policy scan must honor the gate the
// repo actually declares in .agent/check-map.yml instead of assuming the
// repo-template default — a consumer whose gate is `ci-success` was unsatisfiable.
test('parseRequiredGateCheckName reads the declared gate out of a check-map body', () => {
  assert.equal(parseRequiredGateCheckName([
    'version: 1',
    '',
    'required_gate:',
    '  check_name: repo-required-gate / decision',
    '  workflow: .github/workflows/repo-required-gate.yml',
    '',
    'defaults:',
    '  stack: minimal',
  ].join('\n')), 'repo-required-gate / decision');

  assert.equal(parseRequiredGateCheckName([
    'version: 1',
    'required_gate:',
    '  check_name: ci-success',
    '  workflow: .github/workflows/node-ci.yml',
  ].join('\n')), 'ci-success');

  assert.equal(parseRequiredGateCheckName([
    'required_gate:',
    '  check_name: "quoted / gate"',
  ].join('\n')), 'quoted / gate');

  // CRLF bodies must parse the same way (Windows checkouts).
  assert.equal(parseRequiredGateCheckName('version: 1\r\nrequired_gate:\r\n  check_name: ci-success\r\n'), 'ci-success');

  // Unquoted trailing YAML comments must not leak into the gate name the
  // guard then looks for (#142 review).
  assert.equal(
    parseRequiredGateCheckName('required_gate:\n  check_name: ci-success # aggregate gate\n'),
    'ci-success'
  );
  assert.equal(
    parseRequiredGateCheckName('required_gate:\n  check_name: "repo-required-gate / decision" # the gate\n'),
    'repo-required-gate / decision'
  );
  // A '#' with no preceding whitespace is part of the value, not a comment.
  assert.equal(parseRequiredGateCheckName('required_gate:\n  check_name: gate#1\n'), 'gate#1');
});

test('parseRequiredGateCheckName returns null when the gate is not declared', () => {
  assert.equal(parseRequiredGateCheckName('version: 1\ndefaults:\n  stack: node\n'), null);
  assert.equal(parseRequiredGateCheckName('required_gate:\n  workflow: .github/workflows/x.yml\n'), null);
  assert.equal(parseRequiredGateCheckName('required_gate:\n  check_name: ""\n'), null);
  // check_name under a DIFFERENT block must not count as the required gate.
  assert.equal(parseRequiredGateCheckName('other_block:\n  check_name: not-the-gate\n'), null);
  assert.equal(parseRequiredGateCheckName(''), null);
  assert.equal(parseRequiredGateCheckName(null), null);
});

test('readRequiredGateCheckName reads .agent/check-map.yml from a repo root, null when absent', () => {
  const root = mkdtempSync(join(tmpdir(), 'close-gate-checkmap-'));
  try {
    assert.equal(readRequiredGateCheckName(root), null);
    mkdirSync(join(root, '.agent'), { recursive: true });
    writeFileSync(join(root, '.agent', 'check-map.yml'), 'version: 1\nrequired_gate:\n  check_name: ci-success\n');
    assert.equal(readRequiredGateCheckName(root), 'ci-success');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('validatePolicyFiles accepts any declared gate name and rejects a missing one (#142)', () => {
  const root = mkdtempSync(join(tmpdir(), 'close-gate-policy-'));
  try {
    mkdirSync(join(root, '.agent'), { recursive: true });

    // A custom gate (archon-setup's ci-success) must pass, not just the default.
    writeFileSync(join(root, '.agent', 'check-map.yml'), 'version: 1\nrequired_gate:\n  check_name: ci-success\n');
    assert.equal(validatePolicyFiles(root).ok, true);

    // The repo-template default still passes.
    writeFileSync(
      join(root, '.agent', 'check-map.yml'),
      'version: 1\nrequired_gate:\n  check_name: repo-required-gate / decision\n'
    );
    assert.equal(validatePolicyFiles(root).ok, true);

    // Declaring the block without a name still fails.
    writeFileSync(join(root, '.agent', 'check-map.yml'), 'version: 1\nrequired_gate:\n  workflow: x.yml\n');
    const missingName = validatePolicyFiles(root);
    assert.equal(missingName.ok, false);
    assert.match(missingName.summary, /check name/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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

test('parseNameStatus collects both sides of renames and includes deletions', () => {
  // `git diff --name-status -M` output: tab-separated <status>\t<path>, with a
  // third column for renames/copies. parseNameStatus must surface deletions (D)
  // and BOTH the old and new path of a rename so scope derivation sees the
  // source side (repo-template#84).
  const raw = [
    'M\tdocs/keep.md',
    'D\tscripts/close/foo.mjs',
    'R100\tscripts/close/torename.mjs\tdocs/renamed.md',
  ].join('\n');

  const paths = parseNameStatus(raw);
  assert.deepEqual(paths, [
    'docs/keep.md',
    'scripts/close/foo.mjs',
    'scripts/close/torename.mjs',
    'docs/renamed.md',
  ]);
});

test('deletion-only diff of a code file classifies into the wider (non-docs) scope', () => {
  // Regression for repo-template#84 finding 1: a diff that only deletes a code
  // file must not classify as docs-only. The old `--diff-filter=ACMRT` dropped
  // D entries, so a deletion-only diff under-ran the guard (no node-test).
  const raw = 'D\tscripts/close/foo.mjs';
  const files = parseNameStatus(raw);
  assert.deepEqual(files, ['scripts/close/foo.mjs']);

  const scope = classifyCloseScanScope({ files, labels: [], stack: 'node' });
  assert.equal(scope.docsOnly, false);
  assert.equal(scope.requiresChangelog, true);
  assert.ok(
    scope.requiredChecks.some((check) => check.name === 'node-test'),
    'a deleted code file must still require node-test',
  );
});

test('checkHookSyntax catches a syntax error in the SECOND hook file, not just the first', () => {
  // Regression for repo-template#84 finding 2: `bash -n a b c` only parses `a`
  // and treats `b`/`c` as positional args, so the original single invocation
  // silently skipped every hook past the first. checkHookSyntax must run
  // `bash -n` per file and catch the broken Nth file while still checking all.
  const dir = mkdtempSync(join(tmpdir(), 'close-scan-hooks-'));
  try {
    const first = join(dir, 'pre-commit');
    const second = join(dir, 'commit-msg');
    const third = join(dir, 'post-merge');
    writeFileSync(first, '#!/usr/bin/env bash\necho ok\n');
    // Unterminated `if` => `unexpected end of file` under `bash -n`.
    writeFileSync(second, '#!/usr/bin/env bash\nif [ -z "$x" ; then echo broken\n');
    writeFileSync(third, '#!/usr/bin/env bash\necho also ok\n');

    const result = checkHookSyntax([first, second, third]);
    assert.equal(result.ok, false);
    // Proves the second (not first/last) file is covered.
    assert.match(result.summary, /commit-msg/);
    assert.doesNotMatch(result.summary, /pre-commit/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkHookSyntax passes when every hook file is syntactically valid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'close-scan-hooks-ok-'));
  try {
    const first = join(dir, 'pre-commit');
    const second = join(dir, 'commit-msg');
    writeFileSync(first, '#!/usr/bin/env bash\necho ok\n');
    writeFileSync(second, '#!/usr/bin/env bash\necho still ok\n');

    const result = checkHookSyntax([first, second]);
    assert.equal(result.ok, true);
    assert.match(result.summary, /2 git hook shell file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('decideNodeTest distinguishes absent / unparseable / present package.json (archon-setup#286)', () => {
  const throwing = () => { throw new SyntaxError('Unexpected token } in JSON'); };

  // Absent package.json → skip green (matches the gate's `npm run --if-present`).
  assert.deepEqual(decideNodeTest({ exists: false, readPackageJson: throwing }), {
    run: false,
    reason: 'no-package-json',
  });

  // Present but MALFORMED → must RUN npm test so the EJSONPARSE surfaces exactly
  // as the required gate sees it, instead of being masked green-by-skip.
  assert.deepEqual(decideNodeTest({ exists: true, readPackageJson: throwing }), {
    run: true,
    reason: 'unparseable-package-json',
  });

  // Present, no `test` script → skip green (baseline'd repo).
  assert.deepEqual(decideNodeTest({ exists: true, readPackageJson: () => ({ scripts: { build: 'x' } }) }), {
    run: false,
    reason: 'no-test-script',
  });
  assert.deepEqual(decideNodeTest({ exists: true, readPackageJson: () => ({}) }), {
    run: false,
    reason: 'no-test-script',
  });
  // Whitespace-only test script is treated as absent.
  assert.deepEqual(decideNodeTest({ exists: true, readPackageJson: () => ({ scripts: { test: '   ' } }) }), {
    run: false,
    reason: 'no-test-script',
  });

  // Present WITH a real `test` script → run.
  assert.deepEqual(decideNodeTest({ exists: true, readPackageJson: () => ({ scripts: { test: 'node --test' } }) }), {
    run: true,
    reason: 'has-test-script',
  });
});

test('toBashPath passes non-absolute args (e.g. the -n flag) through unchanged', () => {
  // The `-n` flag and other relative/non-drive args must never be path-rewritten,
  // otherwise `bash -n <hook>` would receive a mangled flag (repo-template#104).
  assert.equal(toBashPath('-n'), '-n');
  assert.equal(toBashPath('pre-commit'), 'pre-commit');
  assert.equal(toBashPath('./scripts/x.sh'), './scripts/x.sh');
});

test('toBashPath converts a Windows-absolute path to a POSIX form bash can open', () => {
  // Locks the cygpath-vs-/mnt branch: with cygpath present (Git Bash) the result
  // is `/c/...`; without it (pure WSL / CI Linux) it is `/mnt/c/...`. Either way
  // the output must be a rooted POSIX path with a lowercase drive and no Windows
  // backslashes left in it (repo-template#104).
  const out = toBashPath('C:\\GitHub\\repo-template\\.githooks\\pre-commit');
  assert.match(out, /^\//, 'must be a rooted POSIX path');
  assert.ok(!out.includes('\\'), 'must not contain Windows backslashes');
  assert.ok(!/^[A-Za-z]:/.test(out), 'must not retain the Windows drive prefix');
  assert.match(out, /\/c\//, 'drive must be lowercased and slash-delimited');
  assert.ok(out.endsWith('/.githooks/pre-commit'), 'must preserve the path tail');
});

test('toBashPath yields either the cygpath /c/ form or the /mnt/ fallback', () => {
  // cygpath presence is environment-dependent (Git Bash has it, CI Linux does not),
  // so assert only the two legitimate outputs for the same input (repo-template#104).
  const out = toBashPath('C:\\a\\b');
  assert.ok(out === '/c/a/b' || out === '/mnt/c/a/b', `unexpected conversion: ${out}`);
});
