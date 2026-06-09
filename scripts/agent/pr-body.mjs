// scripts/agent/pr-body.mjs
// Print the committed PR template with the linked issue filled in, to STDOUT.
// No file is written — pipe it: `npm run agent:pr-body -- 58 | gh pr create --body-file -`
// or `gh pr edit <n> --body-file -`. Replaces the old worktree-local .pr-body.md,
// which dirtied the working tree and collided with clean-tree close/preflight gates.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseIssueFromBranch, populatePrBodyTemplate } from './lib.mjs';

const checkoutRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd(), encoding: 'utf8' }).trim();

const templatePath = path.join(checkoutRoot, '.github', 'PULL_REQUEST_TEMPLATE.md');
if (!fs.existsSync(templatePath)) {
  console.error('No .github/PULL_REQUEST_TEMPLATE.md in this repo; nothing to fill. Write the PR body by hand.');
  process.exit(1);
}

const issue = resolveIssue(process.argv[2]);
const template = fs.readFileSync(templatePath, 'utf8');
// populatePrBodyTemplate is a no-op fill when issue is null — emits the raw template.
process.stdout.write(populatePrBodyTemplate(template, { issue }));

// Resolve the issue number from an explicit arg, the task metadata, then the branch name.
function resolveIssue(arg) {
  if (arg && /^\d+$/.test(arg)) return arg;

  const taskFile = path.join(checkoutRoot, '.agent', 'current-task.json');
  if (fs.existsSync(taskFile)) {
    try {
      const issue = JSON.parse(fs.readFileSync(taskFile, 'utf8')).issue;
      if (issue) return String(issue);
    } catch { /* fall through to branch parsing */ }
  }

  try {
    const branch = execFileSync('git', ['branch', '--show-current'], { cwd: checkoutRoot, encoding: 'utf8' }).trim();
    return parseIssueFromBranch(branch);
  } catch { return null; }
}
