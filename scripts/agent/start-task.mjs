// scripts/agent/start-task.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { cleanupVerifiedCarry, copyCarryPathsAndVerify } from './carry.mjs';
import { PRECISE_STATUS_ARGS, sanitizeSlug, buildBranchName, parseGitStatusPorcelain, parseStartTaskArgs, toCheckoutRelativePath, minimizeCarryPaths, collectCarriedStatusEntries, isPathInsideCarryPath, assertCheckoutIsSafe, filterIssueBranches } from './lib.mjs';

const DEFAULT_AGENT = 'codex';
const [, , issueArg, ...rest] = process.argv;
let args;
try { args = parseStartTaskArgs(rest); }
catch (error) { fail(`${error.message}\n${usage()}`); }

if (!issueArg || !/^\d+$/.test(issueArg)) {
  fail(usage());
}

// Bootstrap the checkout root directly (do not route through git() — it depends on this value).
const checkoutRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd(), encoding: 'utf8' }).trim();
const repoName = path.basename(checkoutRoot);
const agent = args.agent || DEFAULT_AGENT;

const issue = JSON.parse(gh(['issue', 'view', issueArg, '--json', 'number,title,url,state']));
if (issue.state !== 'OPEN') fail(`Issue #${issueArg} is not open (state: ${issue.state}).`);

const defaultBranch = gh(['repo', 'view', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name']);
git(['fetch', 'origin', defaultBranch]);

const statusEntries = parseGitStatusPorcelain(git([...PRECISE_STATUS_ARGS], { trim: false }));
const carryPaths = resolveCarryPaths(args.carry, statusEntries);

try {
  assertCheckoutIsSafe({
    statusEntries,
    currentBranch: git(['branch', '--show-current']),
    defaultBranch,
    carryPaths,
  });
} catch (error) { fail(error.message); }

const slug = sanitizeSlug(args.slug || issue.title) || fail('Could not derive a slug; pass --slug <value>.');
const branchName = buildBranchName(agent, issueArg, slug);
const worktreePath = path.join(path.dirname(checkoutRoot), `${repoName}-${issueArg}-${slug}`);

if (existingIssueBranches(issueArg).length) fail(`Issue #${issueArg} already has a branch.`);
if (branchExists(branchName)) fail(`Branch already exists: ${branchName}`);
if (fs.existsSync(worktreePath)) fail(`Worktree path already exists: ${worktreePath}`);

git(['worktree', 'add', '-b', branchName, worktreePath, `origin/${defaultBranch}`]);

if (carryPaths.length > 0) transplantCarryPaths({ carryPaths, worktreePath });

// Install dependencies in the fresh worktree so a node-stack agent can run tests
// immediately (archon-setup#292). node_modules is gitignored, so a new worktree has
// none until a manual `npm ci`. Gate on a lockfile (non-node repos and npm-less
// environments are untouched) and keep it NON-FATAL — a failed/slow install must
// not abort task setup; the agent can still run `npm ci` by hand.
installWorktreeDeps(worktreePath);

// Initial task metadata (#27 AC). Runtime file, gitignored. Written into the NEW worktree.
const metadata = {
  issue: issue.number, title: issue.title, url: issue.url,
  branch: branchName, agent, defaultBranch, createdAt: new Date().toISOString(),
};
fs.mkdirSync(path.join(worktreePath, '.agent'), { recursive: true });
fs.writeFileSync(path.join(worktreePath, '.agent', 'current-task.json'), JSON.stringify(metadata, null, 2) + '\n');

console.log(`Ready to implement #${issue.number}: ${issue.title}`);
console.log(`Branch:   ${branchName}`);
console.log(`Worktree: ${worktreePath}`);
if (carryPaths.length > 0) console.log(`Carried:  ${carryPaths.join(', ')}`);
console.log('\nNext steps:');
console.log(`  1. cd "${worktreePath}"`);
console.log('  2. npm run agent:status');
console.log(`  3. npm run agent:pr-body -- ${issue.number}  # filled PR body to stdout; pipe into gh pr create/edit --body-file -`);
console.log('  4. open a draft PR from that body (jma-git-pr-lifecycle)');

// ---- I/O helpers ----
function git(a, o = {}) { const out = execFileSync('git', a, { cwd: checkoutRoot, encoding: 'utf8' }); return o.trim === false ? out : out.trim(); }
function gh(a) {
  try { return execFileSync('gh', a, { cwd: checkoutRoot, encoding: 'utf8' }).trim(); }
  catch { return fail('`gh` is required for start-task (issue lookup + default branch). Install/authenticate gh, or create the worktree manually per AGENTS.md.'); }
}
function branchExists(b) { try { git(['show-ref', '--verify', '--quiet', `refs/heads/${b}`]); return true; } catch { return false; } }
function existingIssueBranches(issueNumber) {
  // Scan BOTH local heads and remote-tracking refs so a retired/merged head for
  // the same issue — local copy pruned, branch still on origin — is still
  // detected and its name is not silently reused (archon-setup#295).
  const refs = git(['for-each-ref', '--format=%(refname:short)', 'refs/heads/agent', 'refs/remotes'])
    .split(/\r?\n/);
  return filterIssueBranches(refs, issueNumber);
}
// Lockfile-gated, non-fatal dependency install for a freshly created worktree
// (archon-setup#292). Mirrors scripts/close/scan-complete.mjs: npm is a .cmd shim
// on Windows that execFile cannot run directly, so route through cmd.exe there.
function installWorktreeDeps(wt) {
  if (!fs.existsSync(path.join(wt, 'package-lock.json'))) return;
  const isWin = process.platform === 'win32';
  const command = isWin ? 'cmd.exe' : 'npm';
  const cmdArgs = isWin ? ['/d', '/s', '/c', 'npm ci'] : ['ci'];
  try {
    console.log('Installing dependencies in the new worktree (npm ci)...');
    execFileSync(command, cmdArgs, { cwd: wt, stdio: 'inherit' });
  } catch (error) {
    console.warn(`[start-task] npm ci failed (non-fatal): ${error.message}`);
    console.warn('[start-task] Run `npm ci` manually in the worktree if you need dependencies.');
  }
}

function resolveCarryPaths(rawCarryPaths, statusEntries) {
  const resolved = minimizeCarryPaths(rawCarryPaths.map((rawPath) => {
    try {
      return toCheckoutRelativePath(rawPath, { checkoutRoot, baseDir: process.cwd() });
    } catch (error) { fail(error.message); }
  }));
  const carriedEntries = collectCarriedStatusEntries({ statusEntries, carryPaths: resolved }).carriedEntries;
  for (const relativePath of resolved) {
    const absolutePath = path.join(checkoutRoot, relativePath);
    try {
      fs.lstatSync(absolutePath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const representsCarriedAbsence = carriedEntries.some((entry) => (
        isPathInsideCarryPath(entry.path, relativePath)
        || (entry.originalPath && isPathInsideCarryPath(entry.originalPath, relativePath))
      ));
      if (!representsCarriedAbsence) {
        fail(`Carry path not found: ${relativePath}. Paths with spaces must be quoted.`);
      }
    }
  }
  return resolved;
}

function transplantCarryPaths({ carryPaths, worktreePath }) {
  try {
    copyCarryPathsAndVerify({ checkoutRoot, worktreePath, carryPaths });
  } catch (error) {
    fail(`Carry copy failed; the source checkout was not cleaned. ${error.message}`);
  }

  try {
    cleanupVerifiedCarry({ checkoutRoot, carryPaths });
  } catch (error) {
    fail(`Carry cleanup failed after destination verification. The verified copy is in ${worktreePath}; recover the source from there if needed. ${error.message}`);
  }
}

function usage() {
  return 'Usage: npm run agent:start-task -- <issue-number> [--agent <name>] [--slug <slug>] [--carry <path...>]';
}
function fail(m) { console.error(m); process.exit(1); }
