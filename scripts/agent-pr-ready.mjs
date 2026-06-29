#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
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
    if (key === 'json' || key === 'dry-run' || key === 'skip-ci-guard') {
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const pr = loadPrFromGh({ repo: args.repo, pr: args.pr });
  const result = validatePrContract(pr, {
    branchPattern: args['branch-pattern'],
    docOnlyExtensions: args['doc-only-extensions'],
    docOnlyPathPrefixes: args['doc-only-path-prefixes'],
  });

  const payload = {
    ok: result.ok,
    ready: result.ok && !args['dry-run'],
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
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      process.stderr.write(`${formatPrContractResult(result)}\n`);
      process.stderr.write('\nRefusing to run `gh pr ready`; fix the PR contract first.\n');
    }
    process.exitCode = 1;
    return;
  }

  if (args['dry-run']) {
    if (args.json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      process.stdout.write(`${formatPrContractResult(result)}\nDry run: would promote PR #${pr.number}.\n`);
    }
    return;
  }

  if (!pr.isDraft) {
    payload.ready = false;
    if (args.json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      process.stdout.write(`${formatPrContractResult(result)}\nPR #${pr.number} is already ready for review.\n`);
    }
    return;
  }

  // Gate promotion on the close CI guard unless the caller asserts it already
  // passed for this HEAD (--skip-ci-guard; the guard is idempotent per HEAD, so the
  // documented run-once flow can opt out). Default is to verify (archon-setup#295).
  if (!args['skip-ci-guard']) {
    const guard = runCloseCiGuard({ repo: args.repo, pr: pr.number, requiredCheck: args['required-check'] });
    payload.ciGuard = { ok: guard.ok };
    if (!guard.ok) {
      payload.ready = false;
      if (args.json) {
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      } else {
        if (guard.output) process.stderr.write(`${guard.output}\n`);
        process.stderr.write('\nRefusing to run `gh pr ready`: close:ci:guard must pass for the current HEAD first (run `npm run close:ci:guard`, or pass --skip-ci-guard if you already ran it for this HEAD).\n');
      }
      process.exitCode = 1;
      return;
    }
  }

  execFileSync('gh', ['pr', 'ready', String(pr.number), '--repo', args.repo], { stdio: 'inherit' });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatPrContractResult(result)}\nPromoted PR #${pr.number} to ready for review.\n`);
  }
}

main();
