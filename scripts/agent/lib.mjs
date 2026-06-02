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
