import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  DOD_SECTIONS,
  buildCloseScanMarker,
  classifyCloseScanScope,
  evaluateChangelogDecision,
  evaluateCloseScanMarker,
  evaluateDocsDecision,
  evaluateRepoUpdateLogDecision,
  evaluateRequiredChecks,
  freshDodCaptures,
  matchDocMapTriggers,
  parseRequiredGateCheckName,
  readDodCapture,
  readRequiredGateCheckName,
  writeDodSection,
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
    'docs',
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
  // 'docs' is ALWAYS required (#124 S2) — substance scales inside the
  // evaluation (docs-only auto-passes), never by dropping the check, which is
  // exactly how the docs entry silently vanished from the marker pre-fix.
  assert.deepEqual(result.requiredChecks.map((check) => check.name), ['pr-contract', 'docs', 'repo-update-log']);
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

  // A trailing comment on the section header itself is valid YAML and must not
  // hide the block (#142 review round 2).
  assert.equal(
    parseRequiredGateCheckName('required_gate: # aggregate gate\n  check_name: ci-success\n'),
    'ci-success'
  );
  assert.equal(
    parseRequiredGateCheckName('version: 1\r\nrequired_gate:  # gate\r\n  check_name: ci-success\r\n'),
    'ci-success'
  );

  // Blank and comment-only lines inside the mapping are valid YAML and must
  // not end the block early (#142 review round 3).
  assert.equal(
    parseRequiredGateCheckName('required_gate:\n\n  check_name: ci-success\n'),
    'ci-success'
  );
  assert.equal(
    parseRequiredGateCheckName('required_gate:\n# column-0 comment\n  check_name: ci-success\n'),
    'ci-success'
  );
  assert.equal(
    parseRequiredGateCheckName('required_gate:\r\n  workflow: x.yml\r\n\r\n  check_name: ci-success\r\n'),
    'ci-success'
  );
});

test('parseRequiredGateCheckName returns null when the gate is not declared', () => {
  assert.equal(parseRequiredGateCheckName('version: 1\ndefaults:\n  stack: node\n'), null);
  assert.equal(parseRequiredGateCheckName('required_gate:\n  workflow: .github/workflows/x.yml\n'), null);
  // An inline scalar is not the declared block shape — only a trailing comment
  // may follow the header.
  assert.equal(parseRequiredGateCheckName('required_gate: ci-success\n'), null);
  assert.equal(parseRequiredGateCheckName('required_gate:\n  check_name: ""\n'), null);
  // check_name under a DIFFERENT block must not count as the required gate —
  // including when a blank line separates required_gate from that block, so
  // the blank-line allowance cannot leak the capture across blocks.
  assert.equal(parseRequiredGateCheckName('other_block:\n  check_name: not-the-gate\n'), null);
  assert.equal(
    parseRequiredGateCheckName('required_gate:\n  workflow: x.yml\n\ndefaults:\n  check_name: sneaky\n'),
    null
  );
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

// #124 S2: the marker carries the 4-section closeout DoD (docs, changelog,
// verification, findings) instead of the loose 3-decision bag.
function sampleDod(overrides = {}) {
  return {
    docs: { decision: 'updated: docs/agent-process/doc-system.md', waived: false, triggers: ['docs/agent-process/doc-system.md'] },
    changelog: { decision: 'fragment .changelog/unreleased/28-close-scan-local-guard.md' },
    verification: { decision: 'npm test passed' },
    findings: { decision: 'no findings file used' },
    ...overrides,
  };
}

test('buildCloseScanMarker records exact HEAD, the 4-section DoD, checks, and timestamp', () => {
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
    dod: sampleDod(),
    localChecks: [{ name: 'pr-contract', ok: true, summary: 'passed' }],
    timestamp: '2026-06-12T18:30:00.000Z',
  });

  assert.equal(marker.version, 2);
  assert.equal(marker.git.head, 'abc123');
  assert.equal(marker.dod.verification.decision, 'npm test passed');
  assert.equal(marker.dod.docs.waived, false);
  assert.deepEqual(marker.dod.docs.triggers, ['docs/agent-process/doc-system.md']);
  assert.equal(marker.timestamp, '2026-06-12T18:30:00.000Z');
  assert.deepEqual(marker.localChecks, [{ name: 'pr-contract', ok: true, summary: 'passed' }]);
});

test('evaluateCloseScanMarker accepts only a fresh v2 marker with all four DoD sections', () => {
  const build = (dod) => buildCloseScanMarker({
    git: {
      branch: 'agent/codex/28-close-scan-local-guard',
      head: 'abc123',
      upstream: 'origin/agent/codex/28-close-scan-local-guard',
      upstreamHead: 'abc123',
    },
    pr: { number: 28, url: 'https://github.com/ArchonVII/repo-template/pull/79', branch: 'agent/codex/28-close-scan-local-guard' },
    scope: { requiredChecks: [{ name: 'pr-contract' }], docsOnly: false },
    dod,
    localChecks: [{ name: 'pr-contract', ok: true, summary: 'passed' }],
    timestamp: '2026-06-12T18:30:00.000Z',
  });
  const marker = build(sampleDod());
  const gitNow = { branch: marker.git.branch, head: 'abc123', upstream: marker.git.upstream, upstreamHead: 'abc123' };

  const current = evaluateCloseScanMarker({ marker, git: gitNow, pr: { number: 28, branch: marker.pr.branch } });
  assert.equal(current.ok, true);

  const stale = evaluateCloseScanMarker({
    marker,
    git: { ...gitNow, head: 'def456' },
    pr: { number: 28, branch: marker.pr.branch },
  });
  assert.equal(stale.ok, false);
  assert.match(stale.failures.join('\n'), /HEAD/i);

  // A v1 marker (pre-S2 scan) is unsupported — the DoD cannot be assumed.
  const v1 = { ...marker, version: 1 };
  const old = evaluateCloseScanMarker({ marker: v1, git: gitNow, pr: { number: 28, branch: marker.pr.branch } });
  assert.equal(old.ok, false);
  assert.match(old.failures.join('\n'), /version/i);

  // Any missing or non-substantive DoD section fails, naming the section.
  for (const section of DOD_SECTIONS) {
    const gutted = build(sampleDod({ [section]: { decision: 'TODO' } }));
    const result = evaluateCloseScanMarker({ marker: gutted, git: gitNow, pr: { number: 28, branch: marker.pr.branch } });
    assert.equal(result.ok, false, `${section} must be substantive`);
    assert.match(result.failures.join('\n'), new RegExp(section, 'i'));
  }
});

// ─── #124 S2: docs DoD section — doc-map triggers and the decision matrix ─────

const S2_DOC_MAP = {
  checked: [
    { path: 'docs/CANON.md', owns: ['scripts/**', 'schemas/**'], checks: ['links'] },
    { path: 'docs/adr/**', owns: ['scripts/**'], checks: ['links'] },
    { path: 'docs/agent-process/doc-sweep.md', owns: ['scripts/doc-sweep/**'], checks: ['links'] },
  ],
  human: [
    { path: 'VISION.md', heal_when: [] },
    { path: 'docs/guides/**', heal_when: ['scripts/**'] },
  ],
};

test('matchDocMapTriggers maps changed files onto doc-map owners and heal_when globs', () => {
  const triggers = matchDocMapTriggers(['scripts/close/lib.mjs', 'README.md'], S2_DOC_MAP);
  const paths = triggers.map((t) => t.path).sort();
  // scripts/close/lib.mjs hits scripts/** owners and heal_when; it does NOT hit
  // doc-sweep.md's narrower scripts/doc-sweep/** — glob depth must be honored.
  assert.deepEqual(paths, ['docs/CANON.md', 'docs/adr/**', 'docs/guides/**']);
  const canon = triggers.find((t) => t.path === 'docs/CANON.md');
  assert.deepEqual(canon.matchedBy, ['scripts/close/lib.mjs']);

  // No triggers for paths nothing owns; empty heal_when never fires (VISION).
  assert.deepEqual(matchDocMapTriggers(['README.md'], S2_DOC_MAP), []);
  assert.deepEqual(matchDocMapTriggers(['LICENSE'], S2_DOC_MAP), []);

  // Exact (non-glob) owner paths match only themselves.
  const exact = { checked: [{ path: 'docs/CANON.md', owns: ['.agent/doc-map.yml'], checks: [] }], human: [] };
  assert.equal(matchDocMapTriggers(['.agent/doc-map.yml'], exact).length, 1);
  assert.equal(matchDocMapTriggers(['.agent/doc-map.yml.bak'], exact).length, 0);
});

test('evaluateDocsDecision passes automatically when nothing is triggered or docs ride the PR', () => {
  // docs-only scope: the docs ARE the change.
  const docsOnly = evaluateDocsDecision({ files: ['docs/CANON.md'], docMap: S2_DOC_MAP, docsOnly: true, labels: [], decision: '' });
  assert.equal(docsOnly.ok, true);

  // No doc-map triggers: nothing owed.
  const untriggered = evaluateDocsDecision({ files: ['LICENSE'], docMap: S2_DOC_MAP, docsOnly: false, labels: [], decision: '' });
  assert.equal(untriggered.ok, true);
  assert.match(untriggered.decision, /no doc-map-owned/i);

  // Repos without a doc-map (pre-T1 consumers) degrade to auto-pass, loudly.
  const noMap = evaluateDocsDecision({ files: ['scripts/x.mjs'], docMap: null, docsOnly: false, labels: [], decision: '' });
  assert.equal(noMap.ok, true);
  assert.match(noMap.decision, /no .agent\/doc-map.yml/i);

  // Every triggered doc updated in the same PR: auto-pass records which.
  const updated = evaluateDocsDecision({
    files: ['scripts/close/lib.mjs', 'docs/CANON.md', 'docs/adr/0009-close.md', 'docs/guides/close.md'],
    docMap: S2_DOC_MAP,
    docsOnly: false,
    labels: [],
    decision: '',
  });
  assert.equal(updated.ok, true);
  assert.match(updated.decision, /updated/i);
});

// A spine that EXISTS but cannot be read or parsed must fail the docs check —
// a malformed doc-map silently disabling the DoD is the worst failure mode
// (#145 review, Codex P2: fail closed on malformed doc maps).
test('evaluateDocsDecision fails closed when the doc-map is present but broken', () => {
  const broken = evaluateDocsDecision({
    files: ['scripts/close/lib.mjs'],
    docMap: null,
    docMapError: 'doc-map parsed but is not a valid version-1 map',
    docsOnly: false,
    labels: [],
    decision: '',
  });
  assert.equal(broken.ok, false);
  assert.match(broken.failures.join('\n'), /doc-map/i);
  assert.match(broken.failures.join('\n'), /fails closed/i);

  // Even a substantive decision does not paper over a broken spine — the
  // spine is the input the decision is supposed to be judged against.
  const decided = evaluateDocsDecision({
    files: ['scripts/close/lib.mjs'],
    docMap: null,
    docMapError: 'boom',
    docsOnly: false,
    labels: [],
    decision: 'not needed: internal refactor with no doc-owned surface',
  });
  assert.equal(decided.ok, false);
});

test('evaluateDocsDecision demands substance (or a waiver) when triggered docs are not updated', () => {
  const args = { files: ['scripts/close/lib.mjs'], docMap: S2_DOC_MAP, docsOnly: false };

  // Triggered, untouched, no decision: FAIL, naming the triggered docs.
  const bare = evaluateDocsDecision({ ...args, labels: [], decision: '' });
  assert.equal(bare.ok, false);
  assert.match(bare.failures.join('\n'), /docs\/CANON\.md/);

  // Placeholder text is not a decision.
  const todo = evaluateDocsDecision({ ...args, labels: [], decision: 'TODO' });
  assert.equal(todo.ok, false);

  // A substantive explanation passes and is recorded un-waived.
  const explained = evaluateDocsDecision({
    ...args,
    labels: [],
    decision: 'not needed: internal refactor, CANON prose describes behavior that did not change',
  });
  assert.equal(explained.ok, true);
  assert.equal(explained.waived, false);

  // docs:waived label + reason passes and records the waiver for the dashboard.
  const waived = evaluateDocsDecision({
    ...args,
    labels: ['docs:waived'],
    decision: 'waived by owner: emergency fix, docs follow in #999',
  });
  assert.equal(waived.ok, true);
  assert.equal(waived.waived, true);

  // The label without a reason is not a bypass.
  const labelOnly = evaluateDocsDecision({ ...args, labels: ['docs:waived'], decision: '' });
  assert.equal(labelOnly.ok, false);
});

// ─── #124 S2: incremental DoD capture (survives reboot) ───────────────────────

// #145 review (P1): a capture made at an earlier commit must not certify a
// later one — the marker's HEAD-bound guarantee extends to every folded-in
// decision. Stale sections are discarded, not silently reused.
test('freshDodCaptures keeps only sections captured at the current HEAD', () => {
  const capture = {
    version: 1,
    sections: {
      verification: { decision: 'npm test passed at A', head: 'aaa111', capturedAt: 't1' },
      findings: { decision: 'no findings on this lane', head: 'bbb222', capturedAt: 't2' },
      docs: { decision: 'updated the owning contract docs', head: null, capturedAt: 't3' },
    },
  };

  const atB = freshDodCaptures(capture, 'bbb222');
  assert.deepEqual(Object.keys(atB.sections), ['findings']);
  assert.deepEqual(atB.discarded.sort(), ['docs', 'verification']);

  // No capture / no HEAD → nothing fresh, nothing kept.
  assert.deepEqual(freshDodCaptures(null, 'bbb222'), { sections: {}, discarded: [] });
  assert.deepEqual(freshDodCaptures(capture, null).sections, {});
});

test('writeDodSection / readDodCapture merge per-section decisions incrementally', () => {
  const root = mkdtempSync(join(tmpdir(), 'dod-capture-'));
  try {
    assert.deepEqual(readDodCapture(root), null);

    writeDodSection(root, 'docs', 'updated: docs/CANON.md', { head: 'abc123', timestamp: '2026-07-02T18:00:00.000Z' });
    writeDodSection(root, 'findings', 'no findings; clean lane', { head: 'abc123', timestamp: '2026-07-02T18:05:00.000Z' });
    // Later capture for the same section overwrites (latest decision wins).
    writeDodSection(root, 'docs', 'updated: docs/CANON.md + docs/adr/0009.md', { head: 'def456', timestamp: '2026-07-02T18:10:00.000Z' });

    const capture = readDodCapture(root);
    assert.equal(capture.sections.docs.decision, 'updated: docs/CANON.md + docs/adr/0009.md');
    assert.equal(capture.sections.docs.head, 'def456');
    assert.equal(capture.sections.findings.decision, 'no findings; clean lane');
    assert.equal(capture.sections.changelog, undefined);

    assert.throws(() => writeDodSection(root, 'nonsense', 'x', { head: 'a' }), /section/i);
    assert.throws(() => writeDodSection(root, 'docs', 'TODO', { head: 'a' }), /substantive/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
