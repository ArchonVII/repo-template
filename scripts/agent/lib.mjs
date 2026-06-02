// scripts/agent/lib.mjs
// Pure helpers for the agent lifecycle commands. No I/O — every function here is
// unit-tested in test/agent/lib.test.mjs. Command shims (start-task/status/prune)
// inject git/gh output and consume these.

// Branch convention: agent/<tool>/<issue>-<slug>  (AGENTS.md:15)
export function sanitizeSlug(value) {
  const slug = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .filter(Boolean)
    .slice(0, 6) // cap length so branch/worktree names stay manageable
    .join('-');
  return slug || null;
}
export function buildBranchName(agent, issue, slug) {
  return `agent/${agent}/${issue}-${slug}`;
}
export function parseIssueFromBranch(branch) {
  const match = /^agent\/[^/]+\/(\d+)-/.exec(String(branch));
  return match ? match[1] : null;
}

export function parseGitStatusPorcelain(raw) {
  if (!raw) return [];
  return raw
    .split('\0')
    .filter(Boolean)
    .map((record) => ({ status: record.slice(0, 2), path: record.slice(3) }));
}
export function assertCheckoutIsSafe({ statusEntries, currentBranch, defaultBranch }) {
  if (statusEntries.length > 0) {
    const sample = statusEntries.slice(0, 3).map((e) => e.path).join(', ');
    throw new Error(`Working tree is dirty. Commit or stash before starting a task. Dirty: ${sample}`);
  }
  if (currentBranch && currentBranch !== defaultBranch) {
    throw new Error(`start-task must run from the default branch (${defaultBranch}); current: ${currentBranch}`);
  }
}

export function parseWorktreeList(porcelain) {
  const list = [];
  let current = null;
  for (const line of String(porcelain).split('\n')) {
    if (line.startsWith('worktree ')) current = { path: line.slice('worktree '.length).trim(), branch: null };
    else if (line.startsWith('branch ')) {
      if (current) current.branch = line.slice('branch refs/heads/'.length).trim();
    } else if (line === '' && current) { list.push(current); current = null; }
  }
  if (current) list.push(current);
  return list;
}

// Prune safety contract (#27 AC): remove ONLY worktrees that are
//   (a) not the primary checkout, (b) not the current checkout,
//   (c) not the default branch, (d) on an agent/* branch already merged
//       into the default branch, AND (e) clean (no uncommitted changes).
// Anything dirty is skipped and reported. Anything unmerged is kept.
export function classifyPruneCandidates({ worktrees, primaryPath, currentPath, defaultBranch, mergedBranches, dirtyPaths }) {
  const remove = [], skipDirty = [], keep = [];
  for (const wt of worktrees) {
    // Protected worktrees are never touched and are not tracked in keep/remove/skipDirty
    const isProtected = wt.path === primaryPath || wt.path === currentPath || wt.branch === defaultBranch || !wt.branch?.startsWith('agent/');
    if (isProtected) continue;
    if (dirtyPaths.has(wt.path)) { skipDirty.push(wt); continue; }
    if (mergedBranches.has(wt.branch)) { remove.push(wt); continue; }
    keep.push(wt);
  }
  return { remove, skipDirty, keep };
}

export function inferNextAction({ onDefaultBranch, dirty, hasPr, ahead = 0 }) {
  if (onDefaultBranch) return 'run `npm run agent:start-task -- <issue>` to begin a task';
  if (dirty) return 'commit your changes';
  if (!hasPr && ahead > 0) return 'push and open a PR (jma-git-pr-lifecycle)';
  if (hasPr) return 'address review / mark PR ready';
  return 'no action — branch is in sync';
}
export function detectClaimsInstalled({ claimsFileExists }) {
  return Boolean(claimsFileExists);
}
export function formatStatusReport(s) {
  const prText = s.pr ? `#${s.pr.number} ${s.pr.state} ${s.pr.url}` : 'none';
  return [
    `Branch:         ${s.branch}`,
    `Default branch: ${s.defaultBranch}`,
    `Upstream:       ${s.upstream ?? 'none'}`,
    `PR:             ${prText}`,
    `Issue:          ${s.issue ? `#${s.issue}` : 'none'}`,
    `Dirty:          ${s.dirty ? `yes (${s.dirtyCount} path${s.dirtyCount === 1 ? '' : 's'})` : 'clean'}`,
    `Worktree:       ${s.worktreePath}`,
    `Claims:         ${s.claimsInstalled ? 'installed' : 'not installed'}`,
    `Next:           ${s.nextAction}`,
  ].join('\n');
}
