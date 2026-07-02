import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

export const DEFAULT_REQUIRED_GATE = 'repo-required-gate / decision';
export const DEFAULT_MARKER_PATH = '.agent/close-scan/complete.json';

// #142 (archon-setup#302): the close guard and policy scan must honor the gate
// the repo declares in .agent/check-map.yml (`required_gate.check_name`) instead
// of assuming DEFAULT_REQUIRED_GATE. The check-map is deliberately simple YAML,
// so a scoped regex read keeps repo-template at zero runtime deps (same approach
// scan-complete already uses for the version/required_gate presence checks).
// Drop an unquoted trailing YAML comment (` # ...`). Quote-aware so a `#`
// inside a quoted gate name survives; a bare `#` with no preceding whitespace
// is part of the value, matching YAML's comment rule.
function stripTrailingYamlComment(value) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble && /\s/.test(value[i - 1] || ' ')) {
      return value.slice(0, i).trimEnd();
    }
  }
  return value;
}

export function parseRequiredGateCheckName(body) {
  const text = String(body || '');
  // Capture only the lines immediately under `required_gate:` so a
  // `check_name:` beneath some other top-level block never counts as the gate.
  // The header may carry a trailing YAML comment (`required_gate: # gate`);
  // anything else after the colon is an inline scalar, not the block shape.
  // Within the block, indented content, comment-only, and blank lines are all
  // valid YAML and must not end the capture; the first non-indented content
  // line (the next top-level key) still does, so a blank line cannot leak the
  // capture into a different block (check_name there stays out of reach).
  const block = text.match(
    /^required_gate:[ \t]*(?:#.*)?\r?\n((?:[ \t]+\S.*\r?\n?|[ \t]*#.*\r?\n?|[ \t]*\r?\n)*)/m
  );
  if (!block) return null;
  const name = block[1].match(/^[ \t]+check_name:[ \t]*(.+?)[ \t]*\r?$/m);
  if (!name) return null;
  let value = stripTrailingYamlComment(name[1].trim()).trim();
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

  // #124 S2: the docs DoD section is ALWAYS evaluated — substance scales
  // inside evaluateDocsDecision (docs-only and untriggered diffs auto-pass),
  // never by dropping the check from scope.
  requiredChecks.push({
    name: 'docs',
    reason: 'Closeout DoD docs section — doc-map-owned docs updated, explained, or visibly waived',
  });
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

// #124 S2: the closeout Definition of Done is exactly these four decisions,
// each captured (incrementally via close:dod, or at scan time) and bound to
// the final HEAD by the marker. Order is display order.
export const DOD_SECTIONS = ['docs', 'changelog', 'verification', 'findings'];

// Minimal glob for the doc-map's `owns`/`heal_when` vocabulary (zero-dep, same
// discipline as the check-map reader above): `**` spans path segments, `*`
// stays within one segment, everything else is literal. Anchored both ends.
function globToRegExp(glob) {
  const escaped = String(glob)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${escaped}$`);
}

// A scalar `owns: scripts/**` is valid YAML that the lenient doc-map parser
// returns as a string — treat it as a one-glob list rather than crashing on
// `.map` (#145 review round 3). Anything else non-array contributes nothing.
function toGlobList(raw) {
  if (Array.isArray(raw)) return raw.filter((glob) => typeof glob === 'string' && glob.trim());
  if (typeof raw === 'string' && raw.trim()) return [raw.trim()];
  return [];
}

// Which doc-map docs does this diff put on the hook? `checked` docs fire on
// their `owns` globs, `human` docs on `heal_when` (an empty heal_when — e.g.
// VISION.md, owner decision 2026-06-27 — never fires).
export function matchDocMapTriggers(files, docMap) {
  const entries = [
    ...(docMap?.checked || []).map((doc) => ({ path: doc.path, globs: toGlobList(doc.owns) })),
    ...(docMap?.human || []).map((doc) => ({ path: doc.path, globs: toGlobList(doc.heal_when) })),
  ];
  const triggers = [];
  for (const entry of entries) {
    if (!entry.path || entry.globs.length === 0) continue;
    const patterns = entry.globs.map(globToRegExp);
    const matchedBy = (files || []).filter((file) => patterns.some((re) => re.test(file)));
    if (matchedBy.length > 0) triggers.push({ path: entry.path, matchedBy });
  }
  return triggers;
}

// The docs section of the DoD, substance scaled by scope (#124 S2):
// docs-only diffs, untriggered diffs, and repos without a doc-map auto-pass;
// a diff that triggers doc-map-owned docs must update them in-PR, explain
// substantively why not, or carry the docs:waived label WITH a reason. The
// waiver is recorded (not hidden) so dashboards can count it.
// existsFn: injectable existence check for changed paths. Deletions ride in
// `files` on purpose (parseNameStatus counts D and both rename sides for
// scope), so "updated in-PR" additionally requires the matched doc to still
// exist — a PR deleting the owning doc must not satisfy its own trigger
// (#145 review round 4). Production passes an fs-backed check; the pure
// default keeps the function testable without a filesystem.
export function evaluateDocsDecision({ files = [], docMap = null, docMapError = null, docsOnly = false, labels = [], decision = '', existsFn = () => true } = {}) {
  const waived = (labels || []).includes('docs:waived');
  const explicit = String(decision || '').trim();
  const pass = (text, triggers = []) => ({ ok: true, waived, triggers, decision: explicit || text, failures: [] });

  // Fail closed on a PRESENT-but-broken spine (#145 review): a malformed
  // doc-map silently disabling the DoD is worse than a loud failure, and no
  // decision text can substitute for the input it is judged against.
  if (docMapError) {
    return {
      ok: false,
      waived,
      triggers: [],
      decision: explicit,
      failures: [
        `.agent/doc-map.yml exists but could not be used (${docMapError}); `
          + 'the docs DoD fails closed on a broken spine — fix the doc-map, do not bypass it.',
      ],
    };
  }

  if (docsOnly) return pass('docs are the change under review');
  if (!docMap) return pass('not required: no .agent/doc-map.yml in this repo (docs DoD auto-passes)');

  const triggers = matchDocMapTriggers(files, docMap);
  if (triggers.length === 0) return pass('not required: no doc-map-owned docs match the diff');

  const triggerPaths = triggers.map((t) => t.path);
  const updated = triggerPaths.filter((path) => {
    const re = globToRegExp(path);
    return files.some((file) => re.test(file) && existsFn(file));
  });
  if (updated.length === triggerPaths.length) return pass(`updated in-PR: ${updated.join(', ')}`, triggerPaths);
  if (isSubstantiveDecision(explicit)) {
    return { ok: true, waived, triggers: triggerPaths, decision: explicit, failures: [] };
  }

  const stale = triggerPaths.filter((path) => !updated.includes(path));
  return {
    ok: false,
    waived,
    triggers: triggerPaths,
    decision: explicit,
    failures: [
      `Diff triggers doc-map-owned docs not updated in this PR: ${stale.join(', ')}. `
        + 'Update them in this PR, pass a substantive --docs-decision explaining why not, '
        + 'or add the docs:waived label with a substantive reason.',
    ],
  };
}

// Incremental DoD capture (#124 S2): decisions are written to
// .agent/close-scan/dod.json AS THEY ARE MADE during the session, so a reboot
// or context loss never re-litigates them; scan-complete folds them into the
// HEAD-bound marker as defaults (explicit flags win).
export function dodCapturePath(root = process.cwd()) {
  return join(root, '.agent', 'close-scan', 'dod.json');
}

export function readDodCapture(root = process.cwd()) {
  try {
    const parsed = JSON.parse(readFileSync(dodCapturePath(root), 'utf8'));
    if (!parsed || parsed.version !== 1 || typeof parsed.sections !== 'object' || parsed.sections === null) return null;
    return parsed;
  } catch {
    return null;
  }
}

// #145 review (P1): the marker's HEAD-bound guarantee extends to every
// folded-in decision — a capture made at an earlier commit must not certify a
// later one. Only sections whose recorded head matches the current HEAD are
// reusable; the rest are discarded and must be recaptured (the reboot-safety
// property only ever promised survival WITHOUT new commits).
export function freshDodCaptures(capture, head) {
  const sections = {};
  const discarded = [];
  for (const [name, entry] of Object.entries(capture?.sections || {})) {
    if (entry?.head && head && entry.head === head) sections[name] = entry;
    else discarded.push(name);
  }
  return { sections, discarded };
}

export function writeDodSection(root, section, decision, { head = null, timestamp = new Date().toISOString() } = {}) {
  if (!DOD_SECTIONS.includes(section)) {
    throw new Error(`Unknown DoD section "${section}" — expected one of: ${DOD_SECTIONS.join(', ')}.`);
  }
  if (!isSubstantiveDecision(decision)) {
    throw new Error(`DoD ${section} decision must be substantive (>= 10 chars, no placeholder text).`);
  }
  const capture = readDodCapture(root) || { version: 1, sections: {} };
  capture.sections[section] = { decision, head, capturedAt: timestamp };
  mkdirSync(join(root, '.agent', 'close-scan'), { recursive: true });
  writeFileSync(dodCapturePath(root), `${JSON.stringify(capture, null, 2)}\n`);
  return capture;
}

export function buildCloseScanMarker({
  git,
  pr,
  scope,
  dod,
  localChecks,
  timestamp = new Date().toISOString(),
} = {}) {
  return {
    version: 2,
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
    dod: {
      docs: {
        decision: dod?.docs?.decision || '',
        waived: Boolean(dod?.docs?.waived),
        triggers: Array.isArray(dod?.docs?.triggers) ? dod.docs.triggers : [],
      },
      changelog: { decision: dod?.changelog?.decision || '' },
      verification: { decision: dod?.verification?.decision || '' },
      findings: { decision: dod?.findings?.decision || '' },
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

  // Version 2 only: a v1 marker predates the 4-section DoD (#124 S2) and says
  // nothing about the docs decision, so the guard cannot accept it.
  if (!marker || marker.version !== 2) {
    return { ok: false, failures: ['Close-scan completion marker is missing or has an unsupported version (expected 2 — re-run close:scan:complete).'] };
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
  for (const section of DOD_SECTIONS) {
    if (!isSubstantiveDecision(marker.dod?.[section]?.decision)) {
      failures.push(`Close-scan completion marker is missing a substantive ${section} DoD decision.`);
    }
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
