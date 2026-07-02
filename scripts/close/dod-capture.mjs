#!/usr/bin/env node
// Incremental closeout-DoD capture (#124 S2). Record each of the four DoD
// decisions (docs, changelog, verification, findings) AS IT IS MADE during the
// session — the capture lives in .agent/close-scan/dod.json (gitignored) and
// survives reboots/context loss; close:scan:complete folds it into the
// HEAD-bound marker as defaults. Capturing also refreshes the lane's task
// claim (.agent/current-task.json lastActivityAt) — the coordination bookend:
// active closeout work keeps the lane claimed against doc-sweep recovery.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOD_SECTIONS, writeDodSection } from './lib.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    if (key === 'json') {
      args[key] = true;
      continue;
    }
    args[key] = argv[i + 1];
    i += 1;
  }
  return args;
}

// The bookend refresh: a live current-task.json IS the doc-sweep claim
// (#124 S2); each captured decision extends its liveness window.
export function refreshTaskClaim(root, { timestamp = new Date().toISOString() } = {}) {
  const taskPath = join(root, '.agent', 'current-task.json');
  if (!existsSync(taskPath)) return false;
  let task;
  try {
    task = JSON.parse(readFileSync(taskPath, 'utf8'));
  } catch {
    return false; // unreadable task metadata is not this command's problem
  }
  task.lastActivityAt = timestamp;
  writeFileSync(taskPath, `${JSON.stringify(task, null, 2)}\n`);
  return true;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const section = args.section || '';
  const decision = args.decision || '';

  let head = null;
  try {
    head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    head = null; // pre-first-commit lanes still get to capture decisions
  }

  let capture;
  try {
    capture = writeDodSection(root, section, decision, { head });
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.stderr.write(`Usage: npm run close:dod -- --section <${DOD_SECTIONS.join('|')}> --decision "<substantive text>"\n`);
    process.exitCode = 1;
    return;
  }
  const claimRefreshed = refreshTaskClaim(root);

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, section, capture, claimRefreshed }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`Captured DoD ${section} @ ${head ? head.slice(0, 7) : '(no HEAD)'}${claimRefreshed ? ' (task claim refreshed)' : ''}\n`);
  for (const name of DOD_SECTIONS) {
    const entry = capture.sections[name];
    process.stdout.write(`  ${entry ? 'x' : ' '} ${name}${entry ? `: ${entry.decision}` : ''}\n`);
  }
  const remaining = DOD_SECTIONS.filter((name) => !capture.sections[name]);
  if (remaining.length) {
    process.stdout.write(`Pending sections: ${remaining.join(', ')} (scan-complete derives scope defaults for some).\n`);
  }
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main();
}
