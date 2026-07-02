#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatPrContractResult,
  validatePrContract,
} from '../pr-contract.mjs';
import {
  buildCloseScanMarker,
  classifyCloseScanScope,
  evaluateChangelogDecision,
  evaluateDocsDecision,
  evaluateRepoUpdateLogDecision,
  extractChangelogFragment,
  freshDodCaptures,
  isSubstantiveDecision,
  listHookShellFiles,
  listWorkflowFiles,
  markerPath,
  parseRequiredGateCheckName,
  readDodCapture,
  writeCloseScanMarker,
} from './lib.mjs';

// The doc-map lives with the docs generators (scripts/docs); consumers that
// received the close scripts without the docs system (pre-T1 self-apply) must
// not crash — the docs DoD degrades to auto-pass ONLY when the spine is
// truly absent. A doc-map that EXISTS but cannot be imported/read/parsed
// fails closed instead (#145 review): parseDocMap is a lenient line-parser,
// so "malformed" often reads as an empty-but-truthy map — the version check
// catches that shape too.
async function readDocMapSafe(root) {
  if (!existsSync(join(root, '.agent', 'doc-map.yml'))) {
    return { docMap: null, docMapError: null };
  }
  try {
    const { readDocMap } = await import('../docs/lib.mjs');
    const docMap = readDocMap(root);
    if (!docMap || docMap.version !== 1) {
      return { docMap: null, docMapError: 'parsed but is not a valid version-1 doc-map' };
    }
    return { docMap, docMapError: null };
  } catch (err) {
    return { docMap: null, docMapError: String(err.message || err).split('\n')[0] };
  }
}

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
    // No `--diff-filter`: deletions (D) must count toward scope derivation. A PR
    // that deletes code or hook files (while changing only docs otherwise) is not
    // a docs-only change, and excluding D under-runs the guard (repo-template#84).
    // `-M` detects renames; `--name-status` reports both the old and new path so a
    // rename out of a code/hook path still classifies into the wider scope.
    const raw = git(['diff', '--name-status', '-M', `${base}...HEAD`], { ignoreErrors: true });
    const files = parseNameStatus(raw);
    if (files.length > 0) return files;
  } catch {
    // Fall through to GitHub's PR file list.
  }
  return fallbackFiles;
}

// Parse `git diff --name-status -M` output into the full set of affected paths.
// Each line is tab-separated: `<status>\t<path>` for A/C/D/M/T, or
// `<status>\t<oldPath>\t<newPath>` for renames (R) and copies (C with score).
// Both the old and new path of a rename/copy are returned so scope derivation
// sees the source side too (repo-template#84).
function parseNameStatus(raw) {
  const paths = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('\t').map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    // parts[0] is the status code (e.g. `M`, `D`, `R100`); the rest are paths.
    for (const path of parts.slice(1)) paths.push(path);
  }
  return paths;
}

function stackFromRequiredGate(root) {
  const workflowPath = join(root, '.github', 'workflows', 'repo-required-gate.yml');
  if (!existsSync(workflowPath)) return 'minimal';
  const body = readFileSync(workflowPath, 'utf8');
  const match = body.match(/^\s+stack:\s*([A-Za-z0-9_-]+)\s*$/m);
  return match ? match[1] : 'minimal';
}

// Decide whether the local node-test check should RUN `npm test` or SKIP green,
// from the package.json state. The original `hasNpmScript` swallowed JSON.parse
// errors and returned false, so a PRESENT-BUT-UNPARSEABLE package.json was treated
// the same as ABSENT and node-test was recorded green-by-skip — masking the real
// gate, whose `npm run --if-present test` exits EJSONPARSE and FAILS. Distinguish:
//   - absent              → skip green (matches the gate's `npm run --if-present`)
//   - unparseable         → RUN `npm test` so the parse error surfaces as the gate sees it
//   - present, has `test` → RUN `npm test`
//   - present, no `test`  → skip green
// Pure + injectable for unit tests (archon-setup#286).
function decideNodeTest({ exists, readPackageJson }) {
  if (!exists) return { run: false, reason: 'no-package-json' };
  let pkg;
  try {
    pkg = readPackageJson();
  } catch {
    return { run: true, reason: 'unparseable-package-json' };
  }
  const script = pkg && pkg.scripts ? pkg.scripts.test : undefined;
  if (typeof script === 'string' && script.trim().length > 0) {
    return { run: true, reason: 'has-test-script' };
  }
  return { run: false, reason: 'no-test-script' };
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

// Syntax-check EVERY hook shell file, not just the first. `bash -n a b c` only
// parses `a` and treats `b`/`c` as positional args ($1/$2), so the original
// single-invocation `bash -n ...hooks` silently skipped every hook past the
// first (repo-template#84). Run `bash -n` once per file, check all of them, and
// fail the check if any file has a syntax error — reporting every failing file.
function checkHookSyntax(hooks) {
  const failures = [];
  for (const hook of hooks) {
    const result = runExternalCheck('hook-syntax', 'bash', ['-n', hook], '');
    if (!result.ok) failures.push(result.summary);
  }
  if (failures.length > 0) {
    return { name: 'hook-syntax', ok: false, summary: failures.join('; ') };
  }
  // hooks.length is > 0 here (the empty case is handled by the caller).
  return {
    name: 'hook-syntax',
    ok: true,
    summary: `\`bash -n\` passed for all ${hooks.length} git hook shell file(s).`,
  };
}

function resolveCommand(command, args) {
  if (process.platform === 'win32' && command === 'npm') {
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', ['npm', ...args].map(quoteCmdArg).join(' ')] };
  }
  if (process.platform === 'win32' && command === 'bash') {
    return { command, args: args.map(toBashPath) };
  }
  return { command, args };
}

// Cache the cygpath-availability probe so the per-file loop in checkHookSyntax
// does not re-shell-out once per hook. `undefined` = not yet probed.
let cygpathAvailable;

// Probe once whether `cygpath` exists on PATH. It ships with Git Bash/MSYS
// (the default `bash` on Windows) and is absent under pure WSL. `cygpath -w .`
// is a cheap no-op that succeeds only when the tool is present.
function hasCygpath() {
  if (cygpathAvailable === undefined) {
    try {
      execFileSync('cygpath', ['-w', '.'], { stdio: 'ignore' });
      cygpathAvailable = true;
    } catch {
      cygpathAvailable = false;
    }
  }
  return cygpathAvailable;
}

// Convert a Windows-absolute path to the POSIX form the active `bash` expects.
// Git Bash/MSYS (the default Windows bash) wants `/c/...`, while WSL wants
// `/mnt/c/...` - the old hardcoded `/mnt/` rewrite false-failed `bash -n` on
// every hook under Git Bash (repo-template#104). Prefer `cygpath -u` (yields
// the correct Git Bash form) and fall back to the `/mnt/<drive>/` rewrite only
// when cygpath is absent (pure WSL). Non-absolute args (e.g. the `-n` flag)
// pass through unchanged.
function toBashPath(value) {
  const text = String(value);
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(text);
  if (!match) return text;
  if (hasCygpath()) {
    try {
      return execFileSync('cygpath', ['-u', text], { encoding: 'utf8' }).trim();
    } catch {
      // Fall through to the WSL-style rewrite if this one path fails to convert.
    }
  }
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, '/')}`;
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
  // Any declared gate is valid — repos may gate on e.g. `ci-success` instead of
  // the repo-template default (#142, archon-setup#302).
  if (!parseRequiredGateCheckName(body)) failures.push('missing required gate check name (`required_gate.check_name`)');
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

function runLocalChecks({ root, pr, files, scope, changelogDecision, docsResult }) {
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

  // #124 S2: the docs section of the closeout DoD — evaluated in main() (it
  // needs the doc-map and the captured/explicit decision), reported here so it
  // fails the scan like any other local check.
  localChecks.push({
    name: 'docs',
    ok: docsResult.ok,
    summary: docsResult.ok
      ? `Docs DoD satisfied: ${docsResult.decision}${docsResult.waived ? ' [docs:waived]' : ''}`
      : docsResult.failures.join(' '),
  });

  const repoUpdateLog = evaluateRepoUpdateLogDecision({
    files,
    body: pr.body,
  });
  localChecks.push({
    name: 'repo-update-log',
    ok: repoUpdateLog.ok,
    summary: repoUpdateLog.ok ? 'Repo update log decision accepted.' : repoUpdateLog.failures.join(' '),
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
    // A baseline'd repo has no `test` script (the required gate leaves
    // npm-test-script empty and node-ci runs `npm run --if-present`), so running
    // `npm test` unconditionally would fail the local close-scan with a missing-
    // script error even though CI is green. Skip-as-green when no test script
    // exists, staying consistent with the gate (#121, archon-setup#282). But a
    // PRESENT-BUT-UNPARSEABLE package.json must RUN `npm test` so the EJSONPARSE
    // the gate would hit surfaces locally instead of green-by-skip (archon-setup#286).
    const pkgPath = join(root, 'package.json');
    const decision = decideNodeTest({
      exists: existsSync(pkgPath),
      readPackageJson: () => JSON.parse(readFileSync(pkgPath, 'utf8')),
    });
    localChecks.push(
      decision.run
        ? runExternalCheck('node-test', 'npm', ['test'], '`npm test` passed.')
        : {
            name: 'node-test',
            ok: true,
            summary: decision.reason === 'no-package-json'
              ? 'No package.json; node-test skipped (matches the gate\'s `npm run --if-present`).'
              : 'No `test` script in package.json; node-test skipped (matches the gate\'s `npm run --if-present`).',
          },
    );
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
        ? checkHookSyntax(hooks)
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = git(['rev-parse', '--show-toplevel']);
  process.chdir(root);

  const pr = loadPr({ repo: args.repo, pr: args.pr });
  const gitInfo = collectGitInfo();
  const base = args.base || `origin/${pr.base}`;
  const files = collectChangedFiles({ base, fallbackFiles: pr.files });
  const stack = args.stack || stackFromRequiredGate(root);
  const scope = classifyCloseScanScope({ files, labels: pr.labels, stack });

  // #124 S2: decisions captured incrementally during the session (close:dod)
  // are the defaults; explicit flags win; scope-derived defaults come last.
  // Only captures made at the CURRENT HEAD are reusable (#145 review, P1) —
  // stale ones are discarded loudly and must be recaptured.
  const { sections: freshSections, discarded } = freshDodCaptures(readDodCapture(root), gitInfo.head);
  if (discarded.length > 0) {
    process.stderr.write(
      `Discarded stale close:dod captures (recorded at a different HEAD): ${discarded.join(', ')} — `
        + 'recapture at the current HEAD if still true.\n'
    );
  }
  const captured = (section) => freshSections[section]?.decision || '';

  const changelogDecision = args['changelog-decision'] || captured('changelog')
    || (scope.requiresChangelog ? '' : 'not required: docs-only change');
  const findingsDecision = args['findings-decision'] || captured('findings');
  const { docMap, docMapError } = await readDocMapSafe(root);
  const docsResult = evaluateDocsDecision({
    files,
    docMap,
    docMapError,
    docsOnly: scope.docsOnly,
    labels: pr.labels,
    decision: args['docs-decision'] || captured('docs'),
    // A deleted/renamed-away triggered doc must not satisfy its own trigger.
    existsFn: (rel) => existsSync(join(root, rel)),
  });
  const localChecks = runLocalChecks({ root, pr, files, scope, changelogDecision, docsResult });
  const failures = localChecks.filter((check) => !check.ok).map((check) => `[${check.name}] ${check.summary}`);

  if (!isSubstantiveDecision(findingsDecision)) {
    failures.push('Missing required --findings-decision value.');
  }

  const verificationSummary = args['verification-summary'] || captured('verification')
    || localChecks.map((check) => `${check.name}: ${check.summary}`).join(' ');
  if (!isSubstantiveDecision(verificationSummary)) {
    failures.push('Missing substantive verification summary.');
  }

  const marker = buildCloseScanMarker({
    git: gitInfo,
    pr,
    scope,
    dod: {
      docs: { decision: docsResult.decision, waived: docsResult.waived, triggers: docsResult.triggers },
      changelog: { decision: changelogDecision },
      verification: { decision: verificationSummary },
      findings: { decision: findingsDecision },
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

// Export the scope-derivation and hook-syntax helpers so they can be unit-tested
// without invoking `main()`. Mirrors the entry-point guard in pr-contract.mjs.
export { checkHookSyntax, parseNameStatus, toBashPath, decideNodeTest, validatePolicyFiles };

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  await main();
}
