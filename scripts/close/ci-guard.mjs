#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import {
  formatPrContractResult,
  validatePrContract,
} from '../pr-contract.mjs';
import {
  DEFAULT_REQUIRED_GATE,
  evaluateCloseScanMarker,
  evaluateRequiredChecks,
  markerPath,
  readCloseScanMarker,
} from './lib.mjs';

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

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', options.ignoreErrors ? 'ignore' : 'pipe'],
  }).trim();
}

function git(args, options = {}) {
  return run('git', args, options);
}

function loadPr({ repo, pr }) {
  if (!repo) throw new Error('Missing required --repo owner/name argument.');
  if (!pr) throw new Error('Missing required --pr number argument.');
  const raw = run('gh', [
    'pr',
    'view',
    String(pr),
    '--repo',
    repo,
    '--json',
    'number,title,body,headRefName,files,url',
  ]);
  const parsed = JSON.parse(raw);
  return {
    number: parsed.number,
    title: parsed.title || '',
    body: parsed.body || '',
    branch: parsed.headRefName || '',
    files: (parsed.files || []).map((file) => file.path || file.filename).filter(Boolean),
    url: parsed.url || '',
  };
}

function loadChecks({ repo, pr }) {
  const raw = run('gh', [
    'pr',
    'checks',
    String(pr),
    '--repo',
    repo,
    '--json',
    'name,state,link',
  ]);
  return JSON.parse(raw);
}

function collectGitInfo() {
  const branch = git(['branch', '--show-current']);
  const head = git(['rev-parse', 'HEAD']);
  let upstream = null;
  let upstreamHead = null;
  try {
    upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { ignoreErrors: true }) || null;
    upstreamHead = upstream ? git(['rev-parse', '@{u}'], { ignoreErrors: true }) || null : null;
  } catch {
    upstream = null;
    upstreamHead = null;
  }
  return { branch, head, upstream, upstreamHead };
}

function printResult(payload, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  if (payload.ok) {
    process.stdout.write('Close CI guard passed.\n');
    const outcome = payload.requiredCheck.matched.conclusion
      || payload.requiredCheck.matched.state
      || payload.requiredCheck.matched.status
      || 'unknown';
    process.stdout.write(`Required check: ${payload.requiredCheck.matched.name} (${outcome})\n`);
    return;
  }
  process.stdout.write('Close CI guard failed:\n');
  for (const failure of payload.failures) {
    process.stdout.write(`- ${failure}\n`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = git(['rev-parse', '--show-toplevel']);
  process.chdir(root);

  const pr = loadPr({ repo: args.repo, pr: args.pr });
  const gitInfo = collectGitInfo();
  const marker = readCloseScanMarker(markerPath(root));
  const markerResult = evaluateCloseScanMarker({
    marker,
    git: gitInfo,
    pr,
    requireUpstreamIdentity: true,
  });
  const contract = validatePrContract({
    title: pr.title,
    body: pr.body,
    branch: pr.branch,
    files: pr.files,
  });
  let checks = [];
  let checksLoadFailure = null;
  try {
    checks = loadChecks({ repo: args.repo, pr: args.pr });
  } catch (err) {
    checksLoadFailure = `Could not load PR checks from GitHub: ${err.message}`;
  }
  const requiredCheck = evaluateRequiredChecks({
    checkRuns: checks,
    requiredCheckName: args['required-check'] || DEFAULT_REQUIRED_GATE,
  });
  const failures = [
    ...markerResult.failures,
    ...contract.errors.map((item) => `[${item.code}] ${item.message}`),
    ...(checksLoadFailure ? [checksLoadFailure] : []),
    ...requiredCheck.failures,
  ];
  const ok = failures.length === 0;

  printResult({
    ok,
    failures,
    pr: { number: pr.number, url: pr.url, branch: pr.branch },
    git: gitInfo,
    markerPath: markerPath(root),
    marker: marker ? { timestamp: marker.timestamp, head: marker.git?.head } : null,
    contract: {
      ok: contract.ok,
      summary: formatPrContractResult(contract),
    },
    requiredCheck,
  }, args.json);
  process.exitCode = ok ? 0 : 1;
}

main();
