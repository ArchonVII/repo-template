// scripts/wiki/doctor.mjs
//
// The navigation checksum. Verifies the agent-neutral contract has not drifted:
// AGENTS.md points at the canon docs, llms.txt lists the required first-reads,
// every wiki:* command is wired + present, and no hook config calls a missing
// command. Deterministic; exits non-zero on any failure. Rules: docs/LIBRARIAN.md.
//
// AGENTS.md is the single agent contract; CLAUDE.md / GEMINI.md are optional
// per-tool adapters, so their checks are CONDITIONAL (only enforced if the file
// exists, and then it must point back at AGENTS.md). AGENTS.md itself is always
// required to point at the canon docs.

import fs from 'node:fs';
import path from 'node:path';
import { repoRoot, readIfExists, REQUIRED_FIRST_READS, WIKI_COMMANDS, SCHEMA_VERSION, parseFlags } from './lib.mjs';

const root = repoRoot();
parseFlags(process.argv.slice(2)); // accept --agent etc.; doctor output is caller-independent
const errors = [];
const ok = [];

function check(label, condition, detail) {
  if (condition) ok.push(label);
  else errors.push(detail || label);
}

// 1. AGENTS.md points at the canon docs (always required).
const agents = readIfExists(path.join(root, 'AGENTS.md')) || '';
check('AGENTS.md references docs/LIBRARIAN.md', agents.includes('docs/LIBRARIAN.md'),
  'AGENTS.md does not reference docs/LIBRARIAN.md');
check('AGENTS.md references docs/CANON.md', agents.includes('docs/CANON.md'),
  'AGENTS.md does not reference docs/CANON.md');

// 2. Per-tool adapters are OPTIONAL here, but if present must point at AGENTS.md.
const claude = readIfExists(path.join(root, 'CLAUDE.md'));
if (claude !== null) {
  check('CLAUDE.md points to AGENTS.md', claude.includes('AGENTS.md'),
    'CLAUDE.md exists but does not point to AGENTS.md');
}
const gemini = readIfExists(path.join(root, 'GEMINI.md'));
if (gemini !== null) {
  check('GEMINI.md points to AGENTS.md', gemini.includes('AGENTS.md'),
    'GEMINI.md exists but does not point to AGENTS.md');
}

// 3. llms.txt lists every required first-read.
const llms = readIfExists(path.join(root, 'llms.txt')) || '';
for (const f of REQUIRED_FIRST_READS) {
  check(`llms.txt lists ${f}`, llms.includes(f), `llms.txt is missing required first-read: ${f}`);
}

// 4. package.json exposes every wiki:* script and the script file exists.
let pkgScripts = {};
try { pkgScripts = JSON.parse(readIfExists(path.join(root, 'package.json')) || '{}').scripts || {}; } catch { /* reported below */ }
for (const cmd of WIKI_COMMANDS) {
  check(`package.json has wiki:${cmd}`, Boolean(pkgScripts[`wiki:${cmd}`]),
    `package.json is missing script: wiki:${cmd}`);
  const scriptFile = path.join(root, 'scripts', 'wiki', `${cmd}.mjs`);
  check(`scripts/wiki/${cmd}.mjs exists`, fs.existsSync(scriptFile),
    `missing script file: scripts/wiki/${cmd}.mjs`);
}

// 5. Every hook config calls only existing wiki:* commands (prefix-agnostic: matches
//    both `npm run wiki:x` and `pnpm wiki:x`).
const hookConfigs = ['.claude/settings.json', '.codex/hooks.json', '.gemini/settings.json'];
for (const rel of hookConfigs) {
  const text = readIfExists(path.join(root, rel));
  if (text === null) continue; // adapter is optional
  const referenced = new Set();
  for (const m of text.matchAll(/wiki:([a-z][a-z-]*)/g)) referenced.add(m[1]);
  for (const cmd of referenced) {
    check(`${rel} -> wiki:${cmd} is valid`, WIKI_COMMANDS.includes(cmd) && Boolean(pkgScripts[`wiki:${cmd}`]),
      `${rel} calls unknown or unwired command: wiki:${cmd}`);
  }
}

// --- Report ---
console.log('wiki:doctor — navigation checksum');
console.log(`  Librarian schema v${SCHEMA_VERSION}`); // informational drift signal, not a gate
console.log(`  passed: ${ok.length}`);
if (errors.length) {
  console.error(`  FAILED: ${errors.length}`);
  for (const e of errors) console.error(`    - ${e}`);
  console.error('\nThe contract has drifted. See docs/LIBRARIAN.md "navigation checksum".');
  process.exit(1);
}
console.log('  All contract checks passed.');
