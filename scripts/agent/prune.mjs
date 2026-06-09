// scripts/agent/prune.mjs
import { execFileSync } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import { parseWorktreeList, classifyPruneCandidates, classifyPrMergeSignal } from './lib.mjs';

const dryRun = process.argv.includes('--dry-run');

const primaryPath = git(['rev-parse', '--path-format=absolute', '--git-common-dir']).replace(/\/?\.git.*$/, '');
const currentPath = git(['rev-parse', '--show-toplevel']);
const defaultBranch = ghOrNull(['repo', 'view', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name']) || 'main';

git(['worktree', 'prune']); // safe: only drops admin records for already-deleted dirs

const worktrees = parseWorktreeList(git(['worktree', 'list', '--porcelain']));

// Signal 1 — ancestry: branches whose tip is reachable from the default branch
// (true merges + fast-forwards). Misses squash/rebase merges by design (new SHA).
const ancestryMerged = new Set(
  git(['branch', '--merged', defaultBranch, '--format=%(refname:short)']).split(/\r?\n/).map((b) => b.trim()).filter(Boolean),
);

// Signal 2 — GitHub PR state: catches squash/rebase-merged lanes ancestry can't see.
// Graceful degradation: if `gh` is missing/unauthenticated/rate-limited/malformed,
// `prsByBranch` stays empty and we fall back to ancestry-only — never fail open.
// --limit 200 covers recent lanes (gh lists newest-first); stale lanes beyond that
// are simply kept, never wrongly removed.
const prListRaw = ghOrNull(['pr', 'list', '--state', 'all', '--limit', '200',
  '--json', 'number,state,baseRefName,headRefName,headRefOid,url']);
const ghUnavailable = prListRaw === null;
const prsByBranch = new Map();
if (!ghUnavailable) {
  try {
    for (const pr of JSON.parse(prListRaw)) {
      if (!prsByBranch.has(pr.headRefName)) prsByBranch.set(pr.headRefName, []);
      prsByBranch.get(pr.headRefName).push(pr);
    }
  } catch { /* malformed gh output — leave map empty; ancestry signal still applies */ }
}

// Per-lane reasons drive both removal-mode logging and --dry-run transparency.
const prMerged = new Set();   // agent lanes proven merged via a GitHub PR head-SHA match
const keepReason = new Map(); // agent branch -> why a kept lane was kept
for (const wt of worktrees) {
  if (!wt.branch?.startsWith('agent/') || ancestryMerged.has(wt.branch)) continue;
  if (ghUnavailable) { keepReason.set(wt.branch, 'gh-unavailable'); continue; }
  const signal = classifyPrMergeSignal({ prs: prsByBranch.get(wt.branch) || [], defaultBranch, localTip: wt.head });
  if (signal.merged) prMerged.add(wt.branch);
  else keepReason.set(wt.branch, signal.reason);
}

const mergedBranches = new Set([...ancestryMerged, ...prMerged]);
const dirtyPaths = new Set(worktrees.filter((wt) => isDirty(wt.path)).map((wt) => wt.path));

const { remove, skipDirty, keep } = classifyPruneCandidates({
  worktrees, primaryPath, currentPath, defaultBranch, mergedBranches, dirtyPaths,
});

const removeReason = (wt) => (ancestryMerged.has(wt.branch) ? 'ancestry-merged' : 'github-pr');

if (dryRun) {
  console.log('agent:prune --dry-run (no changes will be made)\n');
  for (const wt of remove) console.log(`remove  [${removeReason(wt)}]  ${wt.path} [${wt.branch}]`);
  for (const wt of skipDirty) console.log(`keep    [dirty]  ${wt.path} [${wt.branch}]`);
  for (const wt of keep) console.log(`keep    [${keepReason.get(wt.branch) || 'unmerged'}]  ${wt.path} [${wt.branch}]`);
  console.log(`\nwould remove ${remove.length}, keep-dirty ${skipDirty.length}, keep ${keep.length}`);
  if (ghUnavailable) console.log('note: `gh` unavailable — squash/rebase-merge detection skipped (ancestry-only).');
  process.exit(0);
}

let removed = 0;
const failed = [];
for (const wt of remove) {
  const reason = removeReason(wt);
  try {
    removeWorktree(wt.path);
    // `git branch -d` for ancestry (git agrees it is merged); `-D` for PR-merged —
    // ancestry won't agree, but classifyPrMergeSignal already proved local tip ==
    // the merged PR's headRefOid, so the ref holds nothing beyond what landed.
    try { git(['branch', reason === 'github-pr' ? '-D' : '-d', wt.branch]); } catch { /* leave a ref we couldn't delete */ }
    console.log(`removed: ${wt.path} [${wt.branch}] (${reason})`);
    removed += 1;
  } catch (err) {
    // One un-removable lane must not abort the whole sweep — report and continue.
    failed.push(wt);
    console.error(`FAILED: ${wt.path} [${wt.branch}]: ${err.message}`);
  }
}
for (const wt of skipDirty) console.log(`skipped (dirty, kept): ${wt.path} [${wt.branch}]`);
console.log(`\nremoved ${removed}, skipped-dirty ${skipDirty.length}, kept ${keep.length}, failed ${failed.length}`);
if (ghUnavailable) console.log('note: `gh` unavailable — squash/rebase-merge detection skipped (ancestry-only).');
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
