#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  formatPrContractResult,
  validatePrContract,
} from '../pr-contract.mjs';
import {
  buildCloseScanMarker,
  classifyCloseScanScope,
  evaluateChangelogDecision,
  extractChangelogFragment,
  isSubstantiveDecision,
  listHookShellFiles,
  listWorkflowFiles,
  markerPath,
  writeCloseScanMarker,
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
    'number,title,body,headRefName,baseRefName,isDraft,files,url,labels',
  ]);
  const parsed = JSON.parse(raw);
  return {
    number: parsed.number,
    title: parsed.title || '',
    body: parsed.body || '',
    branch: parsed.headRefName || '',
    base: parsed.baseRefName || 'main',
    isDraft: Boolean(parsed.isDraft),
    files: (parsed.files || []).map((file) => file.path || file.filename).filter(Boolean),
    labels: (parsed.labels || []).map((label) => label.name || label).filter(Boolean),
    url: parsed.url || '',
  };
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

function collectChangedFiles({ base, fallbackFiles }) {
  try {
    const raw = git(['diff', '--name-only', '--diff-filter=ACMRT', `${base}...HEAD`], { ignoreErrors: true });
    const files = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (files.length > 0) return files;
  } catch {
    // Fall through to GitHub's PR file list.
  }
  return fallbackFiles;
}

function stackFromRequiredGate(root) {
  const workflowPath = join(root, '.github', 'workflows', 'repo-required-gate.yml');
  if (!existsSync(workflowPath)) return 'minimal';
  const body = readFileSync(workflowPath, 'utf8');
  const match = body.match(/^\s+stack:\s*([A-Za-z0-9_-]+)\s*$/m);
  return match ? match[1] : 'minimal';
}

function runExternalCheck(name, command, args, summary) {
  const resolved = resolveCommand(command, args);
  try {
    execFileSync(resolved.command, resolved.args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { name, ok: true, summary };
  } catch (err) {
    const output = [err.stdout, err.stderr, err.message].filter(Boolean).join('\n').trim();
    return {
      name,
      ok: false,
      summary: `${command} ${args.join(' ')} failed${output ? `: ${truncate(output)}` : '.'}`,
    };
  }
}

function resolveCommand(command, args) {
  if (process.platform === 'win32' && command === 'npm') {
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', ['npm', ...args].map(quoteCmdArg).join(' ')] };
  }
  return { command, args };
}

function quoteCmdArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@-]+$/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function validatePolicyFiles(root) {
  const checkMap = join(root, '.agent', 'check-map.yml');
  if (!existsSync(checkMap)) {
    return { name: 'policy-validation', ok: false, summary: '.agent/check-map.yml is missing.' };
  }
  const body = readFileSync(checkMap, 'utf8');
  const failures = [];
  if (!/^version: [0-9]+/m.test(body)) failures.push('missing `version: <number>`');
  if (!/^required_gate:/m.test(body)) failures.push('missing `required_gate:`');
  if (!/^\s+check_name: repo-required-gate \/ decision/m.test(body)) failures.push('missing required gate check name');
  return {
    name: 'policy-validation',
    ok: failures.length === 0,
    summary: failures.length === 0 ? '.agent/check-map.yml policy contract passed.' : failures.join('; '),
  };
}

function checkChangelogFragment(root, decision) {
  const fragment = extractChangelogFragment(decision);
  if (!fragment) return null;
  const absolute = join(root, fragment);
  if (existsSync(absolute)) return null;
  return `Changelog decision names \`${fragment}\`, but that file does not exist.`;
}

function runLocalChecks({ root, pr, files, scope, changelogDecision }) {
  const localChecks = [];

  const contract = validatePrContract({
    title: pr.title,
    body: pr.body,
    branch: pr.branch,
    files,
  });
  localChecks.push({
    name: 'pr-contract',
    ok: contract.ok,
    summary: formatPrContractResult(contract),
  });

  const changelog = evaluateChangelogDecision({
    requiresChangelog: scope.requiresChangelog,
    labels: pr.labels,
    changelogDecision,
  });
  const missingFragment = changelog.ok ? checkChangelogFragment(root, changelogDecision) : null;
  localChecks.push({
    name: 'changelog',
    ok: changelog.ok && !missingFragment,
    summary: missingFragment || (changelog.ok ? 'Changelog decision accepted.' : changelog.failures.join(' ')),
  });

  if (scope.requiredChecks.some((check) => check.name === 'node-test')) {
    localChecks.push(runExternalCheck('node-test', 'npm', ['test'], '`npm test` passed.'));
  }

  if (scope.requiredChecks.some((check) => check.name === 'actionlint')) {
    const workflows = listWorkflowFiles(root);
    localChecks.push(
      workflows.length > 0
        ? runExternalCheck('actionlint', 'actionlint', workflows, '`actionlint` passed for workflow files.')
        : { name: 'actionlint', ok: true, summary: 'No workflow files found; actionlint skipped by scope.' },
    );
  }

  if (scope.requiredChecks.some((check) => check.name === 'hook-syntax')) {
    const hooks = listHookShellFiles(root);
    localChecks.push(
      hooks.length > 0
        ? runExternalCheck('hook-syntax', 'bash', ['-n', ...hooks], '`bash -n` passed for git hook shell files.')
        : { name: 'hook-syntax', ok: true, summary: 'No shell hook files found; hook syntax check skipped by scope.' },
    );
  }

  if (scope.requiredChecks.some((check) => check.name === 'policy-validation')) {
    localChecks.push(validatePolicyFiles(root));
  }

  if (scope.requiredChecks.some((check) => check.name === 'dependency-review')) {
    localChecks.push({
      name: 'dependency-review',
      ok: true,
      deferred: true,
      summary: 'Dependency review is GitHub-hosted; `close:ci:guard` must verify the required gate after push.',
    });
  }

  return localChecks.filter((check) => scope.requiredChecks.some((required) => required.name === check.name));
}

function printResult(payload, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  if (payload.ok) {
    process.stdout.write(`Close-scan marker written: ${payload.markerPath}\n`);
    process.stdout.write(`HEAD: ${payload.marker.git.head}\n`);
    return;
  }
  process.stdout.write('Close-scan failed:\n');
  for (const failure of payload.failures) {
    process.stdout.write(`- ${failure}\n`);
  }
}

function truncate(text) {
  return text.length > 800 ? `${text.slice(0, 797)}...` : text;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = git(['rev-parse', '--show-toplevel']);
  process.chdir(root);

  const pr = loadPr({ repo: args.repo, pr: args.pr });
  const gitInfo = collectGitInfo();
  const base = args.base || `origin/${pr.base}`;
  const files = collectChangedFiles({ base, fallbackFiles: pr.files });
  const stack = args.stack || stackFromRequiredGate(root);
  const scope = classifyCloseScanScope({ files, labels: pr.labels, stack });
  const changelogDecision = args['changelog-decision'] || (scope.requiresChangelog ? '' : 'not required: docs-only change');
  const findingsDecision = args['findings-decision'] || '';
  const localChecks = runLocalChecks({ root, pr, files, scope, changelogDecision });
  const failures = localChecks.filter((check) => !check.ok).map((check) => `[${check.name}] ${check.summary}`);

  if (!isSubstantiveDecision(findingsDecision)) {
    failures.push('Missing required --findings-decision value.');
  }

  const verificationSummary = args['verification-summary']
    || localChecks.map((check) => `${check.name}: ${check.summary}`).join(' ');
  if (!isSubstantiveDecision(verificationSummary)) {
    failures.push('Missing substantive verification summary.');
  }

  const marker = buildCloseScanMarker({
    git: gitInfo,
    pr,
    scope,
    decisions: {
      changelog: changelogDecision,
      findings: findingsDecision,
      verification: verificationSummary,
    },
    localChecks,
  });
  const path = markerPath(root);
  const ok = failures.length === 0;

  if (ok) {
    writeCloseScanMarker(marker, path);
  }

  printResult({ ok, failures, marker, markerPath: path }, args.json);
  process.exitCode = ok ? 0 : 1;
}

main();
