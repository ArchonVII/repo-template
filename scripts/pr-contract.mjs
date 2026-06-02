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
const PLACEHOLDER_RE = /\b(TODO|TBD|FIXME|FILL ME|FILL IN|REPLACE THIS|PLACEHOLDER|NOT YET|N\/A|NONE YET)\b|#\s*(?:___|<[^>]+>)|<set-before-merge>/i;
const CHECKED_RE = /^\s*-\s+\[[xX]\]\s+(.+?)\s*$/;
const UNCHECKED_RE = /^\s*-\s+\[\s\]\s+(.+?)\s*$/;
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

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    facts: {
      docsOnly,
      checkedVerificationCount: countCheckedVerificationItems(data.body),
    },
  };
}

export function formatPrContractResult(result) {
  if (result.ok) {
    const suffix = result.facts.docsOnly ? ' (docs-only body ceremony skipped)' : '';
    return `PR contract passed${suffix}.`;
  }

  const lines = ['PR contract failed.', '', 'Required fixes:'];
  for (const item of result.errors) {
    lines.push(`- [${item.code}] ${item.message}`);
  }
  if (result.warnings.length > 0) {
    lines.push('', 'Warnings:');
    for (const item of result.warnings) {
      lines.push(`- [${item.code}] ${item.message}`);
    }
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

  if (rules.rejectPlaceholders && hasPlaceholder(body)) {
    errors.push(error(
      'placeholder_text',
      'PR body contains placeholder text such as TODO, TBD, N/A, or an unset issue marker.',
      'body',
    ));
  }

  validateHeadingOrder(headings, rules.requiredHeadings, errors);

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
  if (rules.rejectGenericVerificationNotes && GENERIC_VERIFICATION_RE.test(notes.trim())) {
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

  const verification = sectionContent(body, headings, 'Verification', { stopBefore: 'Verification Notes' });
  const checkedItems = verification.split(/\r?\n/).map((line, index) => {
    const match = line.match(CHECKED_RE);
    return match ? { claim: match[1].trim(), index } : null;
  }).filter(Boolean);
  const uncheckedItems = verification.split(/\r?\n/).map((line) => {
    const match = line.match(UNCHECKED_RE);
    return match ? match[1].trim() : null;
  }).filter(Boolean);

  if (rules.requireCheckedVerification && checkedItems.length === 0) {
    errors.push(error(
      'missing_checked_verification',
      '`## Verification` must include at least one checked verification item.',
      'body',
    ));
  }

  for (const claim of uncheckedItems) {
    errors.push(error(
      'unchecked_required_box',
      `Unchecked verification item must be completed or removed before ready-for-review: "${claim}".`,
      'body',
    ));
  }

  for (const item of checkedItems) {
    if (GENERIC_VERIFICATION_RE.test(item.claim)) {
      errors.push(error(
        'generic_verification',
        `Checked verification item is too generic: "${item.claim}". Record the actual command, check, or manual action.`,
        'body',
      ));
    }
    if (rules.requireEvidenceBlocks && !hasEvidenceBlockAfter(verification, item.index)) {
      errors.push(error(
        'missing_evidence_block',
        `Checked verification item "${item.claim}" must be followed by a fenced \`\`\`evidence block.`,
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

function countCheckedVerificationItems(body) {
  const headings = parseHeadings(body || '');
  const verification = sectionContent(body || '', headings, 'Verification', { stopBefore: 'Verification Notes' });
  return verification.split(/\r?\n/).filter((line) => CHECKED_RE.test(line)).length;
}

function isDocsOnly(files, rules) {
  return files.length > 0 && files.every((file) => {
    const normalized = file.replace(/\\/g, '/');
    return rules.docExtensions.test(normalized)
      || rules.docPrefixes.some((prefix) => normalized.startsWith(prefix));
  });
}

function hasSubstantiveContent(text) {
  const cleaned = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s+\[[ xX]\]\s+/, '').trim())
    .filter((line) => line && !line.startsWith('<!--') && !line.startsWith('```'))
    .join(' ')
    .trim();
  return cleaned.length >= 20 && !hasPlaceholder(cleaned);
}

function hasPlaceholder(text) {
  return PLACEHOLDER_RE.test(text || '');
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
    if (!item.startsWith('--')) continue;

    const key = item.slice(2);
    if (key === 'json') {
      args.json = true;
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args['event-path']
    ? loadInputFromEvent(args['event-path'], args['files-json'] || process.env.PR_CONTRACT_FILES_JSON)
    : loadPrFromGh({ repo: args.repo, pr: args.pr });

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
