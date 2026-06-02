import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSlug, buildBranchName, parseIssueFromBranch } from '../../scripts/agent/lib.mjs';
import { parseGitStatusPorcelain, assertCheckoutIsSafe } from '../../scripts/agent/lib.mjs';

test('sanitizeSlug lowercases, hyphenates, trims, caps at 6 words', () => {
  assert.equal(sanitizeSlug('Add OAuth Flow!'), 'add-oauth-flow');
  assert.equal(sanitizeSlug('  Spaces   and---dashes  '), 'spaces-and-dashes');
  assert.equal(sanitizeSlug('one two three four five six seven'), 'one-two-three-four-five-six');
});
test('sanitizeSlug returns null when nothing usable', () => {
  assert.equal(sanitizeSlug('!!!'), null);
  assert.equal(sanitizeSlug(''), null);
});
test('buildBranchName composes agent/<tool>/<issue>-<slug>', () => {
  assert.equal(buildBranchName('claude', '42', 'oauth-flow'), 'agent/claude/42-oauth-flow');
});
test('parseIssueFromBranch extracts the issue number or null', () => {
  assert.equal(parseIssueFromBranch('agent/codex/27-agent-lifecycle'), '27');
  assert.equal(parseIssueFromBranch('main'), null);
  assert.equal(parseIssueFromBranch('agent/claude/2026-06-01-quick-fix'), '2026');
});

test('parseGitStatusPorcelain splits NUL records into {status,path}', () => {
  const raw = ' M src/a.mjs\0?? new.txt\0';
  assert.deepEqual(parseGitStatusPorcelain(raw), [
    { status: ' M', path: 'src/a.mjs' },
    { status: '??', path: 'new.txt' },
  ]);
  assert.deepEqual(parseGitStatusPorcelain(''), []);
});
test('assertCheckoutIsSafe throws when dirty', () => {
  assert.throws(() => assertCheckoutIsSafe({ statusEntries: [{ status: ' M', path: 'a' }], currentBranch: 'main', defaultBranch: 'main' }), /dirty/i);
});
test('assertCheckoutIsSafe throws when not on the default branch', () => {
  assert.throws(() => assertCheckoutIsSafe({ statusEntries: [], currentBranch: 'agent/x/1-y', defaultBranch: 'main' }), /default branch/i);
});
test('assertCheckoutIsSafe passes when clean and on default branch', () => {
  assert.doesNotThrow(() => assertCheckoutIsSafe({ statusEntries: [], currentBranch: 'main', defaultBranch: 'main' }));
});
