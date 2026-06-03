// scripts/agent/prune.mjs
import { execFileSync } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
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

let removed = 0;
const failed = [];
for (const wt of remove) {
  try {
    removeWorktree(wt.path);
    try { git(['branch', '-d', wt.branch]); } catch { /* unmerged elsewhere; leave it */ }
    console.log(`removed: ${wt.path} [${wt.branch}]`);
    removed += 1;
  } catch (err) {
    // One un-removable lane must not abort the whole sweep — report and continue.
    failed.push(wt);
    console.error(`FAILED: ${wt.path} [${wt.branch}]: ${err.message}`);
  }
}
for (const wt of skipDirty) console.log(`skipped (dirty, kept): ${wt.path} [${wt.branch}]`);
console.log(`\nremoved ${removed}, skipped-dirty ${skipDirty.length}, kept ${keep.length}, failed ${failed.length}`);
if (failed.length) process.exitCode = 1; // surface partial failure, but only after the full sweep

function git(a) { return execFileSync('git', a, { cwd: process.cwd(), encoding: 'utf8' }).trim(); }
function ghOrNull(a) { try { return execFileSync('gh', a, { cwd: process.cwd(), encoding: 'utf8' }).trim(); } catch { return null; } }
function isDirty(worktreePath) {
  try { return execFileSync('git', ['status', '--porcelain'], { cwd: worktreePath, encoding: 'utf8' }).trim().length > 0; }
  catch { return true; } // if we can't tell, treat as dirty and skip — never delete on uncertainty
}

// `git worktree remove` (no --force) is the primary path and keeps the dirty-tree
// refusal as a safety net. But on Windows it can unregister the worktree and delete
// the `.git` link, then abort the recursive rmdir on ignored residue (node_modules/dist)
// with "Directory not empty". When that happens we finish the deletion ourselves —
// gated on a cleanliness check sampled BEFORE the destructive call, because a partial
// removal deletes `.git` and makes a post-failure dirtiness check unreliable.
function removeWorktree(worktreePath) {
  const wasClean = !isDirty(worktreePath); // sample now; classification may be stale
  try {
    git(['worktree', 'remove', worktreePath]);
    return;
  } catch (removeErr) {
    if (!wasClean) throw removeErr;              // dirty since the scan — never force-delete real work
    if (isLocked(worktreePath)) throw removeErr; // explicit human lock — respect it, never override
    // maxRetries/retryDelay ride out transient Windows EBUSY/ENOTEMPTY locks — Node fs.rmSync docs.
    if (existsSync(worktreePath)) rmSync(worktreePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    git(['worktree', 'prune']); // reconcile the admin record for the dir we hand-deleted
  }
}
function isLocked(worktreePath) {
  // A locked worktree is an explicit "do not touch" — the fallback must never override it.
  // `git worktree list --porcelain` prints a bare `locked` line inside that worktree's stanza.
  const target = normalizePath(worktreePath);
  let inTarget = false;
  for (const line of git(['worktree', 'list', '--porcelain']).split('\n')) {
    if (line.startsWith('worktree ')) inTarget = normalizePath(line.slice('worktree '.length).trim()) === target;
    else if (inTarget && (line === 'locked' || line.startsWith('locked '))) return true;
  }
  return false;
}
function normalizePath(p) { return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase(); }
