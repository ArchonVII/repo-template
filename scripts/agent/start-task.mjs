// scripts/agent/start-task.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sanitizeSlug, buildBranchName, parseGitStatusPorcelain, assertCheckoutIsSafe } from './lib.mjs';

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
  return git(['for-each-ref', '--format=%(refname:short)', 'refs/heads/agent'])
    .split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .filter((l) => new RegExp(`^agent/[^/]+/${issueNumber}-`).test(l));
}
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) if (argv[i].startsWith('--')) { out[argv[i].slice(2)] = argv[i + 1]; i += 1; }
  return out;
}
function fail(m) { console.error(m); process.exit(1); }
