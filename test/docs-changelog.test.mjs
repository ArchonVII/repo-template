import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseConventionalSubject,
  foldSubjectsToSections,
  renderUnreleasedBody,
} from '../scripts/docs/changelog.mjs';

// #124 S3: CHANGELOG.md is release-class — docs:changelog folds it from
// Conventional Commit history. The pure fold is fixture-tested for deterministic
// output (the property --check depends on) without shelling out to git.

test('parseConventionalSubject splits type/scope/breaking/description, rejects non-conforming', () => {
  assert.deepEqual(parseConventionalSubject('feat(docs): add the spine'), {
    type: 'feat', scope: 'docs', breaking: false, description: 'add the spine',
  });
  assert.deepEqual(parseConventionalSubject('fix: one thing'), {
    type: 'fix', scope: null, breaking: false, description: 'one thing',
  });
  assert.equal(parseConventionalSubject('feat(api)!: drop v1').breaking, true);
  assert.equal(parseConventionalSubject('feat!: drop v1').breaking, true);
  // Non-conventional subjects (the pre-automation root/merge commit) drop out.
  assert.equal(parseConventionalSubject('Initial commit'), null);
  assert.equal(parseConventionalSubject('Merge branch main'), null);
  assert.equal(parseConventionalSubject(''), null);
});

test('foldSubjectsToSections maps types per the S3 owner decision and omits non-user-facing types', () => {
  const sections = foldSubjectsToSections([
    'feat(a): added thing',
    'fix(b): fixed thing',
    'perf(c): faster thing',
    'refactor(d): reshaped thing',
    'docs(e): doc thing',      // omitted
    'chore(f): chore thing',   // omitted
    'test(g): test thing',     // omitted
    'ci(h): ci thing',         // omitted
    'build(i): build thing',   // omitted
  ]);
  assert.deepEqual(sections.Added, ['added thing']);
  assert.deepEqual(sections.Fixed, ['fixed thing']);
  assert.deepEqual(sections.Changed, ['faster thing', 'reshaped thing']);
});

test('foldSubjectsToSections surfaces a breaking change of any type under Changed with a marker', () => {
  const sections = foldSubjectsToSections([
    'feat!: new default',
    'chore!: removed the legacy flag',
  ]);
  // A breaking change is always surfaced, even for an otherwise-omitted type.
  assert.deepEqual(sections.Changed, ['**BREAKING:** new default', '**BREAKING:** removed the legacy flag']);
  assert.deepEqual(sections.Added, []);
});

test('foldSubjectsToSections appends the scaffold seed to Added when provided', () => {
  const sections = foldSubjectsToSections(['feat: a'], { scaffoldEntry: 'Initial repo scaffold.' });
  assert.deepEqual(sections.Added, ['a', 'Initial repo scaffold.']);
  const none = foldSubjectsToSections(['feat: a']);
  assert.deepEqual(none.Added, ['a']);
});

test('renderUnreleasedBody emits Keep-a-Changelog sections in order, omitting empties', () => {
  const body = renderUnreleasedBody({
    Added: ['first', 'second'],
    Changed: [],
    Fixed: ['a fix'],
  });
  assert.equal(body, [
    '### Added',
    '',
    '- first',
    '- second',
    '',
    '### Fixed',
    '',
    '- a fix',
  ].join('\n'));
  // No sections at all -> empty body (a fresh repo with no conventional commits).
  assert.equal(renderUnreleasedBody({ Added: [], Changed: [], Fixed: [] }), '');
});
