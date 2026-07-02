import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

export const DEFAULT_REQUIRED_GATE = 'repo-required-gate / decision';
export const DEFAULT_MARKER_PATH = '.agent/close-scan/complete.json';

// #142 (archon-setup#302): the close guard and policy scan must honor the gate
// the repo declares in .agent/check-map.yml (`required_gate.check_name`) instead
// of assuming DEFAULT_REQUIRED_GATE. The check-map is deliberately simple YAML,
// so a scoped regex read keeps repo-template at zero runtime deps (same approach
// scan-complete already uses for the version/required_gate presence checks).
export function parseRequiredGateCheckName(body) {
  const text = String(body || '');
  // Capture only the indented lines immediately under `required_gate:` so a
  // `check_name:` beneath some other top-level block never counts as the gate.
  const block = text.match(/^required_gate:[ \t]*\r?\n((?:[ \t]+\S.*\r?\n?)*)/m);
  if (!block) return null;
  const name = block[1].match(/^[ \t]+check_name:[ \t]*(.+?)[ \t]*\r?$/m);
  if (!name) return null;
  let value = name[1].trim();
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    value = value.slice(1, -1).trim();
  }
  return value || null;
}

export function readRequiredGateCheckName(root) {
  try {
    return parseRequiredGateCheckName(readFileSync(join(root, '.agent', 'check-map.yml'), 'utf8'));
  } catch {
    return null;
  }
}

const DOC_EXTENSIONS_RE = /\.(md|txt|png|jpg|jpeg|gif|svg|webp|bmp|ico|avif)$/i;
const DOC_PREFIXES = ['.changelog/'];
const CHANGELOG_FRAGMENT_RE = /\.changelog\/unreleased\/[^/\s]+\.md\b/i;
const REPO_UPDATE_LOG_FRAGMENT_RE = /^docs\/repo-update-log\/(?!README\.md$)[^/]+\.md$/i;
const PLACEHOLDER_RE = /\b(TODO|TBD|FIXME|PLACEHOLDER|NOT YET|NONE YET|N\/A)\b/i;
const DOC_ONLY_REPO_LOG_SKIP_RE = /\b(repo[- ]?update[- ]?log|update[- ]?log|ledger)\b[\s\S]{0,160}\b(not required|not needed|skipped|skip|omitted|doc[- ]only typo)\b|\bdoc[- ]only typo\b[\s\S]{0,160}\b(repo[- ]?update[- ]?log|update[- ]?log|ledger)\b/i;
const PROTECTED_REPO_LOG_PATHS = [
  '.agent/',
  '.github/',
  '.githooks/',
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  'ARCHITECTURE.md',
  'CHANGELOG.md',
  'DESIGN.md',
  'README.md',
  'TODO.md',
  'VISION.md',
  'llms.txt',
  'docs/CANON.md',
  'docs/INDEX.md',
  'docs/LIBRARIAN.md',
  'docs/project-status.md',
  'docs/repo-update-log/README.md',
  'docs/agent-process/',
  'docs/decisions/',
];
const DEPENDENCY_FILES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'pyproject.toml',
  'requirements.txt',
  'requirements-dev.txt',
  'uv.lock',
  'poetry.lock',
]);

export function normalizePath(path) {
  return String(path || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

export function classifyCloseScanScope({ files = [], labels = [], stack = 'minimal' } = {}) {
  const normalizedFiles = files.map(normalizePath).filter(Boolean);
  const normalizedLabels = labels.map((label) => String(label || '').toLowerCase());
  const docsOnly = normalizedFiles.length > 0 && normalizedFiles.every(isDocOnlyFile);
  const touchesWorkflow = normalizedFiles.some((file) => file.startsWith('.github/workflows/'));
  const touchesHook = normalizedFiles.some((file) => file.startsWith('.githooks/'));
  const touchesPolicy = normalizedFiles.some(isPolicyPath);
  const touchesCode = normalizedFiles.some(isCodePath);
  const touchesDependency = normalizedFiles.some((file) => DEPENDENCY_FILES.has(file));
  const requiresChangelog = !docsOnly;
  const requiredChecks = [{ name: 'pr-contract', reason: 'PR metadata contract' }];

  requiredChecks.push({
    name: 'repo-update-log',
    reason: 'Applicable PRs must add a docs/repo-update-log fragment or record an allowed doc-only skip',
  });
  if (requiresChangelog) {
    requiredChecks.push({ name: 'changelog', reason: 'Non-doc changes must record a changelog decision' });
  }
  if (!docsOnly && stack === 'node' && (touchesCode || touchesDependency)) {
    requiredChecks.push({ name: 'node-test', reason: 'Node-owned code or package surface changed' });
  }
  if (touchesWorkflow) {
    requiredChecks.push({ name: 'actionlint', reason: 'GitHub Actions workflow changed' });
  }
  if (touchesHook) {
    requiredChecks.push({ name: 'hook-syntax', reason: 'Git hook surface changed' });
  }
  if (touchesPolicy) {
    requiredChecks.push({ name: 'policy-validation', reason: 'Policy or check-map surface changed' });
  }
  if (touchesDependency) {
    requiredChecks.push({ name: 'dependency-review', reason: 'Dependency manifest or lockfile changed', local: false });
  }

  return {
    files: normalizedFiles,
    labels: normalizedLabels,
    stack,
    docsOnly,
    requiresChangelog,
    touchesWorkflow,
    touchesHook,
    touchesPolicy,
    touchesCode,
    touchesDependency,
    requiredChecks,
  };
}

export function evaluateChangelogDecision({ requiresChangelog, labels = [], changelogDecision = '' } = {}) {
  if (!requiresChangelog) {
    return { ok: true, failures: [] };
  }

  const decision = String(changelogDecision || '').trim();
  const normalizedLabels = labels.map((label) => String(label || '').toLowerCase());

  if (!isSubstantiveDecision(decision)) {
    return { ok: false, failures: ['A non-doc change requires an explicit changelog decision.'] };
  }

  if (CHANGELOG_FRAGMENT_RE.test(normalizePath(decision))) {
    return { ok: true, failures: [] };
  }

  if (normalizedLabels.includes('no-changelog') && /\bno-changelog\b/i.test(decision)) {
    return { ok: true, failures: [] };
  }

  return {
    ok: false,
    failures: ['Changelog decision must name a `.changelog/unreleased/*.md` fragment or cite the `no-changelog` label.'],
  };
}

export function evaluateRepoUpdateLogDecision({ files = [], body = '' } = {}) {
  const normalizedFiles = files.map(normalizePath).filter(Boolean);
  const ledgerFragments = normalizedFiles.filter(isRepoUpdateLogFragment);
  const ledgerOnly = normalizedFiles.length > 0 && normalizedFiles.every(isRepoUpdateLogFragment);
  const docsOnly = normalizedFiles.length > 0 && normalizedFiles.every(isDocOnlyFile);
  const protectedFiles = normalizedFiles.filter(isRepoUpdateLogProtectedPath);

  if (normalizedFiles.length === 0) {
    return { ok: false, failures: ['No PR files were available to evaluate for the repo update log.'] };
  }

  if (ledgerOnly) {
    return { ok: true, failures: [] };
  }

  if (ledgerFragments.length > 0) {
    return { ok: true, failures: [] };
  }

  if (docsOnly && protectedFiles.length === 0) {
    if (DOC_ONLY_REPO_LOG_SKIP_RE.test(String(body || ''))) {
      return { ok: true, failures: [] };
    }
    return {
      ok: false,
      failures: ['Doc-only PRs without a repo update log fragment must state why the fragment is not required in the PR body.'],
    };
  }

  return {
    ok: false,
    failures: ['This PR requires an added `docs/repo-update-log/*.md` repo update log fragment.'],
  };
}

export function evaluateRequiredChecks({ checkRuns = [], requiredCheckName = DEFAULT_REQUIRED_GATE } = {}) {
  const matched = checkRuns.find((check) => String(check.name || '') === requiredCheckName) || null;
  if (!matched) {
    return {
      ok: false,
      failures: [`Required check \`${requiredCheckName}\` is unavailable for the current PR head.`],
      matched: null,
    };
  }

  const status = String(matched.status || matched.state || '').toLowerCase();
  const conclusion = String(matched.conclusion || '').toLowerCase();
  const completedStates = new Set(['completed', 'success', 'successful']);
  if (status && !completedStates.has(status) && !conclusion) {
    return {
      ok: false,
      failures: [`Required check \`${requiredCheckName}\` is not completed yet (status: ${status}).`],
      matched,
    };
  }
  if (conclusion !== 'success' && status !== 'success' && status !== 'successful') {
    return {
      ok: false,
      failures: [`Required check \`${requiredCheckName}\` is not successful (conclusion: ${conclusion || 'unknown'}).`],
      matched,
    };
  }

  return { ok: true, failures: [], matched };
}

export function buildCloseScanMarker({
  git,
  pr,
  scope,
  decisions,
  localChecks,
  timestamp = new Date().toISOString(),
} = {}) {
  return {
    version: 1,
    timestamp,
    git: {
      branch: git?.branch || null,
      head: git?.head || null,
      upstream: git?.upstream || null,
      upstreamHead: git?.upstreamHead || null,
    },
    pr: {
      number: pr?.number || null,
      url: pr?.url || null,
      branch: pr?.branch || null,
    },
    scope: {
      docsOnly: Boolean(scope?.docsOnly),
      requiredChecks: (scope?.requiredChecks || []).map((check) => (
        typeof check === 'string' ? check : check.name
      )),
    },
    decisions: {
      changelog: decisions?.changelog || '',
      findings: decisions?.findings || '',
      verification: decisions?.verification || '',
    },
    localChecks: Array.isArray(localChecks) ? localChecks : [],
  };
}

export function evaluateCloseScanMarker({
  marker,
  git,
  pr,
  requireUpstreamIdentity = false,
} = {}) {
  const failures = [];

  if (!marker || marker.version !== 1) {
    return { ok: false, failures: ['Close-scan completion marker is missing or has an unsupported version.'] };
  }

  if (!marker.timestamp) {
    failures.push('Close-scan completion marker is missing a timestamp.');
  }
  if (!marker.git?.head || marker.git.head !== git?.head) {
    failures.push('Close-scan completion marker is stale: recorded HEAD does not match current HEAD.');
  }
  if (!marker.git?.branch || marker.git.branch !== git?.branch) {
    failures.push('Close-scan completion marker branch does not match the current branch.');
  }
  if (pr?.number && marker.pr?.number !== pr.number) {
    failures.push(`Close-scan completion marker is bound to PR #${marker.pr?.number || '(missing)'}, not PR #${pr.number}.`);
  }
  if (pr?.branch && marker.pr?.branch !== pr.branch) {
    failures.push('Close-scan completion marker PR branch does not match the current PR branch.');
  }
  if (!isSubstantiveDecision(marker.decisions?.changelog)) {
    failures.push('Close-scan completion marker is missing a substantive changelog decision.');
  }
  if (!isSubstantiveDecision(marker.decisions?.findings)) {
    failures.push('Close-scan completion marker is missing a substantive findings decision.');
  }
  if (!isSubstantiveDecision(marker.decisions?.verification)) {
    failures.push('Close-scan completion marker is missing a substantive verification summary.');
  }
  for (const check of marker.localChecks || []) {
    if (!check.ok) {
      failures.push(`Close-scan local check \`${check.name || '(unknown)'}\` was not green.`);
    }
  }

  if (requireUpstreamIdentity) {
    if (!git?.upstream) {
      failures.push('Current branch has no upstream; push with `git push -u origin HEAD` before running the CI guard.');
    }
    if (git?.branch && git?.upstream && !git.upstream.endsWith(`/${git.branch}`)) {
      failures.push(`Current upstream \`${git.upstream}\` is not the remote branch for \`${git.branch}\`.`);
    }
    if (!git?.upstreamHead || git?.head !== git.upstreamHead) {
      failures.push('Current HEAD does not match the upstream branch head; push the exact final HEAD before running the CI guard.');
    }
  }

  return { ok: failures.length === 0, failures };
}

export function markerPath(root = process.cwd()) {
  return join(root, DEFAULT_MARKER_PATH);
}

export function readCloseScanMarker(path = markerPath()) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeCloseScanMarker(marker, path = markerPath()) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
}

export function extractChangelogFragment(decision) {
  const match = normalizePath(decision).match(CHANGELOG_FRAGMENT_RE);
  return match ? match[0] : null;
}

export function isSubstantiveDecision(value) {
  const text = String(value || '').trim();
  return text.length >= 10 && !PLACEHOLDER_RE.test(text) && !/^(none|null|undefined)$/i.test(text);
}

export function listWorkflowFiles(root = process.cwd()) {
  const workflowDir = join(root, '.github', 'workflows');
  if (!existsSync(workflowDir)) return [];
  return readdirSync(workflowDir)
    .filter((file) => /\.(ya?ml)$/i.test(file))
    .map((file) => normalizePath(join('.github', 'workflows', file)));
}

export function listHookShellFiles(root = process.cwd()) {
  const hookDir = join(root, '.githooks');
  if (!existsSync(hookDir)) return [];
  return walkFiles(hookDir)
    .filter((file) => !file.endsWith('.sample'))
    .filter((file) => file.endsWith('.sh') || firstLine(file).includes('sh'))
    .map((file) => normalizePath(relative(root, file)));
}

function isDocOnlyFile(file) {
  return DOC_EXTENSIONS_RE.test(file) || DOC_PREFIXES.some((prefix) => file.startsWith(prefix));
}

function isPolicyPath(file) {
  return file === 'AGENTS.md'
    || file === 'CLAUDE.md'
    || file === 'GEMINI.md'
    || file.startsWith('.agent/')
    || file.startsWith('.github/');
}

function isRepoUpdateLogFragment(file) {
  return REPO_UPDATE_LOG_FRAGMENT_RE.test(normalizePath(file));
}

function isRepoUpdateLogProtectedPath(file) {
  const normalized = normalizePath(file);
  return PROTECTED_REPO_LOG_PATHS.some((entry) => (
    entry.endsWith('/') ? normalized.startsWith(entry) : normalized === entry
  ));
}

function isCodePath(file) {
  return file.startsWith('src/')
    || file.startsWith('lib/')
    || file.startsWith('bin/')
    || file.startsWith('scripts/')
    || file.startsWith('test/')
    || file.startsWith('tests/')
    || /\.(mjs|cjs|js|ts|tsx|py)$/i.test(file);
}

function walkFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walkFiles(path);
    if (entry.isFile()) return [path];
    return [];
  });
}

function firstLine(file) {
  try {
    return readFileSync(file, 'utf8').split(/\r?\n/, 1)[0] || '';
  } catch {
    return '';
  }
}
