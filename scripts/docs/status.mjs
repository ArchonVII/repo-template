#!/usr/bin/env node
// docs/STATUS.md dashboard (#124, S1; rendered class — NEVER committed).
// Inputs are volatile (live gh state, doc-health), which is exactly why this
// surface is rendered on demand instead of committed and drift-gated: a
// committed copy would false-fail merges whenever the world moved with no
// diff. docs/STATUS.md is gitignored; run `npm run docs:status` to refresh.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Pure: volatile snapshots in, display model out. `now` is injected so tests
// and callers control the timestamp. `docHealth` is a doc-health.v1 report
// (scripts/doc-health/health.mjs --json): findings carry severity/code/path,
// where anything not 'warning' counts as blocking. prsError/issuesError carry
// a failed gh snapshot so the dashboard never renders a failure as zero work.
export function buildStatusModel({ prs = [], issues = [], prsError = null, issuesError = null, docHealth = null, now }) {
  const findings = Array.isArray(docHealth?.findings) ? docHealth.findings : [];
  const docWarningCount = findings.filter((f) => f.severity === 'warning').length;
  return {
    generatedAt: now,
    openPrs: prs.map((pr) => ({ number: pr.number, title: pr.title, draft: Boolean(pr.isDraft), url: pr.url })),
    draftPrCount: prs.filter((pr) => pr.isDraft).length,
    openIssues: issues.map((issue) => ({
      number: issue.number,
      title: issue.title,
      labels: (issue.labels || []).map((l) => l.name).filter(Boolean),
      url: issue.url,
    })),
    prsError,
    issuesError,
    docFindings: findings,
    docWarningCount,
    docErrorCount: findings.length - docWarningCount,
  };
}

export function renderStatusMarkdown(model) {
  const lines = [
    '# STATUS — live dashboard',
    '',
    `_Class: rendered, not committed (.agent/doc-map.yml). Generated ${model.generatedAt} by \`npm run docs:status\`. Do not commit this file._`,
    '',
    `## Open PRs (${model.prsError ? 'unavailable' : `${model.openPrs.length}, ${model.draftPrCount} draft`})`,
    '',
    ...(model.prsError
      ? [`- snapshot failed: ${model.prsError}`]
      : model.openPrs.length === 0
        ? ['- none']
        : model.openPrs.map((pr) => `- #${pr.number}${pr.draft ? ' (draft)' : ''} ${pr.title} — ${pr.url}`)),
    '',
    `## Open issues (${model.issuesError ? 'unavailable' : model.openIssues.length})`,
    '',
    ...(model.issuesError
      ? [`- snapshot failed: ${model.issuesError}`]
      : model.openIssues.length === 0
        ? ['- none']
        : model.openIssues.map(
            (i) => `- #${i.number} ${i.title}${i.labels.length ? ` [${i.labels.join(', ')}]` : ''} — ${i.url}`
          )),
    '',
    `## Doc health (${model.docErrorCount} blocking, ${model.docWarningCount} warning${model.docWarningCount === 1 ? '' : 's'})`,
    '',
    ...(model.docFindings.length === 0
      ? ['- clean']
      : model.docFindings.map(
          (f) =>
            `- [${f.severity}] ${f.code}: ${f.path}${f.line ? `:${f.line}` : ''}${f.message ? ` — ${f.message}` : ''}`
        )),
    '',
  ];
  return lines.join('\n');
}

// gh pr/issue list default to 30 items (gh CLI manual); an unqualified list
// would render truncated arrays as exact counts. 1000 is far above any open
// set in this ecosystem, and a snapshot that fills it exactly is flagged as
// truncated in runStatus rather than presented as exact (#144 review).
export const GH_LIST_LIMIT = 1000;

function ghJson(args, { cwd, exec = execFileSync } = {}) {
  try {
    // cwd pins gh's repo resolution to the requested root — without it a
    // `--repo <elsewhere>` run would snapshot the caller's checkout instead.
    return JSON.parse(exec('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd }));
  } catch (err) {
    // The dashboard degrades rather than dies when gh is unavailable — it is a
    // read surface, not a gate. The failure is surfaced in the output.
    return { __error: err.message.split('\n')[0] };
  }
}

function docHealthJson(root) {
  try {
    const out = execFileSync(
      process.execPath,
      [join(root, 'scripts', 'doc-health', 'health.mjs'), '--repo', root, '--json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    return JSON.parse(out);
  } catch (err) {
    // health.mjs exits non-zero when it finds blocking problems, but still
    // prints its JSON report; salvage it before falling back to a stub.
    if (err.stdout) {
      try {
        return JSON.parse(err.stdout);
      } catch {
        /* fall through */
      }
    }
    // Same doc-health.v1 finding shape the real producer emits, and severity
    // 'blocking' so a broken checker shows up in the error count, not as clean.
    return {
      findings: [
        {
          severity: 'blocking',
          code: 'doc-health-run',
          path: 'scripts/doc-health/health.mjs',
          message: err.message.split('\n')[0],
        },
      ],
    };
  }
}

// A snapshot that fills GH_LIST_LIMIT exactly is (almost certainly) truncated;
// reporting it as an exact count is the same lie as the 30-item default.
function snapshotError(result) {
  if (!Array.isArray(result)) return result?.__error ?? 'gh returned unexpected output';
  if (result.length === GH_LIST_LIMIT) return `snapshot truncated at ${GH_LIST_LIMIT} items`;
  return null;
}

export function runStatus({ root, now = new Date().toISOString(), exec = execFileSync }) {
  const gh = { cwd: root, exec };
  const prs = ghJson(['pr', 'list', '--limit', String(GH_LIST_LIMIT), '--json', 'number,title,isDraft,url'], gh);
  const issues = ghJson(['issue', 'list', '--limit', String(GH_LIST_LIMIT), '--json', 'number,title,labels,url'], gh);
  const prsError = snapshotError(prs);
  const issuesError = snapshotError(issues);
  const model = buildStatusModel({
    prs: !prsError ? prs : [],
    issues: !issuesError ? issues : [],
    prsError,
    issuesError,
    docHealth: docHealthJson(root),
    now,
  });
  const target = join(root, 'docs', 'STATUS.md');
  writeFileSync(target, renderStatusMarkdown(model), 'utf8');
  return { target, model };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { parseGeneratorArgs } = await import('./lib.mjs');
  const args = parseGeneratorArgs(process.argv.slice(2));
  const { target } = runStatus({ root: args.root });
  console.log(`rendered ${target} (not committed)`);
}
