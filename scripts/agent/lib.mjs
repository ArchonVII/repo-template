// scripts/agent/lib.mjs
// Pure helpers for the agent lifecycle commands. No I/O — every function here is
// unit-tested in test/agent/lib.test.mjs. Command shims (start-task/status/prune)
// inject git/gh output and consume these.

import path from 'node:path';

export const PRECISE_STATUS_ARGS = Object.freeze(['status', '--porcelain=1', '-z', '--untracked-files=all']);

// Branch convention: agent/<tool>/<issue>-<slug> (see AGENTS.md "Workflow").
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
  if (!agent || !issue || !slug) {
    throw new Error(`buildBranchName: all arguments required (got agent=${agent}, issue=${issue}, slug=${slug})`);
  }
  return `agent/${agent}/${issue}-${slug}`;
}
export function parseIssueFromBranch(branch) {
  const match = /^agent\/[^/]+\/(\d+)-/.exec(String(branch));
  return match ? match[1] : null;
}

// start-task collision scan (archon-setup#295): given the short names of candidate
// refs — BOTH local heads (refs/heads/agent) AND remote-tracking refs
// (refs/remotes/*) — return the distinct agent branches that belong to
// <issueNumber>. After a merged/retired PR the local agent/<tool>/<issue>-<slug>
// head is often pruned while the branch still exists on origin, so a local-only
// scan would miss it and let a retired name be silently reused. Remote-tracking
// shorthand ("origin/agent/...") is normalized to the bare "agent/..." branch and
// de-duplicated against the local heads.
export function filterIssueBranches(refShortNames, issueNumber) {
  const re = new RegExp(`^agent/[^/]+/${issueNumber}-`);
  const out = new Set();
  for (const raw of refShortNames ?? []) {
    const name = String(raw).trim();
    if (!name) continue;
    // Strip a leading remote name only when the remainder is an agent branch,
    // so "origin/agent/claude/27-x" -> "agent/claude/27-x" but "origin/main" is left alone.
    const bare = name.replace(/^[^/]+\/(?=agent\/)/, '');
    if (re.test(bare)) out.add(bare);
  }
  return [...out];
}

const ISSUE_LINK_RE = /\b(?:Closes|Fixes|Refs)\s+#\d+\b/i;
const ISSUE_PLACEHOLDER_RES = [
  /^TODO:\s*(?:Closes|Fixes|Refs)\s+#(?:___|<[^>\r\n]+>)\s*$/im,
  /^(?:Closes|Fixes|Refs)\s+#(?:___|<[^>\r\n]+>)?\s*$/im,
];

export function populatePrBodyTemplate(template, { issue }) {
  const body = String(template ?? '');
  if (!issue || ISSUE_LINK_RE.test(body)) return ensureFinalNewline(body);

  const link = `Closes #${issue}`;
  for (const placeholderRe of ISSUE_PLACEHOLDER_RES) {
    if (placeholderRe.test(body)) {
      return ensureFinalNewline(body.replace(placeholderRe, link));
    }
  }

  const lines = body.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => /^##\s+Linked Issue\s*$/i.test(line.trim()));
  if (headingIndex !== -1) {
    let insertIndex = headingIndex + 1;
    while (insertIndex < lines.length && lines[insertIndex].trim() === '') insertIndex += 1;

    if (insertIndex >= lines.length || /^##\s+/.test(lines[insertIndex])) {
      lines.splice(headingIndex + 1, 0, '', link);
    } else if (/^(?:TODO\b|#(?:___)?$|<[^>]+>$)/i.test(lines[insertIndex].trim())) {
      lines[insertIndex] = link;
    } else {
      lines.splice(insertIndex, 0, link);
    }

    return ensureFinalNewline(lines.join('\n'));
  }

  return ensureFinalNewline(`${body.trimEnd()}\n\n## Linked Issue\n\n${link}`);
}

export function parseGitStatusPorcelain(raw) {
  if (!raw) return [];
  const records = raw.split('\0').filter(Boolean);
  const entries = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const status = record.slice(0, 2);
    const entry = { status, path: normalizeRepoRelativePath(record.slice(3)) };
    if (status.includes('R') || status.includes('C')) {
      entry.originalPath = normalizeRepoRelativePath(records[index + 1] ?? '');
      index += 1;
    }
    entries.push(entry);
  }
  return entries;
}

export function parseStartTaskArgs(argv) {
  const parsed = { carry: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === 'carry') {
      const start = parsed.carry.length;
      while (argv[index + 1] && !argv[index + 1].startsWith('--')) {
        parsed.carry.push(argv[index + 1]);
        index += 1;
      }
      if (parsed.carry.length === start) throw new Error('--carry requires at least one path.');
      continue;
    }
    if (key !== 'agent' && key !== 'slug') throw new Error(`Unknown option: --${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`--${key} requires a value.`);
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

export function normalizeRepoRelativePath(value) {
  return String(value).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/g, '');
}

export function toCheckoutRelativePath(filePath, { checkoutRoot, baseDir }) {
  const resolvedRoot = path.resolve(checkoutRoot);
  const absolutePath = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(baseDir, filePath);
  const nativeRelativePath = path.relative(resolvedRoot, absolutePath);
  if (!nativeRelativePath) {
    throw new Error('Carry path resolves to the checkout root; pass a file or directory inside the repo.');
  }
  if (path.isAbsolute(nativeRelativePath) || nativeRelativePath === '..' || nativeRelativePath.startsWith(`..${path.sep}`)) {
    throw new Error(`Carry path is outside the checkout: ${filePath}`);
  }
  const repoRelativePath = normalizeRepoRelativePath(nativeRelativePath);
  if (repoRelativePath === '.git' || repoRelativePath.startsWith('.git/')) {
    throw new Error('Carry paths may not include .git metadata.');
  }
  return repoRelativePath;
}

export function minimizeCarryPaths(carryPaths = []) {
  const candidates = [...new Set(carryPaths.map(normalizeRepoRelativePath))]
    .sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right));
  return candidates.filter((candidate, index) => !candidates.slice(0, index).some(
    (parent) => candidate === parent || candidate.startsWith(`${parent}/`),
  ));
}

export function collectCarriedStatusEntries({ statusEntries, carryPaths = [] }) {
  const normalizedCarryPaths = minimizeCarryPaths(carryPaths);
  const carriedEntries = [];
  const unexpectedEntries = [];
  for (const entry of statusEntries) {
    const destinationCovered = normalizedCarryPaths.some((carryPath) => (
      isPathInsideCarryPath(entry.path, carryPath)
    ));
    const originalCovered = !entry.status.includes('R') || normalizedCarryPaths.some((carryPath) => (
      entry.originalPath && isPathInsideCarryPath(entry.originalPath, carryPath)
    ));
    const covered = destinationCovered && originalCovered;
    (covered ? carriedEntries : unexpectedEntries).push(entry);
  }
  return { carriedEntries, unexpectedEntries };
}

export function assertCheckoutIsSafe({ statusEntries, currentBranch, defaultBranch, carryPaths = [] }) {
  const { carriedEntries, unexpectedEntries } = collectCarriedStatusEntries({ statusEntries, carryPaths });
  if (unexpectedEntries.length > 0) {
    const sample = unexpectedEntries.slice(0, 3).map((entry) => entry.path).join(', ');
    const hint = carryPaths.length === 0 ? ' If these are intentional task inputs, rerun with --carry <path...>.' : '';
    throw new Error(`Working tree is dirty. Commit or stash before starting a task.${hint} Dirty: ${sample}`);
  }
  if (!currentBranch || currentBranch !== defaultBranch) {
    throw new Error(`start-task must run from the default branch (${defaultBranch}); current: ${currentBranch || '(detached HEAD)'}`);
  }
  return carriedEntries;
}

export function parseWorktreeList(porcelain) {
  const list = [];
  let current = null;
  for (const line of String(porcelain).split('\n')) {
    if (line.startsWith('worktree ')) current = { path: line.slice('worktree '.length).trim(), branch: null, head: null };
    // `HEAD <oid>` is the worktree's local tip; prune compares it to a merged PR's
    // headRefOid so a lane with commits beyond what was merged is never deleted.
    else if (line.startsWith('HEAD ')) { if (current) current.head = line.slice('HEAD '.length).trim(); }
    else if (line.startsWith('branch ')) {
      if (current) current.branch = line.slice('branch refs/heads/'.length).trim();
    } else if (line === '' && current) { list.push(current); current = null; }
  }
  if (current) list.push(current);
  return list;
}

// Prune safety contract (#27 AC): remove ONLY worktrees that are
//   (a) not the primary checkout, (b) not the current checkout,
//   (c) not the default branch, (d) on an explicitly retired agent/* branch,
//   AND (e) clean (no uncommitted changes).
// Anything dirty is skipped and reported. Anything unretired is kept.
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

// GitHub PR merge signal for squash- and rebase-merges, which `git branch --merged`
// cannot see: those rewrite the lane's commits onto a NEW SHA on the default branch,
// so the lane is never an ancestor of it. CONSERVATIVE by construction — returns
// { merged: true } ONLY when ALL hold:
//   - no OPEN PR exists for the branch (an open PR always wins → keep), AND
//   - a MERGED PR exists whose base is the configured default branch, AND
//   - that PR's recorded head SHA (headRefOid) equals the lane's local tip,
//     proving the lane has no commits beyond what was merged.
// Every other shape (no PR, closed-unmerged, merged into a non-default base, local
// tip ahead of the merged head, or an unknown local tip) returns { merged: false }
// with a `reason` so the caller keeps the lane and can explain why. Never infers a
// merge from diffs/patch-ids — only from GitHub's own MERGED state.
export function classifyPrMergeSignal({ prs, defaultBranch, localTip }) {
  if (!Array.isArray(prs) || prs.length === 0) return { merged: false, reason: 'no-pr' };
  if (prs.some((p) => p?.state === 'OPEN')) return { merged: false, reason: 'open-pr' };
  const mergedIntoDefault = prs.filter((p) => p?.state === 'MERGED' && p?.baseRefName === defaultBranch);
  if (mergedIntoDefault.length === 0) {
    const mergedElsewhere = prs.some((p) => p?.state === 'MERGED');
    return { merged: false, reason: mergedElsewhere ? 'merged-non-default-base' : 'closed-unmerged' };
  }
  if (!localTip) return { merged: false, reason: 'tip-unknown' };
  const headMatch = mergedIntoDefault.some((p) => p?.headRefOid && p.headRefOid === localTip);
  if (!headMatch) return { merged: false, reason: 'tip-ahead-of-merged' };
  return { merged: true, reason: 'github-pr' };
}

export function classifyPruneRetirement({
  worktrees,
  ancestryMergedBranches = new Set(),
  prsByBranch = new Map(),
  defaultBranch,
  ghUnavailable = false,
}) {
  const retiredBranches = new Set();
  const keepReason = new Map();
  const retireReason = new Map();

  for (const wt of worktrees) {
    if (!wt.branch?.startsWith('agent/')) continue;
    if (ghUnavailable) {
      keepReason.set(wt.branch, ancestryMergedBranches.has(wt.branch) ? 'gh-unavailable-ancestry-only' : 'gh-unavailable');
      continue;
    }

    const signal = classifyPrMergeSignal({
      prs: prsByBranch.get(wt.branch) || [],
      defaultBranch,
      localTip: wt.head,
    });
    if (signal.merged) {
      retiredBranches.add(wt.branch);
      retireReason.set(wt.branch, signal.reason);
    } else {
      keepReason.set(wt.branch, signal.reason);
    }
  }

  return { retiredBranches, keepReason, retireReason };
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
export function primaryRootFromCommonDir(commonDir) {
  // `git rev-parse --path-format=absolute --git-common-dir` ends in /.git, but
  // git can emit backslash separators on Windows; accept either so the result
  // is the primary checkout root with no trailing separator.
  return String(commonDir).replace(/[\\/]?\.git([\\/].*)?$/, '');
}
export function checkStartupReadiness(baseline, { exists }) {
  const required = Array.isArray(baseline?.required) ? baseline.required : [];
  const expectedDirectories = Array.isArray(baseline?.expectedDirectories) ? baseline.expectedDirectories : [];
  const all = [...required, ...expectedDirectories];
  const present = [];
  const missing = [];
  for (const relPath of all) {
    if (exists(relPath)) present.push(relPath);
    else missing.push(relPath);
  }
  return { status: missing.length ? 'incomplete' : 'complete', present, missing };
}
export function formatStartupMap(baseline, { repoPath = '<repo>', archonSetupCommand = 'node bin/onboard.mjs', readiness = null } = {}) {
  const legacy = Array.isArray(baseline?.legacy) ? baseline.legacy : [];
  const lines = [
    'Agent startup map:',
    '- Document policy: docs/agent-process/document-policy.md',
    '- Message protocol: docs/agent-process/message-protocol.md',
    '- Plans:          docs/plans/',
    '- Agent process:  docs/agent-process/',
    '- Changelog:       CHANGELOG.md (follow this repo\'s changelog policy)',
    '- Check map:      .agent/check-map.yml',
    '- Coordination:   .agent/coordination/README.md',
    '- PR process:     .github/PULL_REQUEST_TEMPLATE.md',
    '- Agent scripts:  scripts/agent/',
    '- Close guards:   scripts/close/',
    '- Doc sweep:      scripts/doc-sweep/',
    '- Doc health:     scripts/doc-health/',
  ];
  if (legacy.length) lines.push(`- Legacy plans:   ${legacy.join(', ')} (history only)`);
  if (readiness?.missing?.length) lines.push('', `Missing startup baseline paths: ${readiness.missing.join(', ')}`);
  lines.push('', 'If these files are missing or unclear, stop searching and run (from a clone of ArchonVII/archon-setup):', `${archonSetupCommand} ${repoPath} --audit`);
  return lines.join('\n');
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

function ensureFinalNewline(value) {
  return value.endsWith('\n') ? value : `${value}\n`;
}

export function isPathInsideCarryPath(filePath, carryPath) {
  const normalizedFilePath = normalizeRepoRelativePath(filePath);
  const normalizedCarryPath = normalizeRepoRelativePath(carryPath);
  return normalizedFilePath === normalizedCarryPath || normalizedFilePath.startsWith(`${normalizedCarryPath}/`);
}
