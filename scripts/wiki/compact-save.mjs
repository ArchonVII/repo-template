// scripts/wiki/compact-save.mjs
//
// Run before context compression (PreCompact / PreCompress). Appends a compact-safe
// marker to the ops log and prints a crystallization reminder so durable knowledge is
// captured before the window shrinks. Fail-open — never blocks. Source: docs/LIBRARIAN.md.

import { repoRoot, parseFlags, appendLog } from './lib.mjs';

const root = repoRoot();
const { agent } = parseFlags(process.argv.slice(2));

appendLog(root, `## [${new Date().toISOString().slice(0, 10)}] compact-save | agent=${agent}`);

console.log('wiki:compact-save — before compaction:');
console.log('  - Capture durable facts to docs/memory/ (see CLAUDE.md memory rules).');
console.log('  - Move any unresolved question into docs/audits/.');
console.log('  - Run `npm run wiki:crystallize` if a work-chain just completed.');
console.log('  (Hooks never commit; durable capture lands through the normal PR / close flow.)');
