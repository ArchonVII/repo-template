// scripts/agent/start-task.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sanitizeSlug, buildBranchName, parseGitStatusPorcelain, assertCheckoutIsSafe, filterIssueBranches } from './lib.mjs';

const DEFAULT_AGENT = 'codex';
const [, , issueArg, ...rest] = process.argv;
const args = parseArgs(rest);

if (!issueArg || !/^\d+$/.test(issueArg)) {
  fail('Usage: npm run agent:start-task -- <issue-number> [--agent <name>] [--slug <slug>]');
}

// Bootstrap the checkout root directly (do not route through git() — it depends on this value).
const checkoutRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd(), encoding: 'utf8' }).trim();
const repoName = path.basename(checkoutRoot);
const agent = args.agent || DEFAULT_AGENT;

const issue = JSON.parse(gh(['issue', 'view', issueArg, '--json', 'number,title,url,state']));
if (issue.state !== 'OPEN') fail(`Issue #${issueArg} is not open (state: ${issue.state}).`);

const defaultBranch = gh(['repo', 'view', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name']);

try {
  assertCheckoutIsSafe({
    statusEntries: parseGitStatusPorcelain(git(['status', '--porcelain=1', '-z'], { trim: false })),
    currentBranch: git(['branch', '--show-current']),
    defaultBranch,
  });
} catch (error) { fail(error.message); }

git(['fetch', 'origin', defaultBranch]);

const slug = sanitizeSlug(args.slug || issue.title) || fail('Could not derive a slug; pass --slug <value>.');
const branchName = buildBranchName(agent, issueArg, slug);
const worktreePath = path.join(path.dirname(checkoutRoot), `${repoName}-${issueArg}-${slug}`);

if (existingIssueBranches(issueArg).length) fail(`Issue #${issueArg} already has a branch.`);
if (branchExists(branchName)) fail(`Branch already exists: ${branchName}`);
if (fs.existsSync(worktreePath)) fail(`Worktree path already exists: ${worktreePath}`);

git(['worktree', 'add', '-b', branchName, worktreePath, `origin/${defaultBranch}`]);

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
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) if (argv[i].startsWith('--')) { out[argv[i].slice(2)] = argv[i + 1]; i += 1; }
  return out;
}
function fail(m) { console.error(m); process.exit(1); }
