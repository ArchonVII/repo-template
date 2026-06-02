import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSlug, buildBranchName, parseIssueFromBranch } from '../../scripts/agent/lib.mjs';
import { parseGitStatusPorcelain, assertCheckoutIsSafe } from '../../scripts/agent/lib.mjs';
import { parseWorktreeList, classifyPruneCandidates } from '../../scripts/agent/lib.mjs';

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

const PORCELAIN = [
  'worktree /repo', 'HEAD aaa', 'branch refs/heads/main', '',
  'worktree /repo-1-feat', 'HEAD bbb', 'branch refs/heads/agent/codex/1-feat', '',
  'worktree /repo-2-wip', 'HEAD ccc', 'branch refs/heads/agent/codex/2-wip', '',
].join('\n');

test('parseWorktreeList yields {path,branch} per entry', () => {
  const list = parseWorktreeList(PORCELAIN);
  assert.equal(list.length, 3);
  assert.deepEqual(list[1], { path: '/repo-1-feat', branch: 'agent/codex/1-feat' });
});
test('classifyPruneCandidates removes only merged+clean non-current agent worktrees', () => {
  const result = classifyPruneCandidates({
    worktrees: parseWorktreeList(PORCELAIN), primaryPath: '/repo', currentPath: '/repo', defaultBranch: 'main',
    mergedBranches: new Set(['agent/codex/1-feat']), dirtyPaths: new Set(['/repo-2-wip']),
  });
  assert.deepEqual(result.remove.map((w) => w.path), ['/repo-1-feat']);
  assert.deepEqual(result.skipDirty.map((w) => w.path), ['/repo-2-wip']);
  assert.ok(!result.remove.some((w) => w.path === '/repo'));
});
test('classifyPruneCandidates NEVER removes a dirty worktree even if merged', () => {
  const result = classifyPruneCandidates({
    worktrees: parseWorktreeList(PORCELAIN), primaryPath: '/repo', currentPath: '/repo', defaultBranch: 'main',
    mergedBranches: new Set(['agent/codex/1-feat', 'agent/codex/2-wip']), dirtyPaths: new Set(['/repo-2-wip']),
  });
  assert.ok(result.remove.every((w) => w.path !== '/repo-2-wip'));
  assert.ok(result.skipDirty.some((w) => w.path === '/repo-2-wip'));
});
test('classifyPruneCandidates keeps unmerged clean worktrees (work in progress)', () => {
  const result = classifyPruneCandidates({
    worktrees: parseWorktreeList(PORCELAIN), primaryPath: '/repo', currentPath: '/repo', defaultBranch: 'main',
    mergedBranches: new Set(), dirtyPaths: new Set(),
  });
  assert.equal(result.remove.length, 0);
  assert.equal(result.keep.length, 2);
});
