import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ACTIVE_PLAN_STALE_MS,
  CHARTER_BUDGETS,
  HARD_CHARTER_DOCS,
  REVIEW_STALE_MS,
  TOOL_STUB_BUDGETS,
  docMapGlobToRegExp,
  earliestTokenLine,
  extractMarkdownLinks,
  extractPathRefTokens,
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
  topLevelDirs,
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
  // #124 L2: the doc-map contract rules — the only source of BLOCKING
  // findings. docMap/docMapError/renderCheck are injected (the CLI resolves
  // them via dynamic import) so the rules unit-test without the docs system.
  checkDocMapContract(root, mdFiles, textByRel, changedPaths, findings, {
    allRels: files.map((f) => f.rel),
    docMap: opts.docMap ?? null,
    docMapError: opts.docMapError ?? null,
    renderCheck: opts.renderCheck ?? null,
  });

  findings.sort((a, b) =>
    a.code.localeCompare(b.code) ||
    a.path.localeCompare(b.path) ||
    (a.line ?? 0) - (b.line ?? 0));

  const blocking = findings.filter((f) => f.severity === 'blocking').length;
  const issues = findings.map(issuePayloadForFinding);
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date(now).toISOString(),
    repo: root,
    status: blocking > 0 ? 'blocking' : findings.length ? 'warnings' : 'clean',
    summary: {
      findings: findings.length,
      warnings: findings.length - blocking,
      blocking,
    },
    findings,
    issues,
  };
}

// #124 L2: normalize the doc-map's possibly-scalar list fields (same lesson as
// scripts/close/lib.mjs — a scalar `owns: scripts/**` is valid YAML).
function toList(raw) {
  if (Array.isArray(raw)) return raw.filter((v) => typeof v === 'string' && v.trim());
  if (typeof raw === 'string' && raw.trim()) return [raw.trim()];
  return [];
}

// The blocking subset (#124 L2): required-existence, code-root coverage, and
// generated-block cleanliness are structural and always blocking; links and
// path-refs on `checked` docs are blocking only when the doc is RE-TRIGGERED
// by this change set (the doc itself changed, or a path its `owns` globs
// cover did) — pre-existing rot elsewhere stays a warning for the dashboard.
function checkDocMapContract(root, mdFiles, textByRel, changedPaths, findings, { allRels = [], docMap, docMapError, renderCheck }) {
  if (docMapError) {
    addFinding(findings, {
      severity: 'blocking',
      code: 'doc-map-invalid',
      path: '.agent/doc-map.yml',
      message: `.agent/doc-map.yml exists but could not be used: ${docMapError}`,
    });
    return;
  }
  if (!docMap) return;

  for (const rel of toList(docMap.required?.base)) {
    if (!fs.existsSync(path.join(root, ...rel.split('/')))) {
      addFinding(findings, {
        severity: 'blocking',
        code: 'required-doc-missing',
        path: rel,
        message: `required.base declares ${rel}, which does not exist.`,
      });
    }
  }

  const resolveDocRels = (entryPath) => {
    if (!/[*?{[]/.test(entryPath)) return textByRel.has(entryPath) ? [entryPath] : [];
    const re = docMapGlobToRegExp(entryPath);
    return mdFiles.map((f) => f.rel).filter((rel) => re.test(rel));
  };

  // EVERY checked entry must resolve to at least one markdown file (#146
  // round 11): a typo'd or deleted entry would otherwise silently disable its
  // links/path-refs guard — owns hits iterate zero docs and nothing blocks.
  // Forward-looking placeholders belong in `human`, not `checked`.
  const checked = (docMap.checked || []).filter((doc) => doc?.path);
  for (const doc of checked) {
    if (resolveDocRels(doc.path).length === 0) {
      addFinding(findings, {
        severity: 'blocking',
        code: 'checked-doc-missing',
        path: doc.path,
        message: `checked entry ${doc.path} resolves to no markdown file — its declared checks can never run.`,
      });
    }
  }

  const codeRoots = docMap.code_roots || {};
  const mappedRoots = new Set(Object.keys(codeRoots));
  // A code root is a top-level dir a CLEAN CHECKOUT contains — derived from
  // tracked files (#146 rounds 9+11): both name-ignored (target/) and
  // contents-ignored (tmp/*) local artifact dirs have no tracked files and
  // must not red-light a scan CI would pass. Non-git roots fall back to the
  // disk walk minus name-ignored dirs.
  const trackedRels = trackedFiles(root);
  const probeRels = trackedRels ?? allRels;
  const tracked = trackedRels ? topLevelDirsFromRels(trackedRels) : null;
  const ignoredDirs = tracked ? new Set() : gitIgnoredSet(root, topLevelDirs(root));
  const allDirs = tracked ?? topLevelDirs(root);
  for (const dir of allDirs) {
    if (ignoredDirs.has(dir)) continue;
    if (!mappedRoots.has(dir)) {
      addFinding(findings, {
        severity: 'blocking',
        code: 'code-root-unmapped',
        path: dir,
        message: `top-level root ${dir}/ is not owned by any checked doc nor marked unmapped_ok in .agent/doc-map.yml.`,
      });
    }
  }
  // A mapping VALUE must deliver the coverage it claims (#146 rounds 5–6):
  // 'unmapped_ok'/'self' are declarations; anything else must name a checked
  // doc whose owns globs match at least one ACTUAL file under the root —
  // validating against real files, not a synthetic probe, so extension-scoped
  // owns like scripts/**/*.mjs are honored. A typo'd or non-covering mapping
  // silently defeats the keystone-rot guard.
  for (const [rootDir, owner] of Object.entries(codeRoots)) {
    const value = String(owner || '').trim();
    if (value === 'unmapped_ok' || value === 'self') continue;
    const entry = (docMap.checked || []).find((doc) => doc?.path === value);
    if (!entry) {
      addFinding(findings, {
        severity: 'blocking',
        code: 'code-root-mapping-invalid',
        path: rootDir,
        message: `code_roots maps ${rootDir} to ${value}, which is not a checked doc (typo?).`,
      });
      continue;
    }
    if (resolveDocRels(entry.path).length === 0) {
      addFinding(findings, {
        severity: 'blocking',
        code: 'code-root-mapping-invalid',
        path: rootDir,
        message: `code_roots maps ${rootDir} to ${value}, but that checked doc resolves to no markdown file.`,
      });
      continue;
    }
    const rootFiles = probeRels.filter((rel) => rel.startsWith(`${rootDir}/`));
    if (rootFiles.length === 0) continue; // empty root: nothing to rot yet
    const owns = toList(entry.owns).map(docMapGlobToRegExp);
    const covers = owns.some((re) => rootFiles.some((rel) => re.test(rel)));
    if (!covers) {
      addFinding(findings, {
        severity: 'blocking',
        code: 'code-root-mapping-invalid',
        path: rootDir,
        message: `code_roots maps ${rootDir} to ${value}, but that checked doc's owns globs match no file under ${rootDir}/.`,
      });
    }
  }

  // Re-trigger sets at FILE granularity (#146 review): a doc-path hit
  // escalates only the changed file — one ADR changing must not turn
  // pre-existing rot in a sibling ADR blocking — while an owns hit escalates
  // every doc of the entry (the changed code may invalidate any of them).
  const changedSet = new Set(changedPaths);
  const escalatedLinkRels = new Set();
  const escalatedPathRefRels = new Set();
  for (const doc of checked) {
    const checks = toList(doc.checks);
    if (!checks.includes('links') && !checks.includes('path-refs')) continue;
    const ownsRes = toList(doc.owns).map(docMapGlobToRegExp);
    const ownsHit = changedPaths.some((p) => ownsRes.some((re) => re.test(p)));
    for (const rel of resolveDocRels(doc.path)) {
      if (!ownsHit && !changedSet.has(rel)) continue;
      if (checks.includes('links')) escalatedLinkRels.add(rel);
      if (checks.includes('path-refs')) escalatedPathRefRels.add(rel);
    }
  }

  // path-refs: backtick repo paths in declaring docs must exist — except
  // doc-map-declared volatile surfaces (rendered/release classes) and
  // gitignored runtime paths, which are legitimately absent at HEAD.
  const volatile = new Set(
    (docMap.generated || []).filter((g) => g.class === 'rendered' || g.class === 'release').map((g) => g.path)
  );
  // Only tokens anchored at a real top-level root of THIS repo count as repo
  // paths — cross-repo references (`repo-template/AGENTS.md`) and org slugs
  // in prose are not broken links (#146 review). Dot-roots (.agent/.github)
  // are real anchors too.
  const isRealRoot = (seg) => {
    try {
      return fs.statSync(path.join(root, seg)).isDirectory();
    } catch {
      return false;
    }
  };
  const pathRefDocs = checked.filter((doc) => toList(doc.checks).includes('path-refs'));
  const candidates = [];
  for (const doc of pathRefDocs) {
    for (const rel of resolveDocRels(doc.path)) {
      for (const { token, line } of extractPathRefTokens(textByRel.get(rel) || '')) {
        if (volatile.has(token)) continue;
        if (!isRealRoot(token.split('/')[0])) continue;
        if (fs.existsSync(path.join(root, ...token.split('/')))) continue;
        candidates.push({ rel, token, line });
      }
    }
  }
  const ignored = gitIgnoredSet(root, candidates.map((c) => c.token));
  for (const { rel, token, line } of candidates) {
    if (ignored.has(token)) continue;
    addFinding(findings, {
      severity: escalatedPathRefRels.has(rel) ? 'blocking' : 'warning',
      code: 'path-ref-missing',
      path: rel,
      line,
      message: `references \`${token}\`, which does not exist.`,
    });
  }

  // links: escalate the generic dangling-link warnings on re-triggered files.
  for (const finding of findings) {
    if (finding.code === 'dangling-relative-link' && escalatedLinkRels.has(finding.path)) {
      finding.severity = 'blocking';
    }
  }

  // generated-block-clean: committed-class surfaces must match regeneration.
  const committed = (docMap.generated || []).filter((g) => g.class === 'committed');
  if (committed.length > 0) {
    if (!renderCheck) {
      addFinding(findings, {
        severity: 'blocking',
        code: 'generated-block-check-failed',
        path: '.agent/doc-map.yml',
        message: 'doc-map declares committed generated surfaces but the docs generators are unavailable.',
      });
    } else {
      try {
        for (const result of renderCheck()) {
          if (result.changed) {
            addFinding(findings, {
              severity: 'blocking',
              code: 'generated-block-stale',
              path: '.agent/doc-map.yml',
              message: `${result.name} is stale — run \`npm run docs:render\`.`,
            });
          }
        }
      } catch (err) {
        addFinding(findings, {
          severity: 'blocking',
          code: 'generated-block-check-failed',
          path: '.agent/doc-map.yml',
          message: `generated-block check failed: ${String(err.message || err).split('\n')[0]}`,
        });
      }
    }
  }
}

// TRACKED file rels — what a clean checkout actually contains (#146 rounds
// 9+11+16): root discovery AND the coverage probe both read this so local
// gate-mode and CI agree. Returns null outside a git repo so callers fall
// back to the disk walk.
function trackedFiles(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

function topLevelDirsFromRels(rels) {
  const dirs = new Set();
  for (const rel of rels) {
    const slash = rel.indexOf('/');
    if (slash > 0 && !rel.startsWith('.')) dirs.add(rel.slice(0, slash));
  }
  return [...dirs].sort();
}

// Batched gitignore probe for the path-refs rule: a doc referencing a runtime
// or rendered path the repo deliberately gitignores (e.g. .agent/close-scan/
// dod.json) is not a broken reference. One `git check-ignore --stdin` call for
// all candidates; a non-git root degrades to "nothing ignored".
function gitIgnoredSet(root, tokens) {
  if (tokens.length === 0) return new Set();
  try {
    const out = execFileSync('git', ['-C', root, 'check-ignore', '--stdin'], {
      input: [...new Set(tokens)].join('\n'),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return new Set(out.split(/\r?\n/).map((t) => t.trim()).filter(Boolean));
  } catch (err) {
    // check-ignore exits 1 when NO path matches — same "nothing ignored"
    // answer; salvage stdout for partial matches on other statuses.
    const out = typeof err.stdout === 'string' ? err.stdout : '';
    return new Set(out.split(/\r?\n/).map((t) => t.trim()).filter(Boolean));
  }
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
        // Suite-asserted charters block the docs gate (rt#176); others warn.
        severity: HARD_CHARTER_DOCS.has(rel) ? 'blocking' : 'warning',
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
      'Doc-health reported a document-policy finding.',
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

// --no-renames: a rename must contribute BOTH sides (as D+A) or a file moved
// out of an owned glob never re-triggers its doc — same rule parseNameStatus
// enforces for close-scan scope (repo-template#84; #146 review round 4).
export function changedPathsFromGit(repo, ref) {
  const raw = execFileSync('git', ['-C', repo, 'diff', '--name-only', '--no-renames', `${ref}...HEAD`], {
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
    'Exit codes: 0 clean or warnings-only; 1 blocking findings (#124 L2 doc-map',
    'contract: required-existence, code-root coverage, generated-block-clean,',
    'plus links/path-refs on checked docs re-triggered by --changed/--changed-from);',
    '2 usage or runtime error.',
  ].join('\n');
}

// #124 L2 CLI wiring: the doc-map and the docs generators live in scripts/docs
// and may be absent in partially-distributed consumers — resolve both via
// dynamic import and degrade per the same fail-closed rules as
// scripts/close/scan-complete.mjs: a truly absent doc-map disables the
// contract rules; a present-but-unusable one becomes a blocking finding.
async function loadDocMapForCli(repoRoot) {
  if (!fs.existsSync(path.join(repoRoot, '.agent', 'doc-map.yml'))) {
    return { docMap: null, docMapError: null };
  }
  try {
    const { readDocMap } = await import('../docs/lib.mjs');
    const docMap = readDocMap(repoRoot);
    if (!docMap || docMap.version !== 1) {
      return { docMap: null, docMapError: 'parsed but is not a valid version-1 doc-map' };
    }
    return { docMap, docMapError: null };
  } catch (err) {
    return { docMap: null, docMapError: String(err.message || err).split('\n')[0] };
  }
}

// Only the generators the doc-map DECLARES may run (#146 round 6): a partial
// consumer committing only README's status block must not fail because
// runIndex cannot find INDEX markers it never promised. Declared committed
// blocks with no known checker are unverifiable and fail closed via the
// contract rule's catch.
// Each known block id is checked by a runner that manages a FIXED surface; a
// committed entry must declare that exact path or the checker would verify a
// different file than the map promises (#146 round 7 — a typo'd path with a
// recognized block must fail closed, not silently pass on the real surface).
const KNOWN_BLOCK_SURFACES = {
  'index-pages': 'docs/INDEX.md',
  nav: 'llms.txt',
  status: 'README.md',
};

async function loadRenderCheckForCli(repoRoot, docMap) {
  const committed = (docMap.generated || []).filter((g) => g.class === 'committed');
  if (committed.length === 0) return () => [];
  const runners = [];
  const blocks = new Set();
  for (const entry of committed) {
    // No block id → unverifiable committed surface; omitting block: must not
    // silently disable the gate (#146 round 8).
    if (!entry.block) {
      runners.push(() => {
        throw new Error(`committed generated entry ${entry.path || '(no path)'} declares no block id — unverifiable`);
      });
      continue;
    }
    const expected = KNOWN_BLOCK_SURFACES[entry.block];
    if (expected && entry.path !== expected) {
      runners.push(() => {
        throw new Error(`doc-map declares block ${entry.block} at ${entry.path}, but its checker manages ${expected}`);
      });
      continue;
    }
    blocks.add(entry.block);
  }
  try {
    if (blocks.has('index-pages')) {
      const { runIndex } = await import('../docs/index.mjs');
      runners.push(() => ({ name: 'docs/INDEX.md (index-pages)', ...runIndex({ root: repoRoot, check: true }) }));
      blocks.delete('index-pages');
    }
    const navSurfaces = ['nav', 'status'].filter((b) => blocks.has(b));
    if (navSurfaces.length > 0) {
      const { runNav } = await import('../docs/nav.mjs');
      runners.push(() => ({
        name: `nav surfaces (${navSurfaces.join('+')})`,
        ...runNav({ root: repoRoot, check: true, surfaces: navSurfaces }),
      }));
      for (const b of navSurfaces) blocks.delete(b);
    }
  } catch {
    return null; // generators unavailable → generated-block-check-failed
  }
  if (blocks.size > 0) {
    const unknown = [...blocks].join(', ');
    runners.push(() => {
      throw new Error(`no known checker for declared committed block(s): ${unknown}`);
    });
  }
  return () => runners.map((fn) => fn());
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
    const { docMap, docMapError } = await loadDocMapForCli(repo);
    const renderCheck = docMap ? await loadRenderCheckForCli(repo, docMap) : null;
    const report = checkRepo(repo, { now: args.now, changedPaths, docMap, docMapError, renderCheck });

    if (args.report) {
      const reportPath = path.resolve(args.report);
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    }

    process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : printHuman(report));
    if (report.summary.blocking > 0) process.exitCode = 1;
  } catch (err) {
    process.stderr.write(`[doc-health] ${err.message}\n\n${usage()}\n`);
    process.exit(2);
  }
}
