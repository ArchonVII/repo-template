#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import {
  formatPrContractResult,
  loadPrFromGh,
  validatePrContract,
} from './pr-contract.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;

    const key = item.slice(2);
    if (key === 'json' || key === 'allow-ready' || key === 'skip-git') {
      args[key] = true;
      continue;
    }
    args[key] = argv[i + 1];
    i += 1;
  }
  return args;
}

function git(args, options = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', options.ignoreErrors ? 'ignore' : 'pipe'],
  }).trim();
}

function collectGitFailures({ expectedBranch }) {
  const failures = [];

  try {
    const status = git(['status', '--porcelain']);
    if (status) {
      failures.push('Working tree must be clean before close preflight.');
    }

    const branch = git(['branch', '--show-current']);
    if (expectedBranch && branch && branch !== expectedBranch) {
      failures.push(`Current branch \`${branch}\` does not match PR head branch \`${expectedBranch}\`.`);
    }

    let upstream = '';
    try {
      upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { ignoreErrors: true });
    } catch {
      upstream = '';
    }
    if (!upstream) {
      failures.push('Current branch has no upstream; push the branch before close preflight.');
    } else {
      const counts = git(['rev-list', '--left-right', '--count', '@{u}...HEAD']).split(/\s+/);
      const ahead = Number(counts[1] || 0);
      if (ahead > 0) {
        failures.push(`Current branch is ${ahead} commit(s) ahead of upstream; push before close preflight.`);
      }
    }
  } catch (err) {
    failures.push(`Could not inspect git state: ${err.message}`);
  }

  return failures;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  // A required value that is itself an option token means the caller wrote
  // e.g. `--pr --json`; treat it as missing rather than passing it to gh.
  const missing = (v) => !v || String(v).startsWith('--');
  if (missing(args.repo) || missing(args.pr)) {
    process.stderr.write('Usage: npm run agent:close-preflight -- --repo OWNER/REPO --pr <number>\n');
    process.exitCode = 2;
    return;
  }
  const pr = loadPrFromGh({ repo: args.repo, pr: args.pr });
  const contract = validatePrContract(pr, {
    branchPattern: args['branch-pattern'],
    docOnlyExtensions: args['doc-only-extensions'],
    docOnlyPathPrefixes: args['doc-only-path-prefixes'],
  });

  const failures = contract.errors.map((item) => `[${item.code}] ${item.message}`);
  if (!args['allow-ready'] && !pr.isDraft) {
    failures.push('PR is already ready for review; close preflight expects a draft PR before promotion.');
  }
  if (!args['skip-git']) {
    failures.push(...collectGitFailures({ expectedBranch: pr.branch }));
  }

  const ok = failures.length === 0;
  const payload = {
    ok,
    pr: {
      number: pr.number,
      url: pr.url,
      isDraft: pr.isDraft,
      branch: pr.branch,
    },
    contract,
    failures,
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatPrContractResult(contract)}\n`);
    if (failures.length > 0) {
      process.stdout.write('\nClose preflight failed:\n');
      for (const failure of failures) {
        process.stdout.write(`- ${failure}\n`);
      }
    } else {
      process.stdout.write('Close preflight passed.\n');
    }
  }

  process.exitCode = ok ? 0 : 1;
}

main();
