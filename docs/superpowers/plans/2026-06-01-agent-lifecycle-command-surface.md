# Agent Lifecycle Command Surface Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Each step uses `- [ ]` checkbox tracking.
>
> **Tracks:** ArchonVII/repo-template#27. Unblocks ArchonVII/archon-setup#64 (downstream distribution).

**Goal:** Add repo-owned `agent:status` / `agent:prune` / `agent:start-task` commands to the repo-template baseline so every generated repo exposes issue-first worktree lifecycle as local commands, not only as global skills.

**Architecture:** A thin command-shim + pure-library split. All git/`gh` I/O and side effects live in three small command scripts under `scripts/agent/`; all decision logic (slug derivation, branch parsing, checkout-safety, worktree classification, prune safety, status formatting, next-action inference, claim-presence detection) lives in `scripts/agent/lib.mjs` as **pure, dependency-free functions** that are exhaustively unit-tested with Node's built-in test runner. Commands degrade honestly (warn, don't crash) when `gh`, claims (#14), or close-scan (#28) are absent. This is repo-template's **first `package.json`** — zero runtime/dev dependencies, tests via `node --test`.

**Tech Stack:** Node 20+ ESM (`.mjs`), `node:test` + `node:assert/strict`, `node:child_process` (`execFileSync` for git/gh), no third-party packages. CI via the `node` stack of `ArchonVII/github-workflows/.github/workflows/repo-required-gate.yml@v1`.

---

## Design decisions (locked with the owner, 2026-06-01)

1. **Zero-dependency.** `package.json` carries only `agent:*` scripts + `"test": "node --test"`. No `dependencies`/`devDependencies`. A `package-lock.json` with no packages is committed so the CI `node` stack's `npm ci` succeeds. _(Source: owner decision — keep the template lean; every generated repo inherits this.)_
2. **Build fresh from #27's acceptance criteria.** Pigafetta's `scripts/agent-start-task.mjs` + `agent-claims.mjs` are a **behavioral reference only** — do not copy. Pigafetta-specific features (carry-paths, asset linking, `npm ci` in the new worktree, claim file writes) are **out of scope** for the baseline. _(Source: owner decision.)_
3. **Claims optional.** `.agent/claims` / `.agent/schema` (#14) are not in the baseline yet; commands detect their absence and report "claims not installed" rather than failing. _(Source: #27 AC — "honest when optional claim/close-scan capabilities are not installed.")_
4. **Worktree location = sibling dir** `../<repo>-<issue>-<slug>`. _(Source: `AGENTS.md:31` — the repo-template worktree contract.)_
5. **Branch name** `agent/<tool>/<issue>-<slug>`. _(Source: `AGENTS.md:15`.)_

## What already exists (do not rebuild)

- `.githooks/` worktree guard (`checkout-role.sh`) already blocks branch creation in the primary checkout and redirects to `git worktree add`. The new `start-task` **complements** this — it is the happy-path command the guard points at. _(`AGENTS.md:21-37`.)_
- `.agent/check-map.yml` already maps `scripts/**`, `**/*.mjs`, `test/**` → `language-ci`, and `package.json` → `language-ci` + `dependency-review`. **No check-map edit is needed for the scripts/tests**; only the gate **stack** changes (Task 8). _(`.agent/check-map.yml:12-57`.)_
- `.changelog/unreleased/` fragment-based changelog (Mode 2). Add a fragment, do not edit `CHANGELOG.md` directly. _(repo tree.)_

## Protected-path / process notes

- `package.json`, `scripts/**`, `.github/**`, `.githooks/**`, `AGENTS.md`, `.agent/**` are all **owner-lane-protected** → this is a **full PR in a worktree**, not an owner-maintenance commit. _(`AGENTS.md:52`.)_
- PR must satisfy the strict ready contract: a `## Verification` section, a `### Verification Notes` subsection, at least one `- [x]`, and `Closes #27`. _(github-workflows#39 strict PR-ready contract.)_
- Do the work in a worktree: `git worktree add -b agent/<tool>/27-agent-lifecycle-commands ../repo-template-27-agent-lifecycle-commands origin/main`. REQUIRED SUB-SKILL: @superpowers:using-git-worktrees.

---

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `package.json` | Create | First package.json: `agent:*` scripts, `test` script, `engines`, zero deps |
| `package-lock.json` | Create | Empty-deps lockfile so CI `npm ci` works |
| `.gitignore` | Modify | Ignore the runtime task-metadata file |
| `scripts/agent/lib.mjs` | Create | Pure, tested decision logic (no I/O) |
| `scripts/agent/start-task.mjs` | Create | `agent:start-task` command shim |
| `scripts/agent/status.mjs` | Create | `agent:status` command shim |
| `scripts/agent/prune.mjs` | Create | `agent:prune` command shim |
| `test/agent/lib.test.mjs` | Create | `node --test` unit tests for `lib.mjs` |
| `.github/workflows/repo-required-gate.yml` | Modify | `stack: minimal` → `stack: node` |
| `AGENTS.md` | Modify | Document the three commands + lifecycle |
| `.changelog/unreleased/27-agent-lifecycle-commands.md` | Create | Changelog fragment |

**Pure functions to live in `lib.mjs` (the TDD core):**
`sanitizeSlug`, `buildBranchName`, `parseIssueFromBranch`, `parseGitStatusPorcelain`, `assertCheckoutIsSafe`, `parseWorktreeList`, `classifyPruneCandidates`, `inferNextAction`, `formatStatusReport`, `detectClaimsInstalled`.

---

## Task 1: Scaffold `package.json` + lockfile (red→green via `npm test` existing/empty)

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `test/agent/.gitkeep` (so the test dir exists before tests are written)

**Step 1 — Write `package.json`** (zero deps; scripts wired to files built in later tasks):

```json
{
  "name": "repo-template",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "node --test",
    "agent:status": "node scripts/agent/status.mjs",
    "agent:prune": "node scripts/agent/prune.mjs",
    "agent:start-task": "node scripts/agent/start-task.mjs"
  }
}
```
> Source for `node --test` (no runner dep): Node ≥18 built-in test runner. `engines.node >=20` matches the github-workflows `node` stack default.

**Step 2 — Generate the empty-deps lockfile**

Run: `npm install --package-lock-only --ignore-scripts`
Expected: creates `package-lock.json` with no `node_modules`, `packages` contains only the root. No network access needed (zero deps).

**Step 3 — Verify `node --test` runs green with no tests yet**

Run: `node --test`
Expected: exits 0, "tests 0" (no test files yet) — confirms the runner is wired.

**Step 4 — Commit**

```bash
git add package.json package-lock.json test/agent/.gitkeep
git commit -m "build(agent-lifecycle): scaffold zero-dep package.json + node --test"
```
- [ ] Task 1 complete

---

## Task 2: `sanitizeSlug` + `buildBranchName` + `parseIssueFromBranch` (pure)

**Files:**
- Create: `scripts/agent/lib.mjs`
- Create: `test/agent/lib.test.mjs`

**Step 1 — Write failing tests**

```js
// test/agent/lib.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSlug, buildBranchName, parseIssueFromBranch } from '../../scripts/agent/lib.mjs';

test('sanitizeSlug lowercases, hyphenates, trims, caps at 6 words', () => {
  assert.equal(sanitizeSlug('Add OAuth Flow!'), 'add-oauth-flow');
  assert.equal(sanitizeSlug('  Spaces   and---dashes  '), 'spaces-and-dashes');
  assert.equal(sanitizeSlug('one two three four five six seven'), 'one-two-three-four-five-six');
});

test('sanitizeSlug returns null when nothing usable', () => {
  assert.equal(sanitizeSlug('!!!'), null);
  assert.equal(sanitizeSlug(''), null);
});

test('buildBranchName composes agent/<tool>/<issue>-<slug>', () => {
  assert.equal(buildBranchName('claude', '42', 'oauth-flow'), 'agent/claude/42-oauth-flow');
});

test('parseIssueFromBranch extracts the issue number or null', () => {
  assert.equal(parseIssueFromBranch('agent/codex/27-agent-lifecycle'), '27');
  assert.equal(parseIssueFromBranch('main'), null);
  assert.equal(parseIssueFromBranch('agent/claude/2026-06-01-quick-fix'), '2026'); // date form: first segment
});
```

**Step 2 — Run, verify failure**

Run: `node --test test/agent/lib.test.mjs`
Expected: FAIL — "Cannot find module '.../scripts/agent/lib.mjs'".

**Step 3 — Implement minimal `lib.mjs`**

```js
// scripts/agent/lib.mjs
// Pure helpers for the agent lifecycle commands. No I/O — every function here is
// unit-tested in test/agent/lib.test.mjs. Command shims (start-task/status/prune)
// inject git/gh output and consume these.

// Branch convention: agent/<tool>/<issue>-<slug>  (AGENTS.md:15)
export function sanitizeSlug(value) {
  const slug = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .filter(Boolean)
    .slice(0, 6) // cap length so branch/worktree names stay manageable
    .join('-');
  return slug || null;
}

export function buildBranchName(agent, issue, slug) {
  return `agent/${agent}/${issue}-${slug}`;
}

export function parseIssueFromBranch(branch) {
  const match = /^agent\/[^/]+\/(\d+)-/.exec(String(branch));
  return match ? match[1] : null;
}
```

**Step 4 — Run, verify pass**

Run: `node --test test/agent/lib.test.mjs`
Expected: PASS (4 tests).

**Step 5 — Commit**

```bash
git add scripts/agent/lib.mjs test/agent/lib.test.mjs
git commit -m "feat(agent-lifecycle): add slug/branch pure helpers"
```
- [ ] Task 2 complete

---

## Task 3: `parseGitStatusPorcelain` + `assertCheckoutIsSafe` (pure)

**Files:** Modify `scripts/agent/lib.mjs`, `test/agent/lib.test.mjs`

**Step 1 — Add failing tests**

```js
import { parseGitStatusPorcelain, assertCheckoutIsSafe } from '../../scripts/agent/lib.mjs';

test('parseGitStatusPorcelain splits NUL records into {status,path}', () => {
  const raw = ' M src/a.mjs\0?? new.txt\0';
  assert.deepEqual(parseGitStatusPorcelain(raw), [
    { status: ' M', path: 'src/a.mjs' },
    { status: '??', path: 'new.txt' },
  ]);
  assert.deepEqual(parseGitStatusPorcelain(''), []);
});

test('assertCheckoutIsSafe throws when dirty', () => {
  assert.throws(
    () => assertCheckoutIsSafe({ statusEntries: [{ status: ' M', path: 'a' }], currentBranch: 'main', defaultBranch: 'main' }),
    /dirty/i,
  );
});

test('assertCheckoutIsSafe throws when not on the default branch', () => {
  assert.throws(
    () => assertCheckoutIsSafe({ statusEntries: [], currentBranch: 'agent/x/1-y', defaultBranch: 'main' }),
    /default branch/i,
  );
});

test('assertCheckoutIsSafe passes when clean and on default branch', () => {
  assert.doesNotThrow(() => assertCheckoutIsSafe({ statusEntries: [], currentBranch: 'main', defaultBranch: 'main' }));
});
```

**Step 2 — Run, verify failure** (`node --test test/agent/lib.test.mjs` → import error / undefined).

**Step 3 — Implement**

```js
// Append to scripts/agent/lib.mjs
export function parseGitStatusPorcelain(raw) {
  if (!raw) return [];
  return raw
    .split('\0')
    .filter(Boolean)
    .map((record) => ({ status: record.slice(0, 2), path: record.slice(3) }));
}

export function assertCheckoutIsSafe({ statusEntries, currentBranch, defaultBranch }) {
  if (statusEntries.length > 0) {
    const sample = statusEntries.slice(0, 3).map((e) => e.path).join(', ');
    throw new Error(`Working tree is dirty. Commit or stash before starting a task. Dirty: ${sample}`);
  }
  if (currentBranch && currentBranch !== defaultBranch) {
    throw new Error(`start-task must run from the default branch (${defaultBranch}); current: ${currentBranch}`);
  }
}
```

**Step 4 — Run, verify pass.**
**Step 5 — Commit:** `git commit -m "feat(agent-lifecycle): add checkout-safety pure helpers"`
- [ ] Task 3 complete

---

## Task 4: `parseWorktreeList` + `classifyPruneCandidates` (pure — the safety core)

**Files:** Modify `scripts/agent/lib.mjs`, `test/agent/lib.test.mjs`

**Step 1 — Add failing tests** (this is the most safety-critical logic — test it hard):

```js
import { parseWorktreeList, classifyPruneCandidates } from '../../scripts/agent/lib.mjs';

const PORCELAIN = [
  'worktree /repo', 'HEAD aaa', 'branch refs/heads/main', '',
  'worktree /repo-1-feat', 'HEAD bbb', 'branch refs/heads/agent/codex/1-feat', '',
  'worktree /repo-2-wip', 'HEAD ccc', 'branch refs/heads/agent/codex/2-wip', '',
].join('\n');

test('parseWorktreeList yields {path,branch} per entry', () => {
  const list = parseWorktreeList(PORCELAIN);
  assert.equal(list.length, 3);
  assert.deepEqual(list[1], { path: '/repo-1-feat', branch: 'agent/codex/1-feat' });
});

test('classifyPruneCandidates removes only merged+clean non-current agent worktrees', () => {
  const result = classifyPruneCandidates({
    worktrees: parseWorktreeList(PORCELAIN),
    primaryPath: '/repo',
    currentPath: '/repo',
    defaultBranch: 'main',
    mergedBranches: new Set(['agent/codex/1-feat']),   // #1 merged
    dirtyPaths: new Set(['/repo-2-wip']),               // #2 has uncommitted work
  });
  assert.deepEqual(result.remove.map((w) => w.path), ['/repo-1-feat']);
  assert.deepEqual(result.skipDirty.map((w) => w.path), ['/repo-2-wip']);
  // primary/current and the default branch are never candidates
  assert.ok(!result.remove.some((w) => w.path === '/repo'));
});

test('classifyPruneCandidates NEVER removes a dirty worktree even if merged', () => {
  const result = classifyPruneCandidates({
    worktrees: parseWorktreeList(PORCELAIN),
    primaryPath: '/repo', currentPath: '/repo', defaultBranch: 'main',
    mergedBranches: new Set(['agent/codex/1-feat', 'agent/codex/2-wip']),
    dirtyPaths: new Set(['/repo-2-wip']),
  });
  assert.ok(result.remove.every((w) => w.path !== '/repo-2-wip'));
  assert.ok(result.skipDirty.some((w) => w.path === '/repo-2-wip'));
});

test('classifyPruneCandidates keeps unmerged clean worktrees (work in progress)', () => {
  const result = classifyPruneCandidates({
    worktrees: parseWorktreeList(PORCELAIN),
    primaryPath: '/repo', currentPath: '/repo', defaultBranch: 'main',
    mergedBranches: new Set(),                 // nothing merged
    dirtyPaths: new Set(),
  });
  assert.equal(result.remove.length, 0);
  assert.equal(result.keep.length, 2);
});
```

**Step 2 — Run, verify failure.**

**Step 3 — Implement**

```js
// Append to scripts/agent/lib.mjs
export function parseWorktreeList(porcelain) {
  const list = [];
  let current = null;
  for (const line of String(porcelain).split('\n')) {
    if (line.startsWith('worktree ')) current = { path: line.slice('worktree '.length).trim(), branch: null };
    else if (line.startsWith('branch ')) {
      if (current) current.branch = line.slice('branch refs/heads/'.length).trim();
    } else if (line === '' && current) { list.push(current); current = null; }
  }
  if (current) list.push(current);
  return list;
}

// Prune safety contract (#27 AC): remove ONLY worktrees that are
//   (a) not the primary checkout, (b) not the current checkout,
//   (c) not the default branch, (d) on an agent/* branch already merged
//       into the default branch, AND (e) clean (no uncommitted changes).
// Anything dirty is skipped and reported. Anything unmerged is kept.
export function classifyPruneCandidates({ worktrees, primaryPath, currentPath, defaultBranch, mergedBranches, dirtyPaths }) {
  const remove = [], skipDirty = [], keep = [];
  for (const wt of worktrees) {
    const isProtected = wt.path === primaryPath || wt.path === currentPath || wt.branch === defaultBranch || !wt.branch?.startsWith('agent/');
    if (isProtected) { keep.push(wt); continue; }
    if (dirtyPaths.has(wt.path)) { skipDirty.push(wt); continue; }
    if (mergedBranches.has(wt.branch)) { remove.push(wt); continue; }
    keep.push(wt);
  }
  return { remove, skipDirty, keep };
}
```

**Step 4 — Run, verify pass (all 4).**
**Step 5 — Commit:** `git commit -m "feat(agent-lifecycle): add worktree parse + prune-safety classifier"`
- [ ] Task 4 complete

---

## Task 5: `inferNextAction` + `formatStatusReport` + `detectClaimsInstalled` (pure)

**Files:** Modify `scripts/agent/lib.mjs`, `test/agent/lib.test.mjs`

**Step 1 — Add failing tests**

```js
import { inferNextAction, formatStatusReport, detectClaimsInstalled } from '../../scripts/agent/lib.mjs';

test('inferNextAction prioritises dirty > open-PR > push > start-task', () => {
  assert.match(inferNextAction({ onDefaultBranch: true }), /start-task/);
  assert.match(inferNextAction({ onDefaultBranch: false, dirty: true }), /commit/i);
  assert.match(inferNextAction({ onDefaultBranch: false, dirty: false, hasPr: false, ahead: 2 }), /open.*pr|push/i);
  assert.match(inferNextAction({ onDefaultBranch: false, dirty: false, hasPr: true, ahead: 0 }), /review|merge|ready/i);
});

test('formatStatusReport renders every required field (#27 AC)', () => {
  const out = formatStatusReport({
    branch: 'agent/codex/27-x', defaultBranch: 'main', upstream: 'origin/agent/codex/27-x',
    pr: { number: 5, url: 'http://x/5', state: 'OPEN' }, issue: '27', dirty: true, dirtyCount: 3,
    worktreePath: '/repo-27-x', claimsInstalled: false, nextAction: 'commit your changes',
  });
  for (const needle of ['Branch:', 'Default branch:', 'Upstream:', 'PR:', 'Issue:', 'Dirty:', 'Worktree:', 'Claims:', 'Next:']) {
    assert.match(out, new RegExp(needle));
  }
  assert.match(out, /#27/);
  assert.match(out, /not installed/i); // claims honest-degradation
});

test('detectClaimsInstalled is true only when the claims file exists', () => {
  assert.equal(detectClaimsInstalled({ claimsFileExists: true }), true);
  assert.equal(detectClaimsInstalled({ claimsFileExists: false }), false);
});
```

**Step 2 — Run, verify failure.**

**Step 3 — Implement**

```js
// Append to scripts/agent/lib.mjs
export function inferNextAction({ onDefaultBranch, dirty, hasPr, ahead = 0 }) {
  if (onDefaultBranch) return 'run `npm run agent:start-task -- <issue>` to begin a task';
  if (dirty) return 'commit your changes';
  if (!hasPr && ahead > 0) return 'push and open a PR (jma-git-pr-lifecycle)';
  if (hasPr) return 'address review / mark PR ready';
  return 'no action — branch is in sync';
}

export function detectClaimsInstalled({ claimsFileExists }) {
  return Boolean(claimsFileExists);
}

export function formatStatusReport(s) {
  const prText = s.pr ? `#${s.pr.number} ${s.pr.state} ${s.pr.url}` : 'none';
  return [
    `Branch:         ${s.branch}`,
    `Default branch: ${s.defaultBranch}`,
    `Upstream:       ${s.upstream ?? 'none'}`,
    `PR:             ${prText}`,
    `Issue:          ${s.issue ? `#${s.issue}` : 'none'}`,
    `Dirty:          ${s.dirty ? `yes (${s.dirtyCount} path${s.dirtyCount === 1 ? '' : 's'})` : 'clean'}`,
    `Worktree:       ${s.worktreePath}`,
    `Claims:         ${s.claimsInstalled ? 'installed' : 'not installed'}`,
    `Next:           ${s.nextAction}`,
  ].join('\n');
}
```

**Step 4 — Run, verify pass.** Then run the **whole** suite: `node --test` → all lib tests green.
**Step 5 — Commit:** `git commit -m "feat(agent-lifecycle): add status formatting + next-action helpers"`
- [ ] Task 5 complete

---

## Task 6: `agent:start-task` command shim

**Files:** Create `scripts/agent/start-task.mjs`; Modify `.gitignore`

**Step 1 — Add a runtime-metadata gitignore rule** (the task record is local state, not committed):

Append to `.gitignore`:
```
# agent lifecycle runtime metadata (written by agent:start-task)
.agent/current-task.json
```

**Step 2 — Implement the shim** (uses the tested lib; all I/O lives here):

```js
// scripts/agent/start-task.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  sanitizeSlug, buildBranchName, parseGitStatusPorcelain, assertCheckoutIsSafe,
} from './lib.mjs';

const DEFAULT_AGENT = 'codex';
const [, , issueArg, ...rest] = process.argv;
const args = parseArgs(rest);

if (!issueArg || !/^\d+$/.test(issueArg)) {
  fail('Usage: npm run agent:start-task -- <issue-number> [--agent <name>] [--slug <slug>]');
}

const checkoutRoot = git(['rev-parse', '--show-toplevel']);
const repoName = path.basename(checkoutRoot);
const agent = args.agent || DEFAULT_AGENT;

const issue = JSON.parse(gh(['issue', 'view', issueArg, '--json', 'number,title,url,state']));
if (issue.state !== 'OPEN') fail(`Issue #${issueArg} is not open (state: ${issue.state}).`);

const defaultBranch = gh(['repo', 'view', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name']);

try {
  assertCheckoutIsSafe({
    statusEntries: parseGitStatusPorcelain(git(['status', '--porcelain=1', '-z'], { trim: false })),
    currentBranch: git(['branch', '--show-current']),
    defaultBranch,
  });
} catch (error) { fail(error.message); }

git(['fetch', 'origin', defaultBranch]);

const slug = sanitizeSlug(args.slug || issue.title) || fail('Could not derive a slug; pass --slug <value>.');
const branchName = buildBranchName(agent, issueArg, slug);
const worktreePath = path.join(path.dirname(checkoutRoot), `${repoName}-${issueArg}-${slug}`);

if (findExistingIssueBranches(issueArg).length) fail(`Issue #${issueArg} already has a branch.`);
if (branchExists(branchName)) fail(`Branch already exists: ${branchName}`);
if (fs.existsSync(worktreePath)) fail(`Worktree path already exists: ${worktreePath}`);

git(['worktree', 'add', '-b', branchName, worktreePath, `origin/${defaultBranch}`]);

// Initial task metadata (#27 AC). Runtime file, gitignored. Date.now() is fine in a
// CLI script (not a workflow script). Written into the NEW worktree.
const metadata = {
  issue: issue.number, title: issue.title, url: issue.url,
  branch: branchName, agent, defaultBranch, createdAt: new Date().toISOString(),
};
fs.mkdirSync(path.join(worktreePath, '.agent'), { recursive: true });
fs.writeFileSync(path.join(worktreePath, '.agent', 'current-task.json'), JSON.stringify(metadata, null, 2) + '\n');

console.log(`Ready to implement #${issue.number}: ${issue.title}`);
console.log(`Branch:   ${branchName}`);
console.log(`Worktree: ${worktreePath}`);
console.log('\nNext steps:');
console.log(`  1. cd "${worktreePath}"`);
console.log('  2. npm run agent:status');
console.log('  3. implement, validate, then open a draft PR (jma-git-pr-lifecycle)');

// ---- I/O helpers ----
function git(a, o = {}) { const out = execFileSync('git', a, { cwd: checkoutRootSafe(), encoding: 'utf8' }); return o.trim === false ? out : out.trim(); }
function checkoutRootSafe() { try { return checkoutRoot; } catch { return process.cwd(); } }
function gh(a) {
  try { return execFileSync('gh', a, { cwd: checkoutRoot, encoding: 'utf8' }).trim(); }
  catch { return fail('`gh` is required for start-task (issue lookup + default branch). Install/authenticate gh, or create the worktree manually per AGENTS.md.'); }
}
function branchExists(b) { try { git(['show-ref', '--verify', '--quiet', `refs/heads/${b}`]); return true; } catch { return false; } }
function findExistingIssueBranches(issueNumber) {
  return git(['for-each-ref', '--format=%(refname:short)', 'refs/heads/agent'])
    .split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .filter((l) => new RegExp(`^agent/[^/]+/${issueNumber}-`).test(l));
}
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) if (argv[i].startsWith('--')) { out[argv[i].slice(2)] = argv[i + 1]; i += 1; }
  return out;
}
function fail(m) { console.error(m); process.exit(1); }
```
> Note: `start-task` is I/O-heavy and not unit-tested at the shim level (its decision logic is already tested in `lib.mjs`). Task 9 adds a manual smoke run.

**Step 3 — Smoke-test the happy path against a real open issue** (run from the primary checkout on `main`, clean):

Run: `npm run agent:start-task -- 27 --agent claude --slug smoke-test`
Expected: creates branch `agent/claude/27-smoke-test` + sibling worktree `../repo-template-27-smoke-test` with `.agent/current-task.json`. **Then undo the smoke artifact:** `git worktree remove ../repo-template-27-smoke-test && git branch -D agent/claude/27-smoke-test`.
> If #27 is closed by the time you run this, use any open issue number and adjust the cleanup.

**Step 4 — Commit:** `git add scripts/agent/start-task.mjs .gitignore && git commit -m "feat(agent-lifecycle): add agent:start-task command"`
- [ ] Task 6 complete

---

## Task 7: `agent:status` + `agent:prune` command shims

**Files:** Create `scripts/agent/status.mjs`, `scripts/agent/prune.mjs`

**Step 1 — Implement `status.mjs`**

```js
// scripts/agent/status.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseIssueFromBranch, parseGitStatusPorcelain, detectClaimsInstalled, inferNextAction, formatStatusReport } from './lib.mjs';

const checkoutRoot = git(['rev-parse', '--show-toplevel']);
const commonDir = git(['rev-parse', '--path-format=absolute', '--git-common-dir']);
const commonRoot = commonDir.replace(/\/?\.git.*$/, '');

const branch = git(['branch', '--show-current']) || '(detached)';
const defaultBranch = ghOrNull(['repo', 'view', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name']) || 'main';
const upstream = gitOrNull(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
const statusEntries = parseGitStatusPorcelain(git(['status', '--porcelain=1', '-z'], { trim: false }));
const ahead = upstream ? Number(gitOrNull(['rev-list', '--count', `${upstream}..HEAD`]) || 0) : 0;
const prRaw = ghOrNull(['pr', 'view', '--json', 'number,url,state']);
const pr = prRaw ? JSON.parse(prRaw) : null;
const claimsInstalled = detectClaimsInstalled({ claimsFileExists: fs.existsSync(path.join(commonRoot, '.agent', 'claims.json')) });

console.log(formatStatusReport({
  branch, defaultBranch, upstream, pr, issue: parseIssueFromBranch(branch),
  dirty: statusEntries.length > 0, dirtyCount: statusEntries.length,
  worktreePath: checkoutRoot, claimsInstalled,
  nextAction: inferNextAction({ onDefaultBranch: branch === defaultBranch, dirty: statusEntries.length > 0, hasPr: Boolean(pr), ahead }),
}));
if (!ghAvailable()) console.log('\n(note: `gh` unavailable — PR/default-branch info degraded)');

function git(a, o = {}) { const out = execFileSync('git', a, { cwd: process.cwd(), encoding: 'utf8' }); return o.trim === false ? out : out.trim(); }
function gitOrNull(a) { try { return git(a); } catch { return null; } }
function ghOrNull(a) { try { return execFileSync('gh', a, { cwd: process.cwd(), encoding: 'utf8' }).trim(); } catch { return null; } }
function ghAvailable() { try { execFileSync('gh', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } }
```

**Step 2 — Implement `prune.mjs`**

```js
// scripts/agent/prune.mjs
import { execFileSync } from 'node:child_process';
import { parseWorktreeList, classifyPruneCandidates } from './lib.mjs';

const primaryPath = git(['rev-parse', '--path-format=absolute', '--git-common-dir']).replace(/\/?\.git.*$/, '');
const currentPath = git(['rev-parse', '--show-toplevel']);
const defaultBranch = ghOrNull(['repo', 'view', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name']) || 'main';

git(['worktree', 'prune']); // safe: only drops admin records for already-deleted dirs

const worktrees = parseWorktreeList(git(['worktree', 'list', '--porcelain']));
const mergedBranches = new Set(
  git(['branch', '--merged', defaultBranch, '--format=%(refname:short)']).split(/\r?\n/).map((b) => b.trim()).filter(Boolean),
);
const dirtyPaths = new Set(worktrees.filter((wt) => isDirty(wt.path)).map((wt) => wt.path));

const { remove, skipDirty, keep } = classifyPruneCandidates({
  worktrees, primaryPath, currentPath, defaultBranch, mergedBranches, dirtyPaths,
});

for (const wt of remove) {
  git(['worktree', 'remove', wt.path]); // never --force: refuses if somehow dirty
  try { git(['branch', '-d', wt.branch]); } catch { /* unmerged elsewhere; leave it */ }
  console.log(`removed: ${wt.path} [${wt.branch}]`);
}
for (const wt of skipDirty) console.log(`skipped (dirty, kept): ${wt.path} [${wt.branch}]`);
console.log(`\nremoved ${remove.length}, skipped-dirty ${skipDirty.length}, kept ${keep.length}`);

function git(a) { return execFileSync('git', a, { cwd: process.cwd(), encoding: 'utf8' }).trim(); }
function ghOrNull(a) { try { return execFileSync('gh', a, { cwd: process.cwd(), encoding: 'utf8' }).trim(); } catch { return null; } }
function isDirty(worktreePath) {
  try { return execFileSync('git', ['status', '--porcelain'], { cwd: worktreePath, encoding: 'utf8' }).trim().length > 0; }
  catch { return true; } // if we can't tell, treat as dirty and skip — never delete on uncertainty
}
```
> Safety: `git worktree remove` (no `--force`) **refuses** to delete a worktree with modified/untracked files, so dirty work is doubly protected (classifier + git itself). `isDirty` defaults to `true` on error.

**Step 3 — Smoke-test both (idempotency)**

Run: `npm run agent:status` (from `main`) → prints all fields, "Next: ...start-task".
Run: `npm run agent:prune` then `npm run agent:prune` again → second run reports `removed 0` (idempotent).
Expected: no errors; no dirty worktree ever removed.

**Step 4 — Commit:** `git add scripts/agent/status.mjs scripts/agent/prune.mjs && git commit -m "feat(agent-lifecycle): add agent:status + agent:prune commands"`
- [ ] Task 7 complete

---

## Task 8: Wire CI for the new Node code

**Files:** Modify `.github/workflows/repo-required-gate.yml`

**Step 1 — Switch the gate stack** `minimal` → `node`:

```yaml
  repo-required-gate:
    uses: ArchonVII/github-workflows/.github/workflows/repo-required-gate.yml@v1
    with:
      stack: node
```
> Source: jma-ui#25 (`ci: switch repo-required-gate stack from minimal to node`) is the proven precedent for turning on `language-ci` (`node --test`) in an ArchonVII repo. github-workflows#33 (`auto-detect node cache manager`) makes the node stack tolerate a zero-dep / lockfile-only repo.

**Step 2 — Verify check-map already routes the new paths** (read-only; no edit expected): `scripts/**`, `**/*.mjs`, `test/**`, `package.json` all map to `language-ci` in `.agent/check-map.yml:12-57`. Confirm — if a gap exists, add the pattern in the same PR.

**Step 3 — Local CI parity check**

Run: `npm ci` (must succeed with the committed empty-deps lockfile), then `npm test`.
Expected: `npm ci` installs 0 packages cleanly; `npm test` runs all `test/agent/*.test.mjs` green.

**Step 4 — Commit:** `git add .github/workflows/repo-required-gate.yml && git commit -m "ci(agent-lifecycle): switch required gate to node stack"`
- [ ] Task 8 complete

---

## Task 9: Docs + changelog + final verification

**Files:** Modify `AGENTS.md`; Create `.changelog/unreleased/27-agent-lifecycle-commands.md`

**Step 1 — Document the commands in `AGENTS.md`** (in/near the "Checkout role / worktrees" section, ~line 37). Add a concise block:

```markdown
### Agent lifecycle commands

Repo-owned helpers (zero-dep, `node`):

- `npm run agent:start-task -- <issue> [--agent <name>] [--slug <slug>]` — fetch the
  default branch, create `agent/<tool>/<issue>-<slug>` in a sibling worktree, and write
  `.agent/current-task.json` (gitignored). Refuses if the checkout is dirty or off the
  default branch, or if the issue already has a branch.
- `npm run agent:status` — branch, default branch, upstream, PR, issue, dirty state,
  worktree path, claims (if installed), and the next recommended action.
- `npm run agent:prune` — remove only merged + clean agent worktrees/branches; never
  touches dirty work or the primary/current checkout. Idempotent.

Optional capabilities (claims #14, close-scan #28) are reported as "not installed" when absent.
```

**Step 2 — Add the changelog fragment** `.changelog/unreleased/27-agent-lifecycle-commands.md`:

```markdown
### Added
- Agent lifecycle commands (`agent:start-task`, `agent:status`, `agent:prune`) as a zero-dependency baseline, with `node --test` coverage and the required gate on the `node` stack. (#27)
```
> Match the exact fragment format of existing files in `.changelog/unreleased/`; adjust the heading (`Added`/`Changed`) if the repo convention differs.

**Step 3 — Full verification (evidence for the PR body)**

Run: `npm ci && npm test`
Expected: 0 packages installed; **all `lib.mjs` tests pass, 0 fail**. Capture the count for `### Verification Notes`.
Run (lint the workflow if actionlint is available locally): `actionlint .github/workflows/repo-required-gate.yml` → no errors.

**Step 4 — Commit:** `git add AGENTS.md .changelog/unreleased/27-agent-lifecycle-commands.md && git commit -m "docs(agent-lifecycle): document commands + changelog fragment"`
- [ ] Task 9 complete

---

## Task 10: Open the PR

**Step 1** — Push the branch and open a PR with the strict-ready body. REQUIRED SUB-SKILL: @jma-git-pr-lifecycle (or @superpowers:requesting-code-review).

PR body must include:
- A short summary of the three commands + zero-dep posture.
- `Closes #27`.
- `## Verification` + `### Verification Notes` with the `npm ci && npm test` result and the start-task/status/prune smoke evidence.
- At least one `- [x]` checked item.

**Step 2** — Confirm `repo-required-gate / decision` runs and passes on the `node` stack (language-ci now executes `node --test`). If `dependency-review` flags the new lockfile, confirm it's a zero-dep no-op.

**Step 3** — Mark ready for review only when green.
- [ ] Task 10 complete

---

## Risks & open items

1. **Zero-dep + `node` stack `npm ci`.** If the reusable `node` workflow's install step still hard-requires real dependencies, fall back to either (a) keep the committed empty-deps `package-lock.json` (preferred — `npm ci` accepts a lockfile with no packages), or (b) raise a github-workflows issue to make the install step a no-op when `package.json` has no deps. Validate in Task 8/10. _(Related: the "depless Node repos need no-op CI install" gotcha.)_
2. **Worktree location divergence.** This plan uses AGENTS.md's sibling-dir convention (`../<repo>-<issue>-<slug>`); Pigafetta uses `.claude/worktrees/`. If the ecosystem later standardises on `.claude/worktrees/`, only `start-task.mjs`'s `worktreePath` line and the AGENTS.md doc change.
3. **`current-task.json` location.** Placed under `.agent/` (policy-protected dir) but gitignored as a runtime file. If a future claims schema (#14) wants to own task metadata, reconcile then.
4. **Downstream #64.** Once this merges, archon-setup#64 snapshots `package.json` + `scripts/agent/**` into `src/snapshots/repo-template/`, records the new provider SHA in `manifest.json`, and adds the audit/install wiring. This plan deliberately keeps the surface small so the snapshot is clean.

## Execution handoff

Plan saved to `C:\GitHub\repo-template\docs\superpowers\plans\2026-06-01-agent-lifecycle-command-surface.md`.
