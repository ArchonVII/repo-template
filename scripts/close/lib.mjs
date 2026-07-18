import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

export const DEFAULT_REQUIRED_GATE = 'repo-required-gate / decision';
export const DEFAULT_MARKER_PATH = '.agent/close-scan/complete.json';

// #142 / #184: the close guard and policy scan must honor every gate the repo
// declares in .agent/check-map.yml (`required_gates[].check_name`, with legacy
// `required_gate.check_name` compatibility). The check-map is deliberately
// simple YAML, so a scoped line reader keeps repo-template at zero runtime deps.
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

function captureTopLevelBlock(text, key) {
  return text.match(
    new RegExp(
      `^${key}:[ \\t]*(?:#.*)?\\r?\\n((?:[ \\t]+\\S.*\\r?\\n?|[ \\t]*#.*\\r?\\n?|[ \\t]*\\r?\\n)*)`,
      'm',
    ),
  )?.[1] ?? null;
}

function parseCheckNameScalar(rawValue) {
  let value = stripTrailingYamlComment(String(rawValue || '').trim()).trim();
  if (!value) return null;

  const first = value[0];
  const last = value[value.length - 1];
  if (first === '"' || first === "'") {
    if (last !== first || value.length < 2) return null;
    value = value.slice(1, -1).trim();
  } else if (last === '"' || last === "'") {
    return null;
  }

  if (!value || /^(?:null|~|\[\]|\{\})$/i.test(value)) return null;
  return value;
}

function parseMappingProperty(content) {
  const match = /^([A-Za-z_][A-Za-z0-9_-]*):(?:[ \t]*(.*))?$/.exec(content);
  return match ? { key: match[1], value: match[2] || '' } : null;
}

function parseLegacyRequiredGate(text) {
  const block = captureTopLevelBlock(text, 'required_gate');
  if (block === null) return null;

  const lines = block.split(/\r?\n/);
  const directLines = lines
    .map((line) => ({
      indent: line.match(/^[ \t]*/)?.[0].length || 0,
      content: line.trimStart(),
    }))
    .filter(({ content }) => content && !content.startsWith('#'));
  if (directLines.length === 0) return null;

  const directIndent = Math.min(...directLines.map(({ indent }) => indent));
  const names = directLines
    .filter(({ indent, content }) => indent === directIndent && content.startsWith('check_name:'))
    .map(({ content }) => parseMappingProperty(content))
    .filter((property) => property?.key === 'check_name')
    .map((property) => parseCheckNameScalar(property.value));
  return names.length === 1 ? names[0] : null;
}

function parsePluralRequiredGates(text) {
  const block = captureTopLevelBlock(text, 'required_gates');
  if (block === null) return [];

  let itemIndent = null;
  let current = null;
  const names = [];

  const finishItem = () => {
    if (!current?.checkName || current.duplicateCheckName) return false;
    names.push(current.checkName);
    return true;
  };

  for (const line of block.split(/\r?\n/)) {
    const content = line.trimStart();
    if (!content || content.startsWith('#')) continue;

    const indent = line.length - content.length;
    const item = /^-([ \t]*)(.*)$/.exec(content);
    if (item) {
      if (indent === 0 || (itemIndent !== null && indent !== itemIndent)) return [];
      if (current && !finishItem()) return [];
      itemIndent ??= indent;
      current = { checkName: null, duplicateCheckName: false, propertyIndent: null };

      const separator = item[1];
      const inline = item[2].trim();
      if (!inline) continue;
      if (!separator) return [];
      if (inline.startsWith('#')) continue;
      const property = parseMappingProperty(inline);
      if (!property) return [];
      current.propertyIndent = itemIndent + 1 + separator.length;
      if (property.key === 'check_name') {
        current.checkName = parseCheckNameScalar(property.value);
        if (!current.checkName) return [];
      }
      continue;
    }

    if (!current || indent <= itemIndent) return [];
    current.propertyIndent ??= indent;
    if (indent < current.propertyIndent) return [];
    if (indent > current.propertyIndent) continue;

    const property = parseMappingProperty(content);
    if (!property) return [];
    if (property.key === 'check_name') {
      if (current.checkName !== null) current.duplicateCheckName = true;
      current.checkName = parseCheckNameScalar(property.value);
      if (!current.checkName) return [];
    }
  }

  if (!current || !finishItem()) return [];
  return names;
}

export function parseRequiredGateCheckNames(body) {
  const text = String(body || '');
  // A present plural declaration is authoritative. If it is empty or
  // malformed, do not fall back to a legacy block and accidentally pass open.
  if (/^required_gates:/m.test(text)) return parsePluralRequiredGates(text);

  const legacy = parseLegacyRequiredGate(text);
  return legacy ? [legacy] : [];
}

export function parseRequiredGateCheckName(body) {
  return parseRequiredGateCheckNames(body)[0] || null;
}

export function readRequiredGateCheckNames(root) {
  try {
    return parseRequiredGateCheckNames(readFileSync(join(root, '.agent', 'check-map.yml'), 'utf8'));
  } catch {
    return [];
  }
}

export function readRequiredGateCheckName(root) {
  return readRequiredGateCheckNames(root)[0] || null;
}

const DOC_EXTENSIONS_RE = /\.(md|txt|png|jpg|jpeg|gif|svg|webp|bmp|ico|avif)$/i;
const PLACEHOLDER_RE = /\b(TODO|TBD|FIXME|PLACEHOLDER|NOT YET|NONE YET|N\/A)\b/i;

// #124 S3: the marker's `changelog` DoD section stays required and substantive,
// but CHANGELOG.md is release-class (folded at release-cut by docs:changelog,
// never edited per PR), so close-scan auto-records this decision instead of
// asking for a `.changelog/unreleased/*` fragment. Kept >= 10 chars and
// placeholder-free so isSubstantiveDecision accepts it.
export const RELEASE_CHANGELOG_DECISION =
  'not required per PR: CHANGELOG.md is release-class, folded at release cut by npm run docs:changelog (#124 S3)';
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
  const requiredChecks = [{ name: 'pr-contract', reason: 'PR metadata contract' }];

  // #124 S2: the docs DoD section is ALWAYS evaluated — substance scales
  // inside evaluateDocsDecision (docs-only and untriggered diffs auto-pass),
  // never by dropping the check from scope.
  requiredChecks.push({
    name: 'docs',
    reason: 'Closeout DoD docs section — doc-map-owned docs updated, explained, or visibly waived',
  });
  // #124 S3: repo-update-log and changelog are no longer per-PR local parity
  // checks. The repo-update-log fragment ledger is retired, and CHANGELOG.md is
  // release-class (folded at release-cut by docs:changelog, no per-PR edit), so
  // neither belongs in the PR-time set. The marker still carries a substantive
  // `changelog` DoD decision (RELEASE_CHANGELOG_DECISION), auto-recorded by
  // scan-complete — it is a marker section, not a local check.
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
    touchesWorkflow,
    touchesHook,
    touchesPolicy,
    touchesCode,
    touchesDependency,
    requiredChecks,
  };
}

export function evaluateRequiredChecks({
  checkRuns = [],
  requiredCheckNames,
  requiredCheckName = DEFAULT_REQUIRED_GATE,
} = {}) {
  const names = requiredCheckNames === undefined
    ? [requiredCheckName]
    : requiredCheckNames;
  if (
    !Array.isArray(names)
    || names.length === 0
    || names.some((name) => typeof name !== 'string' || !name.trim())
  ) {
    return {
      ok: false,
      failures: ['Required check declaration is missing, empty, or malformed.'],
      matched: null,
      matches: [],
    };
  }

  const normalizedNames = names.map((name) => name.trim());
  const failures = [];
  const matches = [];
  const pendingStates = new Set(['queued', 'pending', 'in_progress', 'requested', 'waiting', 'expected']);

  for (const name of normalizedNames) {
    const matched = checkRuns.find((check) => String(check.name || '') === name) || null;
    if (!matched) {
      failures.push(`Required check \`${name}\` is unavailable for the current PR head.`);
      continue;
    }
    matches.push(matched);

    const status = String(matched.status || matched.state || '').toLowerCase();
    const conclusion = String(matched.conclusion || '').toLowerCase();
    if (conclusion === 'success' || status === 'success' || status === 'successful') continue;
    if (pendingStates.has(status) && !conclusion) {
      failures.push(`Required check \`${name}\` is not completed yet (status: ${status}).`);
      continue;
    }
    failures.push(
      `Required check \`${name}\` is not successful (conclusion: ${conclusion || status || 'unknown'}).`,
    );
  }

  return {
    ok: failures.length === 0,
    failures,
    matched: matches[0] || null,
    matches,
  };
}

// #124 S2: the closeout Definition of Done is exactly these four decisions,
// each captured (incrementally via close:dod, or at scan time) and bound to
// the final HEAD by the marker. Order is display order.
export const DOD_SECTIONS = ['docs', 'changelog', 'verification', 'findings'];

// Minimal glob for doc-map `owns`/`heal_when` patterns (zero-dep, twin of
// scripts/doc-health/lib.mjs docMapGlobToRegExp, same discipline as the
// check-map reader above): `**/` spans ZERO or more segments (so
// scripts/**/*.mjs matches root-level scripts/foo.mjs — repo-template#146
// review round 4), a bare `**` spans anything, `*` stays within one segment,
// everything else is literal, anchored both ends.
const GLOB_LITERAL_ESCAPE = /[.+^${}()|[\]\\]/;
function globToRegExp(glob) {
  const source = String(glob);
  let out = '';
  let i = 0;
  while (i < source.length) {
    if (source.startsWith('**/', i)) {
      out += '(?:.*/)?';
      i += 3;
    } else if (source.startsWith('**', i)) {
      out += '.*';
      i += 2;
    } else if (source[i] === '*') {
      out += '[^/]*';
      i += 1;
    } else {
      out += GLOB_LITERAL_ESCAPE.test(source[i]) ? `\\${source[i]}` : source[i];
      i += 1;
    }
  }
  return new RegExp(`^${out}$`);
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
  return DOC_EXTENSIONS_RE.test(file);
}

function isPolicyPath(file) {
  return file === 'AGENTS.md'
    || file === 'CLAUDE.md'
    || file === 'GEMINI.md'
    || file.startsWith('.agent/')
    || file.startsWith('.github/');
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
