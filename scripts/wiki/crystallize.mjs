// scripts/wiki/crystallize.mjs
//
// Orchestrator: runs at session/subagent end. Lists the branch's work-chain (recent
// commits) as crystallization candidates and prints the checklist. The agent writes the
// durable facts to docs/memory/ and unresolved questions to docs/audits/. Fail-open and
// never commits. Source: docs/LIBRARIAN.md "Crystallize a session".

import { execFileSync } from 'node:child_process';
import { repoRoot, parseFlags, appendLog } from './lib.mjs';

const root = repoRoot();
const { agent, subagent, failOpen } = parseFlags(process.argv.slice(2));

let commits = [];
try {
  const out = execFileSync('git', ['log', '--oneline', '-15', 'origin/main..HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  commits = out ? out.split('\n') : [];
} catch {
  try {
    commits = execFileSync('git', ['log', '--oneline', '-10'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
  } catch { commits = []; }
}

appendLog(root, `## [${new Date().toISOString().slice(0, 10)}] crystallize | agent=${agent} | commits=${commits.length}`);

// Hook context (--fail-open): stay quiet so per-turn Stop/SubagentStop hooks don't spam.
// Just nudge once, with the work-chain size, and exit.
if (failOpen) {
  console.log(`wiki:crystallize: ${commits.length} commits on this branch — run 'npm run wiki:crystallize' to file durable facts before wrapping up.`);
  process.exit(0);
}

console.log(`wiki:crystallize — agent=${agent}${subagent ? ' (subagent)' : ''}`);
console.log(`\n  Work-chain (${commits.length} commits):`);
for (const c of commits.slice(0, 15)) console.log(`    ${c}`);

console.log('\n  Crystallize checklist (you perform this — hooks never commit):');
console.log('    1. Distill durable lessons into docs/memory/ (one fact per file; see CLAUDE.md memory rules).');
console.log('    2. Add a MEMORY.md pointer line for each new fact.');
console.log('    3. Open any unresolved question as a file in docs/audits/.');
console.log('    4. If a decision changed repo ground truth, update docs/CANON.md via the PR.');
