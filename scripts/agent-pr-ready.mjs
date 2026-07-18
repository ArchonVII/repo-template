#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatPrContractResult,
  loadPrFromGh,
  validatePrContract,
} from './pr-contract.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;

    const key = item.slice(2);
    if (key === 'json' || key === 'dry-run') {
      args[key] = true;
      continue;
    }
    args[key] = argv[i + 1];
    i += 1;
  }
  return args;
}

// Run the close CI guard (scripts/close/ci-guard.mjs) for this PR. The guard
// verifies the close-scan marker is bound to the current HEAD and the required
// gate check is green on GitHub. AGENTS.md "Local Delivery Guards" requires it to
// pass before `agent:pr-ready`; gating here closes the gap where the wrapper could
// promote a draft before the guard ever ran (archon-setup#295). The guard is
// idempotent against HEAD, so running it once as the promotion gate is safe.
// Returns { ok, output }; a non-zero exit (failed / CI not green / stale marker)
// yields ok:false.
function runCloseCiGuard({ repo, pr, requiredCheck }) {
  const guardArgs = [join(SCRIPT_DIR, 'close', 'ci-guard.mjs'), '--repo', repo, '--pr', String(pr)];
  if (requiredCheck) guardArgs.push('--required-check', requiredCheck);
  try {
    const output = execFileSync(process.execPath, guardArgs, { encoding: 'utf8' });
    return { ok: true, output };
  } catch (err) {
    const output = [err.stdout, err.stderr].filter(Boolean).join('\n').trim();
    return { ok: false, output };
  }
}

function promotePr({ repo, pr }) {
  execFileSync('gh', ['pr', 'ready', String(pr), '--repo', repo], { stdio: 'inherit' });
}

export function runAgentPrReady(argv, {
  loadPr = loadPrFromGh,
  validate = validatePrContract,
  format = formatPrContractResult,
  runGuard = runCloseCiGuard,
  promote = promotePr,
  writeStdout = (value) => process.stdout.write(value),
  writeStderr = (value) => process.stderr.write(value),
} = {}) {
  const args = parseArgs(argv);
  // A required value that is itself an option token means the caller wrote
  // e.g. `--pr --json`; treat it as missing rather than passing it to gh.
  const missing = (v) => !v || String(v).startsWith('--');
  if (missing(args.repo) || missing(args.pr)) {
    writeStderr('Usage: npm run agent:pr-ready -- --repo OWNER/REPO --pr <number>\n');
    return 2;
  }
  const pr = loadPr({ repo: args.repo, pr: args.pr });
  const result = validate(pr, {
    branchPattern: args['branch-pattern'],
    docOnlyExtensions: args['doc-only-extensions'],
    docOnlyPathPrefixes: args['doc-only-path-prefixes'],
  });

  const payload = {
    ok: result.ok,
    ready: false,
    dryRun: Boolean(args['dry-run']),
    pr: {
      number: pr.number,
      url: pr.url,
      isDraft: pr.isDraft,
      branch: pr.branch,
    },
    contract: result,
  };

  if (!result.ok) {
    if (args.json) {
      writeStdout(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      writeStderr(`${format(result)}\n`);
      writeStderr('\nRefusing to run `gh pr ready`; fix the PR contract first.\n');
    }
    return 1;
  }

  // Preserve the normal no-op for an already-ready PR. A dry-run still checks
  // the guard below because its promise is a current-HEAD promotion preview.
  if (!args['dry-run'] && !pr.isDraft) {
    if (args.json) {
      writeStdout(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      writeStdout(`${format(result)}\nPR #${pr.number} is already ready for review.\n`);
    }
    return 0;
  }

  // Gate both real promotion and its dry-run preview on close CI evidence for
  // the current HEAD. The guard is idempotent against an unchanged HEAD.
  const guard = runGuard({ repo: args.repo, pr: pr.number, requiredCheck: args['required-check'] });
  payload.ciGuard = { ok: guard.ok };
  if (!guard.ok) {
    payload.ok = false;
    payload.ready = false;
    if (args.json) {
      writeStdout(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      if (guard.output) writeStderr(`${guard.output}\n`);
      const prefix = args['dry-run'] ? 'Dry run refused' : 'Refusing to run `gh pr ready`';
      writeStderr(`\n${prefix}: close:ci:guard must pass for the current HEAD first (run \`npm run close:ci:guard -- --repo ${args.repo} --pr ${pr.number}\`).\n`);
    }
    return 1;
  }

  if (args['dry-run']) {
    if (args.json) {
      writeStdout(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      writeStdout(`${format(result)}\nDry run: close CI guard passed for the current HEAD; would promote PR #${pr.number}.\n`);
    }
    return 0;
  }

  promote({ repo: args.repo, pr: pr.number });
  payload.ready = true;

  if (args.json) {
    writeStdout(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    writeStdout(`${format(result)}\nPromoted PR #${pr.number} to ready for review.\n`);
  }
  return 0;
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  process.exitCode = runAgentPrReady(process.argv.slice(2));
}
