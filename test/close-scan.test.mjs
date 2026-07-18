import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  DOD_SECTIONS,
  RELEASE_CHANGELOG_DECISION,
  buildCloseScanMarker,
  classifyCloseScanScope,
  evaluateCloseScanMarker,
  evaluateDocsDecision,
  evaluateRequiredChecks,
  freshDodCaptures,
  isSubstantiveDecision,
  matchDocMapTriggers,
  parseRequiredGateCheckName,
  parseRequiredGateCheckNames,
  readDodCapture,
  readRequiredGateCheckName,
  readRequiredGateCheckNames,
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
  // #124 S3: repo-update-log and changelog are no longer local parity checks —
  // the fragment ledger is retired and CHANGELOG.md is release-class.
  assert.deepEqual(result.requiredChecks.map((check) => check.name), [
    'pr-contract',
    'docs',
    'node-test',
    'actionlint',
    'hook-syntax',
    'policy-validation',
  ]);
});

test('classifyCloseScanScope treats docs-only changes as PR contract plus docs check (#124 S3)', () => {
  const result = classifyCloseScanScope({
    files: ['docs/plans/README.md', 'docs/agent-process/doc-system.md'],
    labels: [],
    stack: 'node',
  });

  assert.equal(result.docsOnly, true);
  // 'docs' is ALWAYS required (#124 S2) — substance scales inside the
  // evaluation (docs-only auto-passes), never by dropping the check. S3 drops
  // repo-update-log and changelog entirely — no fragment parity checks remain.
  assert.deepEqual(result.requiredChecks.map((check) => check.name), ['pr-contract', 'docs']);
});

test('classifyCloseScanScope no longer emits repo-update-log or changelog checks for non-doc changes (#124 S3)', () => {
  const names = classifyCloseScanScope({
    files: ['scripts/close/lib.mjs'],
    labels: [],
    stack: 'node',
  }).requiredChecks.map((check) => check.name);
  assert.ok(!names.includes('repo-update-log'), 'repo-update-log check retired in S3');
  assert.ok(!names.includes('changelog'), 'changelog local check retired in S3 (release-class)');
});

test('RELEASE_CHANGELOG_DECISION is substantive so the marker changelog section always passes (#124 S3)', () => {
  // close-scan v2 requires every DoD section (including changelog) to be
  // substantive; the auto-recorded release-class text must clear that bar.
  assert.equal(isSubstantiveDecision(RELEASE_CHANGELOG_DECISION), true);
  assert.match(RELEASE_CHANGELOG_DECISION, /release-class/);
  assert.match(RELEASE_CHANGELOG_DECISION, /docs:changelog/);
});

test('evaluateRequiredChecks fails closed when the required gate is unavailable or not green', () => {
  const passing = evaluateRequiredChecks({
    checkRuns: [{ name: 'repo-required-gate / decision', status: 'completed', conclusion: 'success' }],
  });
  assert.equal(passing.ok, true);
  assert.deepEqual(passing.failures, []);
  assert.equal(passing.matched.name, 'repo-required-gate / decision');

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

test('evaluateRequiredChecks rejects contradictory or ambiguous represented states', () => {
  const contradictory = [
    [
      'failed state with successful conclusion',
      { state: 'FAILURE', conclusion: 'success' },
      /not successful/i,
    ],
    [
      'successful state with failed conclusion',
      { state: 'SUCCESS', conclusion: 'failure' },
      /not successful/i,
    ],
    [
      'pending state with successful conclusion',
      { state: 'PENDING', conclusion: 'success' },
      /not completed/i,
    ],
    [
      'completed status with failed state and successful conclusion',
      { status: 'completed', state: 'FAILURE', conclusion: 'success' },
      /not successful/i,
    ],
    [
      'unknown state with successful conclusion',
      { state: 'MYSTERY', conclusion: 'success' },
      /not successful/i,
    ],
  ];

  for (const [label, fields, expected] of contradictory) {
    const result = evaluateRequiredChecks({
      checkRuns: [{ name: 'repo-required-gate / decision', ...fields }],
    });
    assert.equal(result.ok, false, label);
    assert.match(result.failures.join('\n'), expected, label);
  }
});

test('evaluateRequiredChecks compares declared check names exactly', () => {
  const exactName = ' gate ';
  const exact = evaluateRequiredChecks({
    requiredCheckNames: [exactName],
    checkRuns: [{ name: exactName, state: 'SUCCESS' }],
  });
  assert.equal(exact.ok, true);

  const trimmedOnly = evaluateRequiredChecks({
    requiredCheckNames: [exactName],
    checkRuns: [{ name: 'gate', state: 'SUCCESS' }],
  });
  assert.equal(trimmedOnly.ok, false);
  assert.match(trimmedOnly.failures.join('\n'), /` gate ` is unavailable/);
});

test('evaluateRequiredChecks rejects duplicate and blank caller-supplied declarations', () => {
  const duplicate = evaluateRequiredChecks({
    requiredCheckNames: ['gate', 'gate'],
    checkRuns: [{ name: 'gate', state: 'SUCCESS' }],
  });
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.failures.join('\n'), /duplicate/i);

  const blank = evaluateRequiredChecks({
    requiredCheckNames: ['   '],
    checkRuns: [],
  });
  assert.equal(blank.ok, false);
  assert.match(blank.failures.join('\n'), /malformed/i);
});

test('evaluateRequiredChecks requires every declared member and reports each failed member', () => {
  const requiredCheckNames = ['repo-required-gate / decision', 'Unity CI / required'];
  const passingRuns = [
    { name: 'repo-required-gate / decision', state: 'SUCCESS' },
    { name: 'Unity CI / required', status: 'completed', conclusion: 'success' },
  ];

  const passing = evaluateRequiredChecks({ checkRuns: passingRuns, requiredCheckNames });
  assert.equal(passing.ok, true);
  assert.deepEqual(passing.matches.map((check) => check.name), requiredCheckNames);

  for (const [label, secondRun, expected] of [
    ['missing', null, /unavailable/i],
    ['queued', { name: 'Unity CI / required', state: 'QUEUED' }, /not completed/i],
    ['pending', { name: 'Unity CI / required', state: 'PENDING' }, /not completed/i],
    ['cancelled', { name: 'Unity CI / required', state: 'CANCELLED' }, /not successful/i],
    ['failed', { name: 'Unity CI / required', state: 'FAILURE' }, /not successful/i],
  ]) {
    const result = evaluateRequiredChecks({
      checkRuns: [passingRuns[0], ...(secondRun ? [secondRun] : [])],
      requiredCheckNames,
    });
    assert.equal(result.ok, false, `${label} member must fail the aggregate`);
    assert.match(result.failures.join('\n'), /Unity CI \/ required/);
    assert.match(result.failures.join('\n'), expected);
  }

  const malformedDeclaration = evaluateRequiredChecks({
    checkRuns: passingRuns,
    requiredCheckNames: [],
  });
  assert.equal(malformedDeclaration.ok, false);
  assert.match(malformedDeclaration.failures.join('\n'), /declaration/i);
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

test('parseRequiredGateCheckNames reads an ordered plural declaration with YAML-compatible values', () => {
  const body = [
    'version: 1',
    'required_gates: # stable aggregate checks',
    '  - check_name: "repo-required-gate / decision" # node aggregate',
    '    workflow: .github/workflows/repo-required-gate.yml',
    '  # a second required aggregate',
    "  - check_name: 'Unity CI / required'",
    '    workflow: .github/workflows/unity-ci.yml',
    'defaults:',
    '  stack: node',
  ].join('\r\n');

  assert.deepEqual(parseRequiredGateCheckNames(body), [
    'repo-required-gate / decision',
    'Unity CI / required',
  ]);
  assert.equal(parseRequiredGateCheckName(body), 'repo-required-gate / decision');
});

test('parseRequiredGateCheckNames preserves legacy singular declarations', () => {
  const legacy = 'version: 1\nrequired_gate:\n  check_name: legacy / required # stable gate\n';
  assert.deepEqual(parseRequiredGateCheckNames(legacy), ['legacy / required']);
  assert.equal(parseRequiredGateCheckName(legacy), 'legacy / required');
});

test('parseRequiredGateCheckNames requires YAML separation after mapping colons', () => {
  for (const body of [
    'required_gates:\n  - check_name:gate\n',
    'required_gates:\n  -\n    check_name:gate\n',
    'required_gate:\n  check_name:gate\n',
    'required_gates:\n  - check_name: gate\n    workflow:x.yml\n',
    'required_gate:\n  check_name: gate\n  workflow:x.yml\n',
  ]) {
    assert.deepEqual(parseRequiredGateCheckNames(body), [], body);
  }
});

test('parseRequiredGateCheckNames rejects duplicate decoded names', () => {
  for (const body of [
    'required_gates:\n  - check_name: gate\n  - check_name: gate\n',
    'required_gates:\n  - check_name: gate\n  - check_name: "gate"\n',
  ]) {
    assert.deepEqual(parseRequiredGateCheckNames(body), [], body);
  }
});

test('parseRequiredGateCheckNames accepts the supported plain check-name grammar', () => {
  const values = [
    'repo-required-gate / decision',
    'build_01.test (linux)',
    'gate#1',
    'release:linux',
    'C++ / test',
    'node@20',
    'gate, suffix',
    'gate]suffix',
    'gate{segment',
    'ci*gate',
    "team's / gate",
    '6" screen / gate',
    '-prefixed',
    '?query',
    ':namespace',
  ];

  for (const value of values) {
    assert.deepEqual(
      parseRequiredGateCheckNames(`required_gates:\n  - check_name: ${value} # trailing comment\n`),
      [value],
      `plural: ${value}`,
    );
    assert.deepEqual(
      parseRequiredGateCheckNames(`required_gate:\n  check_name: ${value} # trailing comment\n`),
      [value],
      `legacy: ${value}`,
    );
  }
});

test('parseRequiredGateCheckNames rejects unsupported plain YAML scalar syntax', () => {
  const unsupported = [
    ['colon-space', 'gate: broken'],
    ['sequence indicator', '- gate'],
    ['mapping-key indicator', '? gate'],
    ['mapping-value indicator', ': gate'],
    ['comment indicator', '# gate'],
    ['flow-sequence open', '[gate'],
    ['flow-sequence close', ']gate'],
    ['flow-mapping open', '{gate'],
    ['flow-mapping close', '}gate'],
    ['flow separator', ',gate'],
    ['alias', '*gate'],
    ['anchor', '&gate'],
    ['tag', '!gate'],
    ['literal block scalar', '|'],
    ['folded block scalar', '>'],
    ['directives indicator', '%gate'],
    ['reserved at indicator', '@gate'],
    ['reserved backtick indicator', '`gate'],
    ['terminal mapping colon', 'gate:'],
    ['control character', 'gate\u0007suffix'],
  ];

  for (const [label, value] of unsupported) {
    assert.deepEqual(
      parseRequiredGateCheckNames(`required_gates:\n  - check_name: ${value}\n`),
      [],
      `plural ${label}: ${value}`,
    );
    assert.deepEqual(
      parseRequiredGateCheckNames(`required_gate:\n  check_name: ${value}\n`),
      [],
      `legacy ${label}: ${value}`,
    );
  }
});

test('parseRequiredGateCheckNames decodes the supported quoted scalar subset', () => {
  const supported = [
    ['single-quote doubling', "'team''s / gate'", "team's / gate"],
    ['double-quoted quote escape', '"team \\"quoted\\" / gate"', 'team "quoted" / gate'],
    ['double-quoted backslash escape', '"windows \\\\ gate"', 'windows \\ gate'],
    ['quoted collection lookalike', "'[one, two]'", '[one, two]'],
    ['quoted numeric lookalike', '"01"', '01'],
  ];

  for (const [label, value, expected] of supported) {
    assert.deepEqual(
      parseRequiredGateCheckNames(`required_gates:\n  - check_name: ${value} # comment\n`),
      [expected],
      `plural ${label}`,
    );
    assert.deepEqual(
      parseRequiredGateCheckNames(`required_gate:\n  check_name: ${value} # comment\n`),
      [expected],
      `legacy ${label}`,
    );
  }

  for (const value of [
    "'team's / gate'",
    '"line\\nbreak"',
    '"unicode \\u0041"',
    '"unknown \\q escape"',
  ]) {
    assert.deepEqual(
      parseRequiredGateCheckNames(`required_gates:\n  - check_name: ${value}\n`),
      [],
      `unsupported plural quoted scalar: ${value}`,
    );
    assert.deepEqual(
      parseRequiredGateCheckNames(`required_gate:\n  check_name: ${value}\n`),
      [],
      `unsupported legacy quoted scalar: ${value}`,
    );
  }
});

test('parseRequiredGateCheckNames rejects tab indentation and duplicate schema blocks', () => {
  const malformed = [
    ['tab-indented plural item', 'required_gates:\n\t- check_name: valid\n'],
    ['space-tab-indented plural item', 'required_gates:\n  \t- check_name: valid\n'],
    ['tab-separated plural property', 'required_gates:\n  - \tcheck_name: valid\n'],
    ['tab-indented legacy property', 'required_gate:\n\tcheck_name: valid\n'],
    ['duplicate plural blocks', 'required_gates:\n  - check_name: first\nrequired_gates:\n  - check_name: second\n'],
    ['valid then malformed duplicate plural block', 'required_gates:\n  - check_name: valid\nrequired_gates:\n  - check_name: |\n'],
    ['duplicate legacy blocks', 'required_gate:\n  check_name: first\nrequired_gate:\n  check_name: second\n'],
    ['duplicate legacy blocks beside plural', 'required_gates:\n  - check_name: plural\nrequired_gate:\n  check_name: first\nrequired_gate:\n  check_name: second\n'],
  ];

  for (const [label, body] of malformed) {
    assert.deepEqual(parseRequiredGateCheckNames(body), [], label);
  }

  assert.deepEqual(parseRequiredGateCheckNames([
    'required_gate:',
    '  check_name: legacy',
    'required_gates:',
    '  - check_name: plural',
  ].join('\n')), ['plural']);
});

test('parseRequiredGateCheckNames rejects unquoted YAML non-string scalar shapes', () => {
  for (const value of [
    '[first, second]',
    '{first: second}',
    'null',
    '~',
    'true',
    'FALSE',
    '42',
    '-7',
    '3.14',
    '1.',
    '1e3',
    '01',
    '00',
    '+01',
    '-01',
    '01.5',
    '01e3',
    '0b10',
    '0B1_0',
    '0x10',
    '.inf',
    '.NaN',
  ]) {
    const plural = `required_gates:\n  - check_name: ${value}\n`;
    const legacy = `required_gate:\n  check_name: ${value}\n`;
    assert.deepEqual(parseRequiredGateCheckNames(plural), [], `plural: ${value}`);
    assert.deepEqual(parseRequiredGateCheckNames(legacy), [], `legacy: ${value}`);
  }
});

test('parseRequiredGateCheckNames preserves quoted strings that resemble YAML non-strings', () => {
  const body = [
    'required_gates:',
    '  - check_name: "[first, second]"',
    "  - check_name: '{first: second}'",
    '  - check_name: "null"',
    "  - check_name: 'true'",
    '  - check_name: "42"',
    "  - check_name: '01'",
    '  - check_name: "0b10"',
  ].join('\r\n');

  assert.deepEqual(parseRequiredGateCheckNames(body), [
    '[first, second]',
    '{first: second}',
    'null',
    'true',
    '42',
    '01',
    '0b10',
  ]);
  assert.deepEqual(
    parseRequiredGateCheckNames('required_gate:\n  check_name: "[legacy, quoted]"\n'),
    ['[legacy, quoted]'],
  );
  assert.deepEqual(
    parseRequiredGateCheckNames('required_gate:\n  check_name: "01"\n'),
    ['01'],
  );
  assert.deepEqual(
    parseRequiredGateCheckNames("required_gate:\n  check_name: '0b10'\n"),
    ['0b10'],
  );
});

test('parseRequiredGateCheckNames preserves plain names that merely contain digits', () => {
  for (const value of [
    'build-01 / required',
    '01-build / required',
    'gate 01 / required',
    'v1.2 / required',
    '123 / required',
  ]) {
    const body = `required_gates:\n  - check_name: ${value}\n`;
    assert.deepEqual(parseRequiredGateCheckNames(body), [value], value);
  }
});

test('parseRequiredGateCheckNames rejects an over-indented sibling in a plural list item', () => {
  const body = [
    'required_gates:',
    '  - check_name: repo-required-gate / decision',
    '      workflow: .github/workflows/repo-required-gate.yml',
  ].join('\n');

  assert.deepEqual(parseRequiredGateCheckNames(body), []);
});

test('parseRequiredGateCheckNames rejects nested or unexpected content in a legacy mapping', () => {
  for (const body of [
    'required_gate:\n  check_name: valid\n    broken: value\n',
    'required_gate:\n  check_name: valid\n    workflow: .github/workflows/over-indented.yml\n',
    'required_gate:\n  check_name: valid\n  not-a-mapping-line\n',
  ]) {
    assert.deepEqual(parseRequiredGateCheckNames(body), [], body);
  }
});

test('parseRequiredGateCheckNames fails closed for missing, empty, or malformed plural declarations', () => {
  const bodies = [
    'version: 1\ndefaults:\n  check_name: not-a-gate\n',
    'version: 1\nrequired_gates: []\n',
    'version: 1\nrequired_gates:\n',
    'required_gates:\n  - workflow: .github/workflows/one.yml\n',
    'required_gates:\n  - check_name: ""\n',
    'required_gates:\n  - check_name: valid\n  - workflow: .github/workflows/missing-name.yml\n',
    'required_gates:\n  - check_name: "unterminated\n',
    'required_gates:\n  check_name: not-a-list-item\n',
    'required_gates:\n  -check_name: missing-list-separator\n',
    'required_gates:\n  -# missing separator\n    check_name: hidden-invalid-item\n',
    'required_gates:\n  - check_name: valid\n  - workflow: missing-name.yml\n\ndefaults:\n  check_name: sneaky\nrequired_gate:\n  check_name: legacy-must-not-mask-malformed-plural\n',
  ];

  for (const body of bodies) {
    assert.deepEqual(parseRequiredGateCheckNames(body), [], body);
  }
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

test('readRequiredGateCheckNames reads every declared check in order and returns an empty list when absent', () => {
  const root = mkdtempSync(join(tmpdir(), 'close-gates-checkmap-'));
  try {
    assert.deepEqual(readRequiredGateCheckNames(root), []);
    mkdirSync(join(root, '.agent'), { recursive: true });
    writeFileSync(join(root, '.agent', 'check-map.yml'), [
      'version: 1',
      'required_gates:',
      '  - check_name: first / required',
      '    workflow: first.yml',
      '  - check_name: second / required',
      '    workflow: second.yml',
    ].join('\n'));
    assert.deepEqual(readRequiredGateCheckNames(root), ['first / required', 'second / required']);
    assert.equal(readRequiredGateCheckName(root), 'first / required');
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

    writeFileSync(join(root, '.agent', 'check-map.yml'), 'version: 1\nrequired_gate:\n  check_name: "01"\n');
    assert.equal(validatePolicyFiles(root).ok, true);

    writeFileSync(join(root, '.agent', 'check-map.yml'), 'version: 1\nrequired_gate:\n  check_name: "0b10"\n');
    assert.equal(validatePolicyFiles(root).ok, true);

    // The repo-template default still passes.
    writeFileSync(
      join(root, '.agent', 'check-map.yml'),
      [
        'version: 1',
        'required_gates:',
        '  - check_name: repo-required-gate / decision',
        '    workflow: .github/workflows/repo-required-gate.yml',
        '  - check_name: Unity CI / required',
        '    workflow: .github/workflows/unity-ci.yml',
      ].join('\n')
    );
    assert.equal(validatePolicyFiles(root).ok, true);

    for (const malformed of [
      'version: 1\nrequired_gates: []\n',
      'version: 1\nrequired_gates:\n  - workflow: x.yml\n',
      'version: 1\nrequired_gates:\n  - check_name: [first, second]\n',
      'version: 1\nrequired_gates:\n  - check_name: {first: second}\n',
      'version: 1\nrequired_gates:\n  - check_name: valid\n      workflow: x.yml\n',
      'version: 1\nrequired_gates:\n  - check_name: 01\n',
      'version: 1\nrequired_gates:\n  - check_name: 0b10\n',
      'version: 1\nrequired_gates:\n  - check_name:gate\n',
      'version: 1\nrequired_gates:\n  - check_name: gate\n  - check_name: gate\n',
      'version: 1\nrequired_gates:\n  - check_name: gate: broken\n',
      'version: 1\nrequired_gates:\n  - check_name: *gate\n',
      'version: 1\nrequired_gates:\n\t- check_name: valid\n',
      'version: 1\nrequired_gates:\n  - check_name: valid\nrequired_gates:\n  - check_name: |\n',
      'version: 1\nrequired_gate:\n  check_name: 01\n',
      'version: 1\nrequired_gate:\n  check_name: 0b10\n',
      'version: 1\nrequired_gate:\n  check_name:gate\n',
      'version: 1\nrequired_gate:\n  check_name: valid\n    broken: value\n',
      'version: 1\nrequired_gate:\n  workflow: x.yml\n',
    ]) {
      writeFileSync(join(root, '.agent', 'check-map.yml'), malformed);
      const missingName = validatePolicyFiles(root);
      assert.equal(missingName.ok, false);
      assert.match(missingName.summary, /check name/i);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// #124 S2: the marker carries the 4-section closeout DoD (docs, changelog,
// verification, findings) instead of the loose 3-decision bag.
function sampleDod(overrides = {}) {
  return {
    docs: { decision: 'updated: docs/agent-process/doc-system.md', waived: false, triggers: ['docs/agent-process/doc-system.md'] },
    changelog: { decision: RELEASE_CHANGELOG_DECISION },
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

  // A scalar owns/heal_when (`owns: scripts/**`) is valid YAML and the parser
  // returns it as a string — normalize to a one-glob list instead of throwing
  // a TypeError mid-scan (#145 review round 3).
  const scalar = {
    checked: [{ path: 'docs/CANON.md', owns: 'scripts/**', checks: [] }],
    human: [{ path: 'docs/guides/**', heal_when: 'schemas/**' }],
  };
  assert.deepEqual(
    matchDocMapTriggers(['scripts/x.mjs', 'schemas/y.json'], scalar).map((t) => t.path).sort(),
    ['docs/CANON.md', 'docs/guides/**']
  );
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

// Deletions ride in `files` on purpose (scope derivation counts them), so a PR
// that deletes the owning doc would otherwise satisfy its own trigger
// (#145 review round 4): "updated" requires the matched doc to still exist.
test('evaluateDocsDecision does not count a deleted triggered doc as updated', () => {
  const args = {
    files: ['scripts/close/lib.mjs', 'docs/CANON.md'],
    docMap: { checked: [{ path: 'docs/CANON.md', owns: ['scripts/**'], checks: [] }], human: [] },
    docsOnly: false,
    labels: [],
    decision: '',
  };

  // Doc present on disk: trigger satisfied.
  const alive = evaluateDocsDecision({ ...args, existsFn: () => true });
  assert.equal(alive.ok, true);

  // Same diff, but the doc was deleted: the trigger is NOT satisfied and a
  // substantive decision is required.
  const deleted = evaluateDocsDecision({ ...args, existsFn: (rel) => rel !== 'docs/CANON.md' });
  assert.equal(deleted.ok, false);
  assert.match(deleted.failures.join('\n'), /docs\/CANON\.md/);
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

// repo-template#146 round 4: `**/` spans zero-or-more segments in the DoD
// trigger matcher too — scripts/**/*.mjs must hit root-level scripts files.
test('matchDocMapTriggers globstar matches zero segments', () => {
  const map = { checked: [{ path: 'docs/CANON.md', owns: ['scripts/**/*.mjs'], checks: [] }], human: [] };
  assert.equal(matchDocMapTriggers(['scripts/foo.mjs'], map).length, 1);
  assert.equal(matchDocMapTriggers(['scripts/a/b/foo.mjs'], map).length, 1);
  assert.equal(matchDocMapTriggers(['scriptsx/foo.mjs'], map).length, 0);
});
