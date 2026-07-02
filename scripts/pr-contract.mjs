import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_BRANCH_PATTERN = '^(agent|feat|fix|chore|docs|ci|test|refactor|perf|release|dependabot)\\/[A-Za-z0-9._\\/-]+$';
const DEFAULT_DOC_EXTENSIONS = 'md|txt|png|jpg|jpeg|gif|svg|webp|bmp|ico|avif';
const DEFAULT_DOC_PREFIXES = ['.changelog/'];
const DEFAULT_REQUIRED_HEADINGS = [
  { level: 2, text: 'Summary' },
  { level: 2, text: 'Verification' },
  { level: 3, text: 'Verification Notes' },
  { level: 2, text: 'Docs / Changelog' },
];

const TITLE_RE = /^(feat|fix|refactor|test|docs|style|chore|perf|ci|build|revert)(\([^)]+\))?: .+/;
const ISSUE_RE = /\b(Closes|Fixes|Refs)\s+#\d+\b/i;
// "placeholder" is valid completed prose; reject explicit unfilled markers.
const PLACEHOLDER_RE = /\b(TODO|TBD|FIXME|FILL ME|FILL IN|REPLACE THIS|NOT YET|N\/A|NONE YET)\b|#\s*(?:___|<[^>]+>)|<set-before-merge>/i;
const CHECKED_RE = /^\s*[-*]\s+\[[xX]\]\s+(.+?)\s*$/;
const UNCHECKED_RE = /^\s*[-*]\s+\[\s\]\s+(.+?)\s*$/;
// Substance-only contract (owner decision 2026-07-01, #99): any non-empty
// bullet in `## Verification` counts as a verification item — the contract
// requires that something substantive is recorded, not a specific checkbox
// format. The negative lookahead keeps checkbox lines out of the plain-item
// match so each line is classified exactly once.
const ITEM_RE = /^\s*[-*]\s+(?!\[[ xX]\]\s)(.+?)\s*$/;
const GENERIC_VERIFICATION_RE = /\b(automated ci checks? green|ci[- ]?green|ci checks? pass(?:ed|es)?|checks? green|all checks? pass(?:ed|es)?|tests? pass(?:ed|es)?)\b/i;

/**
 * Validate PR metadata against the ArchonVII ready-for-review contract.
 *
 * @param {object} input
 * @param {string} input.title
 * @param {string} input.body
 * @param {string} input.branch
 * @param {string[]} input.files
 * @param {object} [options]
 * @returns {{ok:boolean, errors:Array<{code:string,message:string,path:string}>, warnings:Array<{code:string,message:string,path:string}>, facts:object}}
 */
export function validatePrContract(input, options = {}) {
  const rules = normalizeRules(options);
  const data = {
    title: input.title || '',
    body: input.body || '',
    branch: input.branch || '',
    files: Array.isArray(input.files) ? input.files : [],
  };

  const errors = [];
  const warnings = [];
  const docsOnly = isDocsOnly(data.files, rules);

  if (rules.requireTitle && !TITLE_RE.test(data.title)) {
    errors.push(error(
      'invalid_title',
      'PR title must use Conventional Commits format, for example `feat(scope): summary`.',
      'title',
    ));
  }

  if (rules.rejectPlaceholderTitle && hasPlaceholder(data.title)) {
    errors.push(error('placeholder_title', 'PR title contains placeholder text.', 'title'));
  }

  if (rules.requireBranch && !rules.branchPattern.test(data.branch)) {
    errors.push(error(
      'invalid_branch',
      `Head branch \`${data.branch || '(empty)'}\` does not match the required branch pattern.`,
      'branch',
    ));
  }

  if (!docsOnly) {
    validateBody(data.body, rules, errors, warnings);
  }

  const items = collectVerificationItems(data.body);
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    facts: {
      docsOnly,
      checkedVerificationCount: items.checked.length,
      verificationItemCount: [...items.checked, ...items.unchecked, ...items.plain]
        .filter((item) => item.claim.length > 0).length,
    },
  };
}

export function formatPrContractResult(result) {
  if (result.ok) {
    const suffix = result.facts.docsOnly ? ' (docs-only body ceremony skipped)' : '';
    const lines = [`PR contract passed${suffix}.`];
    if (result.warnings.length > 0) {
      lines.push('', 'Advisories (non-blocking):');
      for (const item of result.warnings) {
        lines.push(`- [${item.code}] ${item.message}`);
      }
    }
    return lines.join('\n');
  }

  const lines = ['PR contract failed.', '', 'Required fixes:'];
  for (const item of result.errors) {
    lines.push(`- [${item.code}] ${item.message}`);
  }
  if (result.warnings.length > 0) {
    lines.push('', 'Advisories (non-blocking):');
    for (const item of result.warnings) {
      lines.push(`- [${item.code}] ${item.message}`);
    }
  }
  return lines.join('\n');
}

/**
 * Validate that a committed PR template can satisfy the contract's required
 * heading structure (all required headings present, in the required order).
 *
 * Unlike validatePrContract, this checks STRUCTURE ONLY — not checked boxes,
 * placeholders, or substantive content — because a template legitimately ships
 * with unchecked boxes and TODO/comment placeholders. It catches the drift
 * class where a repo's own .github/PULL_REQUEST_TEMPLATE.md cannot itself pass
 * the gate it is subject to (e.g. a pre-strict template using `## Changelog`
 * instead of `## Docs / Changelog`, or missing `### Verification Notes`).
 * Source: /page-gm incident 2026-06-07 (ArchonVII/hudson-bend#43;
 * ArchonVII/github-workflows#53).
 *
 * @param {string} templateBody Raw PULL_REQUEST_TEMPLATE.md contents.
 * @param {object} [options]
 * @param {Array} [options.requiredHeadings] Defaults to DEFAULT_REQUIRED_HEADINGS.
 * @returns {{ok:boolean, errors:Array<{code:string,message:string,path:string}>, warnings:Array, facts:object}}
 */
export function validatePrTemplate(templateBody, options = {}) {
  const required = normalizeHeadings(options.requiredHeadings || DEFAULT_REQUIRED_HEADINGS);
  const errors = [];
  const headings = parseHeadings(templateBody || '');
  validateHeadingOrder(headings, required, errors);
  return {
    ok: errors.length === 0,
    errors,
    warnings: [],
    facts: { headingCount: headings.length },
  };
}

export function formatPrTemplateResult(result) {
  if (result.ok) {
    return 'PR template conforms to the required contract structure.';
  }

  const lines = [
    'PR template does NOT conform to the strict PR contract structure.',
    'Filling this template out verbatim would fail `repo-required-gate / pr contract`.',
    'Sync `.github/PULL_REQUEST_TEMPLATE.md` from ArchonVII/repo-template.',
    '',
    'Structure issues:',
  ];
  for (const item of result.errors) {
    lines.push(`- [${item.code}] ${item.message}`);
  }
  return lines.join('\n');
}

export function loadPrFromGh({ repo, pr }) {
  if (!repo) throw new Error('Missing required --repo owner/name argument.');
  if (!pr) throw new Error('Missing required --pr number argument.');

  const raw = execFileSync(
    'gh',
    ['pr', 'view', String(pr), '--repo', repo, '--json', 'number,title,body,headRefName,isDraft,files,url'],
    { encoding: 'utf8' },
  );
  const parsed = JSON.parse(raw);
  return {
    number: parsed.number,
    url: parsed.url,
    title: parsed.title || '',
    body: parsed.body || '',
    branch: parsed.headRefName || '',
    isDraft: Boolean(parsed.isDraft),
    files: (parsed.files || []).map((file) => file.path || file.filename).filter(Boolean),
  };
}

function validateBody(body, rules, errors, warnings) {
  const headings = parseHeadings(body);

  if (rules.requireIssueLink && !ISSUE_RE.test(body)) {
    errors.push(error(
      'missing_issue_link',
      'PR body must link an issue with `Closes #N`, `Fixes #N`, or `Refs #N`.',
      'body',
    ));
  }

  if (rules.rejectPlaceholders && hasPlaceholder(stripHtmlComments(body))) {
    errors.push(error(
      'placeholder_text',
      'PR body contains placeholder text such as TODO, TBD, N/A, or an unset issue marker.',
      'body',
    ));
  }

  // Heading presence/order is advisory since #99: sections are located by
  // name, so the substance checks below still hard-fail when a section's
  // content is genuinely missing — only the exact structure is soft.
  validateHeadingOrder(headings, rules.requiredHeadings, warnings);

  const summary = sectionContent(body, headings, 'Summary');
  if (rules.requireSummary && !hasSubstantiveContent(summary)) {
    errors.push(error('empty_summary', '`## Summary` must contain substantive content.', 'body'));
  }

  const notes = sectionContent(body, headings, 'Verification Notes');
  if (rules.requireSubstantiveVerificationNotes && !hasSubstantiveContent(notes)) {
    errors.push(error(
      'empty_verification_notes',
      '`### Verification Notes` must contain substantive non-placeholder verification detail.',
      'body',
    ));
  }
  if (rules.rejectGenericVerificationNotes && GENERIC_VERIFICATION_RE.test(maskCodeAndQuotes(notes).trim())) {
    errors.push(error(
      'generic_verification_notes',
      '`### Verification Notes` must not be a generic CI/tests-passed statement.',
      'body',
    ));
  }

  const docs = sectionContent(body, headings, 'Docs / Changelog');
  if (rules.requireDocsChangelog && !hasSubstantiveContent(docs)) {
    errors.push(error('empty_docs_changelog', '`## Docs / Changelog` must describe docs or changelog handling.', 'body'));
  }

  const { verification, checked, unchecked, plain } = collectVerificationItems(body);
  const allItems = [...checked, ...unchecked, ...plain];
  const substantiveItems = allItems.filter((item) => item.claim.length > 0);

  if (rules.requireCheckedVerification && substantiveItems.length === 0) {
    errors.push(error(
      'missing_verification_item',
      '`## Verification` must include at least one verification item — a bullet or checkbox recording what was actually run or checked.',
      'body',
    ));
  }

  for (const item of unchecked) {
    warnings.push(error(
      'unchecked_verification_item',
      `Verification item is unchecked; it still counts as an item, but reads as not-done: "${item.claim}".`,
      'body',
    ));
  }

  for (const item of allItems) {
    if (GENERIC_VERIFICATION_RE.test(item.claim)) {
      errors.push(error(
        'generic_verification',
        `Verification item is too generic: "${item.claim}". Record the actual command, check, or manual action.`,
        'body',
      ));
    }
  }

  for (const item of checked) {
    if (rules.requireEvidenceBlocks && !hasEvidenceBlockAfter(verification, item.index)) {
      warnings.push(error(
        'missing_evidence_block',
        `Checked verification item "${item.claim}" is not followed by a fenced \`\`\`evidence block (recommended shape; advisory since #99).`,
        'body',
      ));
    }
  }

  if (warnings.length === 0 && headings.length === 0 && body.trim() !== '') {
    warnings.push(error('no_headings', 'PR body has no markdown headings.', 'body'));
  }
}

function normalizeRules(options) {
  const docPrefixes = Array.isArray(options.docOnlyPathPrefixes)
    ? options.docOnlyPathPrefixes
    : String(options.docOnlyPathPrefixes || DEFAULT_DOC_PREFIXES.join('\n'))
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);

  return {
    requireTitle: options.requireTitle !== false,
    rejectPlaceholderTitle: options.rejectPlaceholderTitle !== false,
    requireBranch: options.requireBranch !== false,
    branchPattern: new RegExp(options.branchPattern || DEFAULT_BRANCH_PATTERN),
    docExtensions: new RegExp(`\\.(${options.docOnlyExtensions || DEFAULT_DOC_EXTENSIONS})$`, 'i'),
    docPrefixes,
    requireIssueLink: options.requireIssueLink !== false,
    rejectPlaceholders: options.rejectPlaceholders !== false,
    requiredHeadings: normalizeHeadings(options.requiredHeadings || DEFAULT_REQUIRED_HEADINGS),
    requireSummary: options.requireSummary !== false,
    requireDocsChangelog: options.requireDocsChangelog !== false,
    requireSubstantiveVerificationNotes: options.requireSubstantiveVerificationNotes !== false,
    rejectGenericVerificationNotes: options.rejectGenericVerificationNotes !== false,
    requireCheckedVerification: options.requireCheckedVerification !== false,
    requireEvidenceBlocks: options.requireEvidenceBlocks !== false,
  };
}

function normalizeHeadings(headings) {
  return headings.map((heading) => {
    if (typeof heading === 'string') {
      const match = heading.match(/^(#{2,6})\s+(.+)$/);
      if (!match) throw new Error(`Invalid required heading: ${heading}`);
      return { level: match[1].length, text: cleanHeadingText(match[2]) };
    }
    return { level: heading.level, text: cleanHeadingText(heading.text) };
  });
}

function parseHeadings(body) {
  const headings = [];
  const lines = (body || '').split(/\r?\n/);
  let offset = 0;

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
    const line = lines[lineNumber];
    const match = line.match(/^(#{2,6})\s+(.+?)\s*#*\s*$/);
    if (match) {
      headings.push({
        level: match[1].length,
        text: cleanHeadingText(match[2]),
        lineNumber,
        start: offset,
      });
    }
    offset += line.length + 1;
  }

  for (let i = 0; i < headings.length; i++) {
    headings[i].end = i + 1 < headings.length ? headings[i + 1].start : body.length;
  }

  return headings;
}

function validateHeadingOrder(headings, required, errors) {
  let cursor = -1;

  for (const expected of required) {
    const foundIndex = headings.findIndex(
      (heading, index) => index > cursor && heading.level === expected.level && sameHeading(heading.text, expected.text),
    );

    if (foundIndex === -1) {
      errors.push(error(
        'missing_heading',
        `PR body must include \`${'#'.repeat(expected.level)} ${expected.text}\` in the required order.`,
        'body',
      ));
      return;
    }

    cursor = foundIndex;
  }
}

function sectionContent(body, headings, name, options = {}) {
  const start = headings.find((heading) => sameHeading(heading.text, name));
  if (!start) return '';

  let end = start.end;
  if (options.stopBefore) {
    const stop = headings.find(
      (heading) => heading.start > start.start && sameHeading(heading.text, options.stopBefore),
    );
    if (stop) end = stop.start;
  }

  const raw = body.slice(start.start, end);
  return raw.split(/\r?\n/).slice(1).join('\n').trim();
}

function hasEvidenceBlockAfter(section, checkedLineIndex) {
  const lines = section.split(/\r?\n/);
  for (let i = checkedLineIndex + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '') continue;
    return /^```\s*evidence\s*$/i.test(trimmed);
  }
  return false;
}

// Classify every line of the `## Verification` section (fenced blocks masked
// so evidence field values are never misread as items) into checked boxes,
// unchecked boxes, and plain bullets. Line indexes are preserved through the
// masking so evidence-adjacency checks still run against the raw section.
function collectVerificationItems(body) {
  const headings = parseHeadings(body || '');
  const verification = sectionContent(body || '', headings, 'Verification', { stopBefore: 'Verification Notes' });
  const checked = [];
  const unchecked = [];
  const plain = [];
  maskFencedLines(verification).forEach((line, index) => {
    let match = line.match(CHECKED_RE);
    if (match) {
      checked.push({ claim: match[1].trim(), index });
      return;
    }
    match = line.match(UNCHECKED_RE);
    if (match) {
      unchecked.push({ claim: match[1].trim(), index });
      return;
    }
    match = line.match(ITEM_RE);
    if (match) plain.push({ claim: match[1].trim(), index });
  });
  return { verification, checked, unchecked, plain };
}

// Blank out fence delimiters and fenced content while preserving line count,
// so indexes into the raw section stay valid.
function maskFencedLines(text) {
  let inFence = false;
  return String(text || '').split(/\r?\n/).map((line) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return '';
    }
    return inFence ? '' : line;
  });
}

function isDocsOnly(files, rules) {
  return files.length > 0 && files.every((file) => {
    const normalized = file.replace(/\\/g, '/');
    return rules.docExtensions.test(normalized)
      || rules.docPrefixes.some((prefix) => normalized.startsWith(prefix));
  });
}

function hasSubstantiveContent(text) {
  const cleaned = stripHtmlComments(text)
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s+\[[ xX]\]\s+/, '').trim())
    .filter((line) => line && !line.startsWith('<!--') && !line.startsWith('```'))
    .join(' ')
    .trim();
  return cleaned.length >= 20 && !hasPlaceholder(cleaned);
}

function hasPlaceholder(text) {
  return PLACEHOLDER_RE.test(text || '') || hasLiteralPlaceholderFiller(text);
}

function hasLiteralPlaceholderFiller(text) {
  const raw = stripHtmlComments(text);
  const candidates = [
    raw,
    ...raw.split(/\r?\n/),
  ];
  return candidates.some((candidate) => {
    const cleaned = normalizePlaceholderCandidate(candidate);
    const words = cleaned.toLowerCase().match(/[a-z]+/g) || [];
    return words.length > 0
      && (
        words.every((word) => word === 'placeholder')
        || words.join(' ') === 'placeholder text'
      );
  });
}

function normalizePlaceholderCandidate(text) {
  return String(text || '')
    .replace(/^[-*]\s+\[[ xX]\]\s+/, '')
    .replace(/^[-*]\s+/, '')
    .replace(/^(?:feat|fix|refactor|test|docs|style|chore|perf|ci|build|revert)(?:\([^)]+\))?:\s*/i, '')
    .replace(/^[A-Za-z][A-Za-z -]{0,40}:\s*/, '')
    .replace(/[`"'[\]{}()<>]/g, ' ')
    .trim();
}

// Remove HTML comments before placeholder scanning so a template's own
// instructional comment (which legitimately contains words like "placeholder"
// or "TODO") does not trip the contract. Evidence-block field values are NOT
// stripped, so `command: TODO` inside a ```evidence block still fails.
// Source: forensic analysis of session 019eccc1 (F4) + owner refinement 5.
function stripHtmlComments(text) {
  return String(text || '').replace(/<!--[\s\S]*?-->/g, ' ');
}

// Mask fenced code/evidence blocks, inline code spans, and blockquoted lines
// from FREE PROSE before the generic-verification scan, so an explanatory note
// may quote a command or diagnostic (e.g. a cited `npm test` line) without being
// rejected as a generic "tests passed" claim. Checked checkbox claims are scanned
// raw (not masked), so `- [x] tests passed` still fails.
// Source: forensic analysis of session 019eccc1 (F7) + owner refinement 5.
function maskCodeAndQuotes(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .split(/\r?\n/)
    .map((line) => (/^\s*>/.test(line) ? ' ' : line))
    .join('\n');
}

function sameHeading(left, right) {
  return cleanHeadingText(left).toLowerCase() === cleanHeadingText(right).toLowerCase();
}

function cleanHeadingText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function error(code, message, path) {
  return { code, message, path };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (item === '-h' || item === '--help') {
      args.help = true;
      continue;
    }
    if (!item.startsWith('--')) continue;

    const key = item.slice(2);
    if (key === 'json' || key === 'help') {
      args[key] = true;
      continue;
    }
    args[key] = argv[i + 1];
    i += 1;
  }
  return args;
}

function loadInputFromEvent(eventPath, filesJson) {
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  const pr = event.pull_request;
  if (!pr) throw new Error('--event-path must point to a pull_request event payload.');

  const files = filesJson ? JSON.parse(filesJson) : [];
  return {
    title: pr.title || '',
    body: pr.body || '',
    branch: pr.head?.ref || '',
    files,
    isDraft: Boolean(pr.draft),
    number: pr.number,
    url: pr.html_url,
  };
}

// Pre-publish input adapter: validate a locally drafted body with NO remote PR.
// `--body-file -` reads the body from stdin so the agent never needs a temp file.
// Pair with --title / --branch / --files-json so the SAME contract that CI runs
// after creation can be run locally before `gh pr create`.
// Source: forensic analysis of session 019eccc1 (F2/F3) — the keystone that
// removes the push -> create -> amend -> re-scan loop.
function loadInputFromBodyFile(args) {
  const source = args['body-file'];
  const body = readFileSync(source === '-' ? 0 : source, 'utf8');
  const files = args['files-json'] ? JSON.parse(args['files-json']) : [];
  return {
    title: args.title || '',
    body,
    branch: args.branch || '',
    files,
    isDraft: true,
    number: null,
    url: null,
  };
}

function printUsage() {
  process.stdout.write(`Usage: pr-contract.mjs <input-mode> [options]

Validate a PR against the ArchonVII ready-for-review contract. The same
validator runs locally (before a PR exists) and in CI (after) — identical rules.

Input modes (choose one):
  --body-file <path|->          Validate a locally drafted body. '-' reads stdin.
                                Pair with --title, --branch, --files-json.
  --repo <owner/name> --pr <n>  Validate an existing remote PR (via gh pr view).
  --event-path <path>           Validate a pull_request event payload (CI).

Options:
  --title <text>                PR title (body-file mode).
  --branch <name>               Head branch (body-file mode).
  --files-json <json>           JSON array of changed file paths (docs-only detection).
  --branch-pattern <regex>      Override the allowed head-branch pattern.
  --doc-only-extensions <exts>  Override the docs-only file extensions.
  --doc-only-path-prefixes <p>  Override docs-only path prefixes (newline-separated).
  --json                        Emit the full result object as JSON.
  -h, --help                    Show this help.

Exit code: 0 = contract passes, 1 = fails.
`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  let input;
  if (args['body-file']) {
    input = loadInputFromBodyFile(args);
  } else if (args['event-path']) {
    input = loadInputFromEvent(args['event-path'], args['files-json'] || process.env.PR_CONTRACT_FILES_JSON);
  } else {
    input = loadPrFromGh({ repo: args.repo, pr: args.pr });
  }

  const result = validatePrContract(input, {
    branchPattern: args['branch-pattern'],
    docOnlyExtensions: args['doc-only-extensions'],
    docOnlyPathPrefixes: args['doc-only-path-prefixes'],
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatPrContractResult(result)}\n`);
  }

  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main();
}
