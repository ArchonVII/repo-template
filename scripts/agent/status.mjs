// scripts/agent/status.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseIssueFromBranch, parseGitStatusPorcelain, detectClaimsInstalled, inferNextAction, formatStatusReport, checkStartupReadiness, formatStartupMap } from './lib.mjs';

const checkoutRoot = git(['rev-parse', '--show-toplevel']);

const branch = git(['branch', '--show-current']) || '(detached)';
const defaultBranch = ghOrNull(['repo', 'view', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name']) || 'main';
const upstream = gitOrNull(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
const statusEntries = parseGitStatusPorcelain(git(['status', '--porcelain=1', '-z'], { trim: false }));
const ahead = upstream ? Number(gitOrNull(['rev-list', '--count', `${upstream}..HEAD`]) || 0) : 0;
const prRaw = ghOrNull(['pr', 'view', '--json', 'number,url,state']);
const pr = prRaw ? JSON.parse(prRaw) : null;
// Claims live under .agent/coordination/claims/ per the coordination contract
// (.agent/coordination/README.md), not at a top-level .agent/claims.json.
// Resolve them against the current worktree, not the primary checkout's root
// (--git-common-dir): claims are per-worktree state, and doc-sweep's loader
// reads them from the worktree being inspected the same way.
const claimsInstalled = detectClaimsInstalled({ claimsFileExists: fs.existsSync(path.join(checkoutRoot, '.agent', 'coordination', 'claims')) });

console.log(formatStatusReport({
  branch, defaultBranch, upstream, pr, issue: parseIssueFromBranch(branch),
  dirty: statusEntries.length > 0, dirtyCount: statusEntries.length,
  worktreePath: checkoutRoot, claimsInstalled,
  nextAction: inferNextAction({ onDefaultBranch: branch === defaultBranch, dirty: statusEntries.length > 0, hasPr: Boolean(pr), ahead }),
}));
const startupBaseline = readStartupBaseline(checkoutRoot);
if (startupBaseline) {
  const readiness = checkStartupReadiness(startupBaseline, {
    exists: (relPath) => fs.existsSync(path.join(checkoutRoot, relPath)),
  });
  console.log('\n' + formatStartupMap(startupBaseline, {
    repoPath: checkoutRoot,
    archonSetupCommand: 'node <path-to-archon-setup>/bin/onboard.mjs',
    readiness,
  }));
}
if (!ghAvailable()) console.log('\n(note: `gh` unavailable — PR/default-branch info degraded)');

function git(a, o = {}) { const out = execFileSync('git', a, { cwd: process.cwd(), encoding: 'utf8' }); return o.trim === false ? out : out.trim(); }
function gitOrNull(a) { try { return git(a); } catch { return null; } }
function ghOrNull(a) { try { return execFileSync('gh', a, { cwd: process.cwd(), encoding: 'utf8' }).trim(); } catch { return null; } }
function ghAvailable() { try { execFileSync('gh', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } }
function readStartupBaseline(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, '.agent', 'startup-baseline.json'), 'utf8')); }
  catch { return null; }
}
