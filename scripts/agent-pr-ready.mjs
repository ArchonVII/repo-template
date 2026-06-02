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
    if (key === 'json' || key === 'dry-run') {
      args[key] = true;
      continue;
    }
    args[key] = argv[i + 1];
    i += 1;
  }
  return args;
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

  execFileSync('gh', ['pr', 'ready', String(pr.number), '--repo', args.repo], { stdio: 'inherit' });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatPrContractResult(result)}\nPromoted PR #${pr.number} to ready for review.\n`);
  }
}

main();
