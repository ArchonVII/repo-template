import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ACTIVE_PLAN_STALE_MS,
  CHARTER_BUDGETS,
  REVIEW_STALE_MS,
  TOOL_STUB_BUDGETS,
  earliestTokenLine,
  extractMarkdownLinks,
  hasSupersededByPointer,
  isActiveDoc,
  isCurrentTruthRegister,
  isDurableIndexedDoc,
  isSupersededDoc,
  lineCount,
  lineForIndex,
  linkTargetsFromMarkdown,
  normalizeRel,
  parseDocMetadata,
  readText,
  resolveRelativeTarget,
  stripCode,
  toPosix,
  walkFiles,
} from './lib.mjs';

const SCHEMA_VERSION = 'doc-health.v1';
const STALE_WORDS = ['not deployed', 'next', 'remaining', 'deferred', 'blocked', 'pending'];

export function checkRepo(repoRoot, opts = {}) {
  const root = path.resolve(repoRoot);
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const changedPaths = (opts.changedPaths ?? []).map((p) => normalizeRel(p));
  const files = walkFiles(root);
  const mdFiles = files.filter((f) => f.rel.toLowerCase().endsWith('.md'));
  const byRel = new Map(files.map((f) => [f.rel, f]));
  const metaByRel = new Map();
  const textByRel = new Map();
  const findings = [];

  for (const f of mdFiles) {
    const text = readText(f.abs);
    textByRel.set(f.rel, text);
    metaByRel.set(f.rel, parseDocMetadata(text));
  }

  checkLineBudgets(root, byRel, findings);
  checkReviewCadence(mdFiles, metaByRel, findings, now);
  checkActivePlanCadence(mdFiles, metaByRel, findings, now);
  checkSupersession(mdFiles, metaByRel, findings);
  checkDanglingLinks(root, mdFiles, textByRel, findings);
  checkActivePlaceholders(mdFiles, metaByRel, textByRel, findings);
  checkStartupBaseline(root, findings);
  checkIndexCoherence(root, mdFiles, metaByRel, textByRel, findings);
  checkStaleActiveTerms(mdFiles, metaByRel, textByRel, changedPaths, findings);

  findings.sort((a, b) =>
    a.code.localeCompare(b.code) ||
    a.path.localeCompare(b.path) ||
    (a.line ?? 0) - (b.line ?? 0));

  const issues = findings.map(issuePayloadForFinding);
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date(now).toISOString(),
    repo: root,
    status: findings.length ? 'warnings' : 'clean',
    summary: {
      findings: findings.length,
      warnings: findings.length,
      blocking: 0,
    },
    findings,
    issues,
  };
}

function addFinding(findings, finding) {
  findings.push({
    severity: 'warning',
    ...finding,
  });
}

function checkLineBudgets(root, byRel, findings) {
  for (const [rel, budget] of Object.entries(CHARTER_BUDGETS)) {
    const f = byRel.get(rel);
    if (!f) continue;
    const lines = lineCount(readText(f.abs));
    if (lines > budget) {
      addFinding(findings, {
        code: 'charter-overbudget',
        path: rel,
        line: 1,
        message: `${rel} has ${lines} lines; charter budget is ${budget}.`,
        details: { lines, budget },
      });
    }
  }
  for (const [rel, budget] of Object.entries(TOOL_STUB_BUDGETS)) {
    const f = byRel.get(rel);
    if (!f) continue;
    const lines = lineCount(readText(f.abs));
    if (lines > budget) {
      addFinding(findings, {
        code: 'tool-stub-overbudget',
        path: rel,
        line: 1,
        message: `${rel} has ${lines} lines; tool stub budget is ${budget}.`,
        details: { lines, budget },
      });
    }
  }
}

function checkReviewCadence(mdFiles, metaByRel, findings, now) {
  for (const f of mdFiles) {
    const meta = metaByRel.get(f.rel);
    if (!meta?.lastReviewed) continue;
    const reviewed = Date.parse(String(meta.lastReviewed));
    if (!Number.isFinite(reviewed)) continue;
    const ageMs = now - reviewed;
    if (ageMs > REVIEW_STALE_MS) {
      addFinding(findings, {
        code: 'last-reviewed-stale',
        path: f.rel,
        line: 1,
        message: `${f.rel} was last reviewed more than 90 days ago.`,
        details: {
          lastReviewed: meta.lastReviewed,
          ageDays: Math.floor(ageMs / (24 * 60 * 60 * 1000)),
          cadenceDays: 90,
        },
      });
    }
  }
}

function checkActivePlanCadence(mdFiles, metaByRel, findings, now) {
  for (const f of mdFiles) {
    const isPlan = f.rel.startsWith('docs/plans/') || /^projects\/[^/]+\/PLAN\.md$/i.test(f.rel);
    if (!isPlan) continue;
    const meta = metaByRel.get(f.rel);
    if (!isActiveDoc(meta)) continue;
    const stat = fs.statSync(f.abs);
    const ageMs = now - stat.mtimeMs;
    if (ageMs > ACTIVE_PLAN_STALE_MS) {
      addFinding(findings, {
        code: 'active-plan-stale',
        path: f.rel,
        line: 1,
        message: `${f.rel} is active and has not been touched in more than 30 days.`,
        details: {
          touched: new Date(stat.mtimeMs).toISOString(),
          ageDays: Math.floor(ageMs / (24 * 60 * 60 * 1000)),
          cadenceDays: 30,
        },
      });
    }
  }
}

function checkSupersession(mdFiles, metaByRel, findings) {
  for (const f of mdFiles) {
    const meta = metaByRel.get(f.rel);
    if (!isSupersededDoc(meta)) continue;
    if (!hasSupersededByPointer(meta.supersededBy)) {
      addFinding(findings, {
        code: 'superseded-without-pointer',
        path: f.rel,
        line: 1,
        message: `${f.rel} is superseded but has no concrete Superseded by pointer.`,
        details: { supersededBy: meta.supersededBy ?? null },
      });
    }
  }
}

function checkDanglingLinks(root, mdFiles, textByRel, findings) {
  for (const f of mdFiles) {
    const text = textByRel.get(f.rel);
    for (const link of extractMarkdownLinks(stripCode(text))) {
      const hit = resolveRelativeTarget(root, f.rel, link.target);
      if (!hit.ok) {
        addFinding(findings, {
          code: 'dangling-relative-link',
          path: f.rel,
          line: lineForIndex(stripCode(text), link.index),
          message: `${f.rel} links to missing relative target ${link.target}.`,
          details: { target: link.target },
        });
      }
    }
  }
}

function checkActivePlaceholders(mdFiles, metaByRel, textByRel, findings) {
  const placeholderRe = /(^|[^\w])(TODO|TBD|N\/A)(?=$|[^\w])/i;
  for (const f of mdFiles) {
    const meta = metaByRel.get(f.rel);
    if (!isActiveDoc(meta)) continue;
    const text = stripCode(textByRel.get(f.rel));
    const match = placeholderRe.exec(text);
    if (!match) continue;
    addFinding(findings, {
      code: 'active-placeholder-token',
      path: f.rel,
      line: lineForIndex(text, match.index),
      message: `${f.rel} is active and still contains placeholder token ${match[2]}.`,
      details: { token: match[2] },
    });
  }
}

function checkStartupBaseline(root, findings) {
  const rel = '.agent/startup-baseline.json';
  const abs = path.join(root, '.agent', 'startup-baseline.json');
  if (!fs.existsSync(abs)) return;
  let baseline;
  try {
    baseline = JSON.parse(readText(abs));
  } catch (err) {
    addFinding(findings, {
      code: 'startup-baseline-invalid',
      path: rel,
      line: 1,
      message: `${rel} is not valid JSON: ${err.message}`,
      details: {},
    });
    return;
  }
  for (const required of baseline.required ?? []) {
    const target = path.join(root, ...toPosix(required).split('/'));
    if (!fs.existsSync(target)) {
      addFinding(findings, {
        code: 'startup-baseline-missing-path',
        path: rel,
        line: 1,
        message: `startup baseline requires missing path ${toPosix(required)}.`,
        details: { required: toPosix(required) },
      });
    }
  }
  for (const dir of baseline.expectedDirectories ?? []) {
    const target = path.join(root, ...toPosix(dir).replace(/\/$/, '').split('/'));
    let ok = false;
    try {
      ok = fs.statSync(target).isDirectory();
    } catch {
      ok = false;
    }
    if (!ok) {
      addFinding(findings, {
        code: 'startup-baseline-missing-directory',
        path: rel,
        line: 1,
        message: `startup baseline expects missing directory ${toPosix(dir)}.`,
        details: { expectedDirectory: toPosix(dir) },
      });
    }
  }
}

function checkIndexCoherence(root, mdFiles, metaByRel, textByRel, findings) {
  const indexRel = 'docs/INDEX.md';
  const indexText = textByRel.get(indexRel);
  const indexTargets = indexText ? linkTargetsFromMarkdown(root, indexRel, indexText) : new Set();

  if (indexText) {
    for (const f of mdFiles) {
      const meta = metaByRel.get(f.rel);
      if (!isDurableIndexedDoc(f.rel, meta)) continue;
      if (!indexTargets.has(f.rel)) {
        addFinding(findings, {
          code: 'index-missing-doc',
          path: f.rel,
          line: 1,
          message: `${f.rel} is a durable doc but is absent from docs/INDEX.md.`,
          details: { index: indexRel },
        });
      }
    }
  }

  const adrIndexRel = 'docs/adr/README.md';
  const adrIndexText = textByRel.get(adrIndexRel);
  if (!adrIndexText) return;
  const adrTargets = linkTargetsFromMarkdown(root, adrIndexRel, adrIndexText);
  for (const f of mdFiles) {
    if (!/^docs\/adr\/(?!README\.md$).+\.md$/i.test(f.rel)) continue;
    const meta = metaByRel.get(f.rel);
    if (!meta?.hasFrontmatter) continue;
    if (!adrTargets.has(f.rel)) {
      addFinding(findings, {
        code: 'adr-index-missing',
        path: f.rel,
        line: 1,
        message: `${f.rel} is absent from docs/adr/README.md.`,
        details: { index: adrIndexRel },
      });
    }
  }
}

function checkStaleActiveTerms(mdFiles, metaByRel, textByRel, changedPaths, findings) {
  if (!changedPaths.length) return;
  const changedTruth = changedPaths.some((rel) => {
    const meta = metaByRel.get(rel);
    return meta && isCurrentTruthRegister(rel, meta);
  });
  if (!changedTruth) return;

  for (const f of mdFiles) {
    if (!f.rel.startsWith('docs/')) continue;
    if (isStaleTermScanExcluded(f.rel)) continue;
    const meta = metaByRel.get(f.rel);
    if (!isStaleTermActiveDoc(meta)) continue;
    const tokens = staleTokensIn(textByRel.get(f.rel));
    if (!tokens.length) continue;
    addFinding(findings, {
      code: 'stale-active-doc-term',
      path: f.rel,
      line: earliestTokenLine(textByRel.get(f.rel), tokens),
      message: `${f.rel} is active/current and still carries stale-review token(s): ${tokens.join(', ')}.`,
      details: { tokens },
    });
  }
}

function isStaleTermActiveDoc(meta) {
  if (!meta) return false;
  if (meta.hasFrontmatter) return ['active', 'current', 'canon', 'approved'].includes(meta.statusNorm);
  return meta.statusNorm === 'active';
}

function isStaleTermScanExcluded(rel) {
  return [
    'docs/agent-process/',
    'docs/repo-update-log/',
    'docs/raw/',
    'docs/audits/',
    'docs/superpowers/',
  ].some((prefix) => rel.startsWith(prefix));
}

function staleTokensIn(text) {
  const clean = stripCode(text);
  const tokens = new Set();
  for (const phrase of STALE_WORDS) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = phrase.includes(' ')
      ? new RegExp(escaped, 'i')
      : new RegExp(`\\b${escaped}\\b`, 'i');
    if (re.test(clean)) tokens.add(phrase);
  }
  for (const match of clean.matchAll(/#\d+\b/g)) tokens.add(match[0]);
  for (const match of clean.matchAll(/\bmigrations?\s+\d{4}(?:\s*[–-]\s*\d{4})?\b/gi)) {
    tokens.add(match[0].replace(/\s+/g, ' '));
  }
  return [...tokens].sort();
}

export function issuePayloadForFinding(finding) {
  return {
    title: `doc-health: ${finding.code} in ${finding.path}`,
    labels: ['doc-health'],
    findingCode: finding.code,
    path: finding.path,
    body: [
      'Doc-health reported a warning-only document-policy finding.',
      '',
      `- Code: ${finding.code}`,
      `- Path: ${finding.path}${finding.line ? `:${finding.line}` : ''}`,
      `- Severity: ${finding.severity}`,
      `- Message: ${finding.message}`,
      '',
      'Fixes go through the normal issue/branch/PR lane. The checker is report-only and did not edit docs.',
    ].join('\n'),
  };
}

function parseArgs(argv) {
  const out = {
    repo: process.cwd(),
    json: false,
    report: null,
    changedPaths: [],
    changedFrom: null,
    now: Date.now(),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--repo') {
      out.repo = argv[++i];
    } else if (arg === '--report') {
      out.report = argv[++i];
    } else if (arg === '--changed') {
      out.changedPaths.push(argv[++i]);
    } else if (arg === '--changed-from') {
      out.changedFrom = argv[++i];
    } else if (arg === '--now') {
      out.now = Date.parse(argv[++i]);
    } else if (arg === '--json') {
      out.json = true;
    } else if (arg === '--help' || arg === '-h') {
      out.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!Number.isFinite(out.now)) throw new Error('--now must be an ISO date or timestamp parseable by Date.parse');
  return out;
}

function changedPathsFromGit(repo, ref) {
  const raw = execFileSync('git', ['-C', repo, 'diff', '--name-only', `${ref}...HEAD`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function printHuman(report) {
  const lines = [`doc-health: ${report.summary.warnings} warning(s), ${report.summary.blocking} blocking finding(s)`];
  for (const f of report.findings) {
    lines.push(`[${f.severity}] ${f.code} ${f.path}${f.line ? `:${f.line}` : ''} - ${f.message}`);
  }
  return `${lines.join('\n')}\n`;
}

function usage() {
  return [
    'Usage: node scripts/doc-health/health.mjs --repo <path> [--report <path>] [--json]',
    '       [--changed <path> ...] [--changed-from <git-ref>] [--now <iso-date>]',
    '',
    'Findings are warning-only. The CLI exits 0 when warnings are present.',
  ].join('\n');
}

const isMain = process.argv[1] &&
  (fileURLToPath(import.meta.url) === path.resolve(process.argv[1]));

if (isMain) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    const repo = path.resolve(args.repo);
    const changedPaths = [
      ...args.changedPaths,
      ...(args.changedFrom ? changedPathsFromGit(repo, args.changedFrom) : []),
    ];
    const report = checkRepo(repo, { now: args.now, changedPaths });

    if (args.report) {
      const reportPath = path.resolve(args.report);
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    }

    process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : printHuman(report));
  } catch (err) {
    process.stderr.write(`[doc-health] ${err.message}\n\n${usage()}\n`);
    process.exit(2);
  }
}
