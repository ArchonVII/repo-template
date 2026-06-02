// scripts/agent/prune.mjs
import { execFileSync } from 'node:child_process';
import { parseWorktreeList, classifyPruneCandidates } from './lib.mjs';

const primaryPath = git(['rev-parse', '--path-format=absolute', '--git-common-dir']).replace(/\/?\.git.*$/, '');
const currentPath = git(['rev-parse', '--show-toplevel']);
const defaultBranch = ghOrNull(['repo', 'view', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name']) || 'main';

git(['worktree', 'prune']); // safe: only drops admin records for already-deleted dirs

const worktrees = parseWorktreeList(git(['worktree', 'list', '--porcelain']));
const mergedBranches = new Set(
  git(['branch', '--merged', defaultBranch, '--format=%(refname:short)']).split(/\r?\n/).map((b) => b.trim()).filter(Boolean),
);
const dirtyPaths = new Set(worktrees.filter((wt) => isDirty(wt.path)).map((wt) => wt.path));

const { remove, skipDirty, keep } = classifyPruneCandidates({
  worktrees, primaryPath, currentPath, defaultBranch, mergedBranches, dirtyPaths,
});

for (const wt of remove) {
  git(['worktree', 'remove', wt.path]); // never --force: refuses if somehow dirty
  try { git(['branch', '-d', wt.branch]); } catch { /* unmerged elsewhere; leave it */ }
  console.log(`removed: ${wt.path} [${wt.branch}]`);
}
for (const wt of skipDirty) console.log(`skipped (dirty, kept): ${wt.path} [${wt.branch}]`);
console.log(`\nremoved ${remove.length}, skipped-dirty ${skipDirty.length}, kept ${keep.length}`);

function git(a) { return execFileSync('git', a, { cwd: process.cwd(), encoding: 'utf8' }).trim(); }
function ghOrNull(a) { try { return execFileSync('gh', a, { cwd: process.cwd(), encoding: 'utf8' }).trim(); } catch { return null; } }
function isDirty(worktreePath) {
  try { return execFileSync('git', ['status', '--porcelain'], { cwd: worktreePath, encoding: 'utf8' }).trim().length > 0; }
  catch { return true; } // if we can't tell, treat as dirty and skip — never delete on uncertainty
}
