import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSlug, buildBranchName, parseIssueFromBranch, populatePrBodyTemplate, parseGitStatusPorcelain, assertCheckoutIsSafe, parseWorktreeList, classifyPruneCandidates, classifyPrMergeSignal, inferNextAction, formatStatusReport, detectClaimsInstalled, checkStartupReadiness, formatStartupMap } from '../../scripts/agent/lib.mjs';

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
test('buildBranchName throws when slug is null (from sanitizeSlug sentinel)', () => {
  assert.throws(() => buildBranchName('claude', '42', null), /required/i);
});
test('parseIssueFromBranch extracts the issue number or null', () => {
  assert.equal(parseIssueFromBranch('agent/codex/27-agent-lifecycle'), '27');
  assert.equal(parseIssueFromBranch('main'), null);
  assert.equal(parseIssueFromBranch('agent/claude/2026-06-01-quick-fix'), '2026');
});

test('populatePrBodyTemplate fills a TODO linked issue placeholder', () => {
  const body = ['## Summary', '', 'TODO', '', '## Linked Issue', '', 'TODO: Closes #___', ''].join('\n');
  assert.equal(populatePrBodyTemplate(body, { issue: 54 }), ['## Summary', '', 'TODO', '', '## Linked Issue', '', 'Closes #54', ''].join('\n'));
});
test('populatePrBodyTemplate fills a bare closes placeholder', () => {
  const body = ['## Linked Issue', '', 'Closes #', ''].join('\n');
  assert.equal(populatePrBodyTemplate(body, { issue: 54 }), ['## Linked Issue', '', 'Closes #54', ''].join('\n'));
});
test('populatePrBodyTemplate inserts under Linked Issue when blank', () => {
  const body = ['## Summary', '', 'Work.', '', '## Linked Issue', '', '## Risks', '', '- low', ''].join('\n');
  assert.equal(populatePrBodyTemplate(body, { issue: 54 }), ['## Summary', '', 'Work.', '', '## Linked Issue', '', 'Closes #54', '', '## Risks', '', '- low', ''].join('\n'));
});
test('populatePrBodyTemplate does not duplicate an existing issue link', () => {
  const body = ['## Linked Issue', '', 'Refs #12', ''].join('\n');
  assert.equal(populatePrBodyTemplate(body, { issue: 54 }), body);
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
test('assertCheckoutIsSafe throws on detached HEAD (empty currentBranch)', () => {
  assert.throws(() => assertCheckoutIsSafe({ statusEntries: [], currentBranch: '', defaultBranch: 'main' }), /default branch/i);
});

const PORCELAIN = [
  'worktree /repo', 'HEAD aaa', 'branch refs/heads/main', '',
  'worktree /repo-1-feat', 'HEAD bbb', 'branch refs/heads/agent/codex/1-feat', '',
  'worktree /repo-2-wip', 'HEAD ccc', 'branch refs/heads/agent/codex/2-wip', '',
].join('\n');

test('parseWorktreeList yields {path,branch,head} per entry', () => {
  const list = parseWorktreeList(PORCELAIN);
  assert.equal(list.length, 3);
  assert.deepEqual(list[1], { path: '/repo-1-feat', branch: 'agent/codex/1-feat', head: 'bbb' });
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

test('parseWorktreeList handles a detached-HEAD entry (no branch line) as branch:null', () => {
  const raw = ['worktree /repo', 'HEAD aaa', 'branch refs/heads/main', '', 'worktree /repo-det', 'HEAD bbb', 'detached', ''].join('\n');
  const list = parseWorktreeList(raw);
  assert.equal(list.length, 2);
  assert.deepEqual(list[1], { path: '/repo-det', branch: null, head: 'bbb' });
});

test('classifyPruneCandidates never removes a detached-HEAD worktree (null branch is protected)', () => {
  const raw = ['worktree /repo', 'HEAD aaa', 'branch refs/heads/main', '', 'worktree /repo-det', 'HEAD bbb', 'detached', ''].join('\n');
  const result = classifyPruneCandidates({
    worktrees: parseWorktreeList(raw), primaryPath: '/repo', currentPath: '/repo', defaultBranch: 'main',
    mergedBranches: new Set(), dirtyPaths: new Set(),
  });
  assert.ok(result.remove.every((w) => w.path !== '/repo-det'));
});

// classifyPrMergeSignal — the squash/rebase-merge signal (#60). A merged PR proves
// a lane is done ONLY when it merged into the default branch AND the lane's local tip
// equals the PR's merged head SHA; everything else is kept with an explanatory reason.
const MERGED_PR = (over = {}) => ({ state: 'MERGED', baseRefName: 'main', headRefName: 'agent/claude/9-x', headRefOid: 'abc', ...over });
test('classifyPrMergeSignal: squash/rebase-merged into default with matching tip → merged', () => {
  assert.deepEqual(classifyPrMergeSignal({ prs: [MERGED_PR()], defaultBranch: 'main', localTip: 'abc' }), { merged: true, reason: 'github-pr' });
});
test('classifyPrMergeSignal: local tip ahead of merged head → keep (work added after merge)', () => {
  assert.deepEqual(classifyPrMergeSignal({ prs: [MERGED_PR({ headRefOid: 'abc' })], defaultBranch: 'main', localTip: 'def' }), { merged: false, reason: 'tip-ahead-of-merged' });
});
test('classifyPrMergeSignal: an OPEN PR always wins even alongside a merged one → keep', () => {
  assert.deepEqual(classifyPrMergeSignal({ prs: [MERGED_PR(), MERGED_PR({ state: 'OPEN' })], defaultBranch: 'main', localTip: 'abc' }), { merged: false, reason: 'open-pr' });
});
test('classifyPrMergeSignal: closed-unmerged PR → keep', () => {
  assert.deepEqual(classifyPrMergeSignal({ prs: [MERGED_PR({ state: 'CLOSED' })], defaultBranch: 'main', localTip: 'abc' }), { merged: false, reason: 'closed-unmerged' });
});
test('classifyPrMergeSignal: merged into a non-default base → keep', () => {
  assert.deepEqual(classifyPrMergeSignal({ prs: [MERGED_PR({ baseRefName: 'release/1.x' })], defaultBranch: 'main', localTip: 'abc' }), { merged: false, reason: 'merged-non-default-base' });
});
test('classifyPrMergeSignal: no PR for the branch → keep', () => {
  assert.deepEqual(classifyPrMergeSignal({ prs: [], defaultBranch: 'main', localTip: 'abc' }), { merged: false, reason: 'no-pr' });
});
test('classifyPrMergeSignal: merged PR but unknown local tip → keep (never delete on uncertainty)', () => {
  assert.deepEqual(classifyPrMergeSignal({ prs: [MERGED_PR()], defaultBranch: 'main', localTip: null }), { merged: false, reason: 'tip-unknown' });
});

test('inferNextAction: onDefaultBranch takes precedence, else dirty > push > review', () => {
  assert.match(inferNextAction({ onDefaultBranch: true }), /start-task/);
  assert.match(inferNextAction({ onDefaultBranch: false, dirty: true }), /commit/i);
  assert.match(inferNextAction({ onDefaultBranch: false, dirty: false, hasPr: false, ahead: 2 }), /open.*pr|push/i);
  assert.match(inferNextAction({ onDefaultBranch: false, dirty: false, hasPr: true, ahead: 0 }), /review|merge|ready/i);
});
test('formatStatusReport renders every required field (#27 AC)', () => {
  const out = formatStatusReport({
    branch: 'agent/codex/27-x', defaultBranch: 'main', upstream: 'origin/agent/codex/27-x',
    pr: { number: 5, url: 'http://x/5', state: 'OPEN' }, issue: '27', dirty: true, dirtyCount: 3,
    worktreePath: '/repo-27-x', claimsInstalled: false, nextAction: 'commit your changes',
  });
  for (const needle of ['Branch:', 'Default branch:', 'Upstream:', 'PR:', 'Issue:', 'Dirty:', 'Worktree:', 'Claims:', 'Next:']) {
    assert.match(out, new RegExp(needle));
  }
  assert.match(out, /#27/);
  assert.match(out, /not installed/i);
});
test('formatStartupMap renders canonical startup paths and repair action', () => {
  const baseline = {
    version: '2026-06-08-agent-start-map',
    required: ['AGENTS.md', 'docs/plans/README.md', '.agent/check-map.yml'],
    expectedDirectories: ['docs/plans/', 'scripts/agent/'],
    legacy: ['docs/superpowers/plans/'],
  };
  const out = formatStartupMap(baseline, { repoPath: '/repo', archonSetupCommand: 'node <path-to-archon-setup>/bin/onboard.mjs' });
  assert.match(out, /Agent startup map:/);
  assert.match(out, /Plans:\s+docs\/plans\//);
  assert.match(out, /Agent scripts:\s+scripts\/agent\//);
  assert.match(out, /Legacy plans:\s+docs\/superpowers\/plans\/ \(history only\)/);
  assert.match(out, /node <path-to-archon-setup>\/bin\/onboard\.mjs \/repo --audit/);
});
test('checkStartupReadiness reports missing required files and directories', () => {
  const baseline = {
    required: ['AGENTS.md', 'docs/plans/README.md'],
    expectedDirectories: ['docs/plans/', 'scripts/agent/'],
    legacy: ['docs/superpowers/plans/'],
  };
  const exists = new Set(['AGENTS.md', 'docs/plans/']);
  const result = checkStartupReadiness(baseline, { exists: (path) => exists.has(path) });
  assert.equal(result.status, 'incomplete');
  assert.deepEqual(result.missing, ['docs/plans/README.md', 'scripts/agent/']);
  assert.deepEqual(result.present, ['AGENTS.md', 'docs/plans/']);
});
test('detectClaimsInstalled is true only when the claims file exists', () => {
  assert.equal(detectClaimsInstalled({ claimsFileExists: true }), true);
  assert.equal(detectClaimsInstalled({ claimsFileExists: false }), false);
});
