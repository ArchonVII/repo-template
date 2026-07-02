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
// and callers control the timestamp.
export function buildStatusModel({ prs = [], issues = [], docHealth = null, now }) {
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
    docWarnings: docHealth?.warnings ?? [],
    docWarningCount: (docHealth?.warnings ?? []).length,
    docErrorCount: (docHealth?.errors ?? []).length,
  };
}

export function renderStatusMarkdown(model) {
  const lines = [
    '# STATUS — live dashboard',
    '',
    `_Class: rendered, not committed (.agent/doc-map.yml). Generated ${model.generatedAt} by \`npm run docs:status\`. Do not commit this file._`,
    '',
    `## Open PRs (${model.openPrs.length}, ${model.draftPrCount} draft)`,
    '',
    ...(model.openPrs.length === 0
      ? ['- none']
      : model.openPrs.map((pr) => `- #${pr.number}${pr.draft ? ' (draft)' : ''} ${pr.title} — ${pr.url}`)),
    '',
    `## Open issues (${model.openIssues.length})`,
    '',
    ...(model.openIssues.length === 0
      ? ['- none']
      : model.openIssues.map(
          (i) => `- #${i.number} ${i.title}${i.labels.length ? ` [${i.labels.join(', ')}]` : ''} — ${i.url}`
        )),
    '',
    `## Doc health (${model.docErrorCount} errors, ${model.docWarningCount} warnings)`,
    '',
    ...(model.docWarnings.length === 0
      ? ['- no warnings']
      : model.docWarnings.map((w) => `- ${w.rule}: ${w.path}${w.message ? ` — ${w.message}` : ''}`)),
    '',
  ];
  return lines.join('\n');
}

function ghJson(args) {
  try {
    return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
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
    return { warnings: [], errors: [{ rule: 'doc-health-run', path: '(doc-health failed to run)' }] };
  }
}

export function runStatus({ root, now = new Date().toISOString() }) {
  const prs = ghJson(['pr', 'list', '--json', 'number,title,isDraft,url']);
  const issues = ghJson(['issue', 'list', '--json', 'number,title,labels,url']);
  const model = buildStatusModel({
    prs: Array.isArray(prs) ? prs : [],
    issues: Array.isArray(issues) ? issues : [],
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
