// git.test.mjs — integration tests for the git I/O layer (Tasks 1.4–1.5)
// Spec: docs/agent-process/doc-sweep.md §4.2 (enumeration D9), §4.4/§4.5 (commit safety)
// Tests build TEMPORARY git repos; they never touch the archon repo itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, appendFileSync, symlinkSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  enumerateCandidates,
  enumerateIgnored,
  statSig,
  commitFileGuarded,
  isPlaceholderDoc,
  acquireLock,
  releaseLock,
  LOCK_TTL_MS,
} from './git.mjs';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Create a fresh temp git repo, configure an identity (required for commits on Windows),
 * and optionally make an initial empty commit so HEAD exists.
 */
function makeTempRepo({ initialCommit = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'doc-sweep-test-'));
  const g = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  g('init', '-q');
  // Windows: git needs user identity before committing — spec note
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test Agent');
  if (initialCommit) {
    // Create a tracked file so HEAD is valid and future diffs work
    writeFileSync(join(dir, '.gitkeep'), '');
    g('add', '--', '.gitkeep');
    g('commit', '-q', '-m', 'chore: initial commit');
  }
  return dir;
}

/** Write a file creating parent directories, cross-platform. */
function writeInRepo(repo, rel, content = 'hello\n') {
  const parts = rel.split('/');
  if (parts.length > 1) {
    mkdirSync(join(repo, ...parts.slice(0, -1)), { recursive: true });
  }
  const abs = join(repo, ...parts);
  writeFileSync(abs, content);
  return abs;
}

/**
 * Install a pre-commit hook that rejects unless ALLOW_MAIN_COMMIT=1 is in the env —
 * a faithful miniature of archon's main-branch path guard. Used to prove that
 * commitFileGuarded catches hook rejection (leave+log) and honors the override env.
 */
function installRejectingHook(repo) {
  const hookDir = join(repo, '.githooks');
  mkdirSync(hookDir, { recursive: true });
  const hook = join(hookDir, 'pre-commit');
  writeFileSync(
    hook,
    '#!/usr/bin/env bash\n' +
    'if [ "${ALLOW_MAIN_COMMIT:-0}" != "1" ]; then\n' +
    '  echo "[test-hook] commit blocked" >&2\n' +
    '  exit 1\n' +
    'fi\n' +
    'exit 0\n',
  );
  try { execFileSync('chmod', ['+x', hook]); } catch { /* Windows git runs hooks by shebang */ }
  execFileSync('git', ['-C', repo, 'config', 'core.hooksPath', '.githooks'], { encoding: 'utf8' });
}

// ─── Task 1.4: enumerateCandidates (§4.2 D9) ─────────────────────────────────

test('enumerateCandidates: untracked file with space in name appears', () => {
  const repo = makeTempRepo();
  writeInRepo(repo, 'docs/my file.md');
  const cands = enumerateCandidates(repo);
  assert.ok(cands.includes('docs/my file.md'), `expected 'docs/my file.md' in ${JSON.stringify(cands)}`);
});

test('enumerateCandidates: staged-but-uncommitted ADD appears (C1)', () => {
  const repo = makeTempRepo();
  writeInRepo(repo, 'docs/staged.md');
  execFileSync('git', ['-C', repo, 'add', '--', 'docs/staged.md'], { encoding: 'utf8' });
  // staged but not committed — ls-files --others would miss it; diff --cached catches it
  const cands = enumerateCandidates(repo);
  assert.ok(cands.includes('docs/staged.md'), `expected staged 'docs/staged.md' in ${JSON.stringify(cands)}`);
});

test('enumerateCandidates: collapsed dir/ entry is excluded', () => {
  const repo = makeTempRepo();
  // Create a subdirectory with a file but do NOT .gitignore the parent →
  // git will report it as a collapsed "dir/" entry under --others
  mkdirSync(join(repo, 'untracked-dir'), { recursive: true });
  writeFileSync(join(repo, 'untracked-dir', 'x.md'), 'hello');
  const cands = enumerateCandidates(repo);
  // The collapsed entry "untracked-dir/" must NOT appear
  assert.ok(!cands.some((c) => c.endsWith('/')), `no slash-terminated entry expected; got ${JSON.stringify(cands)}`);
});

test('enumerateCandidates: symlink is excluded', () => {
  const repo = makeTempRepo();
  writeInRepo(repo, 'docs/target.md', 'real content\n');
  try {
    symlinkSync(join(repo, 'docs', 'target.md'), join(repo, 'docs', 'link.md'));
  } catch {
    // If symlinks not supported on this platform/config, skip gracefully
    return;
  }
  const cands = enumerateCandidates(repo);
  // The symlink must be filtered out; the target (untracked) may appear
  assert.ok(!cands.includes('docs/link.md'), `symlink 'docs/link.md' must be excluded; got ${JSON.stringify(cands)}`);
});

test('enumerateCandidates: deduplicates paths from both views', () => {
  const repo = makeTempRepo();
  writeInRepo(repo, 'docs/a.md');
  writeInRepo(repo, 'docs/b.md');
  const cands = enumerateCandidates(repo);
  const unique = new Set(cands);
  assert.equal(cands.length, unique.size, 'no duplicate paths');
});

// ─── Task 1.4: enumerateIgnored (§4.2 C2) ────────────────────────────────────

test('enumerateIgnored: gitignored doc appears in ignored set but NOT in candidates', () => {
  const repo = makeTempRepo();
  // Add a .gitignore that ignores .html-artifacts/
  writeFileSync(join(repo, '.gitignore'), '.html-artifacts/\n');
  execFileSync('git', ['-C', repo, 'add', '--', '.gitignore'], { encoding: 'utf8' });
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'chore: add gitignore'], { encoding: 'utf8' });

  mkdirSync(join(repo, '.html-artifacts'), { recursive: true });
  writeFileSync(join(repo, '.html-artifacts', 'report.html'), '<html/>');

  const cands = enumerateCandidates(repo);
  const ignored = enumerateIgnored(repo);

  assert.ok(!cands.includes('.html-artifacts/report.html'),
    `gitignored file must NOT be in candidates; candidates=${JSON.stringify(cands)}`);
  assert.ok(ignored.includes('.html-artifacts/report.html'),
    `gitignored file MUST appear in ignored; ignored=${JSON.stringify(ignored)}`);
});

test('enumerateIgnored: non-ignored doc does NOT appear in ignored set', () => {
  const repo = makeTempRepo();
  writeInRepo(repo, 'docs/normal.md');
  const ignored = enumerateIgnored(repo);
  assert.ok(!ignored.includes('docs/normal.md'),
    `non-ignored file must not appear in ignored; got ${JSON.stringify(ignored)}`);
});

// ─── Task 1.4: statSig ───────────────────────────────────────────────────────

test('statSig: returns mtimeMs and size for an existing file', () => {
  const repo = makeTempRepo();
  writeInRepo(repo, 'docs/test.md', 'hello world\n');
  const sig = statSig(repo, 'docs/test.md');
  assert.ok(typeof sig.mtimeMs === 'number', 'mtimeMs should be a number');
  assert.ok(typeof sig.size === 'number', 'size should be a number');
  assert.ok(sig.size > 0, 'size should be positive');
});

// ─── Task 1.5: commitFileGuarded (§4.4/§4.5) ─────────────────────────────────

test('commitFileGuarded: clean file with passing scan commits successfully', () => {
  const repo = makeTempRepo();
  writeInRepo(repo, 'docs/clean.md', 'safe content\n');
  const captured = statSig(repo, 'docs/clean.md');

  const scan = () => true; // stub: always clean
  const result = commitFileGuarded(repo, 'docs/clean.md', captured, 'docs(sweep): recover clean.md (#92)', scan);

  assert.equal(result.committed, true, `expected committed:true, got ${JSON.stringify(result)}`);

  // Verify git log shows the commit with the right message
  const log = execFileSync('git', ['-C', repo, 'log', '--oneline', '-2'], { encoding: 'utf8' });
  assert.ok(log.includes('recover clean.md'), `git log should mention recover clean.md; got: ${log}`);
});

test('commitFileGuarded: file mutated after capture → toctou, not committed', () => {
  const repo = makeTempRepo();
  writeInRepo(repo, 'docs/race.md', 'original\n');
  const captured = statSig(repo, 'docs/race.md');

  // Mutate after capture — different size triggers TOCTOU
  appendFileSync(join(repo, 'docs', 'race.md'), 'extra line\n');

  const scan = () => true;
  const result = commitFileGuarded(repo, 'docs/race.md', captured, 'docs(sweep): recover race.md (#92)', scan);

  assert.equal(result.committed, false, 'should not commit on TOCTOU');
  assert.equal(result.reason, 'toctou', `reason should be toctou; got ${result.reason}`);
});

test('commitFileGuarded: failing secret scan → secret-scan, not committed', () => {
  const repo = makeTempRepo();
  writeInRepo(repo, 'docs/secret.md', 'contains a secret\n');
  const captured = statSig(repo, 'docs/secret.md');

  const scan = () => false; // stub: always fails scan
  const result = commitFileGuarded(repo, 'docs/secret.md', captured, 'docs(sweep): recover secret.md (#92)', scan);

  assert.equal(result.committed, false, 'should not commit on scan failure');
  assert.equal(result.reason, 'secret-scan', `reason should be secret-scan; got ${result.reason}`);
});

test('commitFileGuarded: commit is path-scoped — does not sweep pre-staged sibling work', () => {
  // This test is specifically designed to catch the C1 clobber bug where
  // `git commit -m <msg>` (no pathspec) would commit everything in the index,
  // including another agent's pre-staged but unrelated work.
  const repo = makeTempRepo();

  // Write the doc we want the sweep to commit.
  writeInRepo(repo, 'docs/file1.md', 'one\n');

  // Write and PRE-STAGE an unrelated file (simulating another agent's staged work)
  // BEFORE calling commitFileGuarded — this is what the old bare-commit code would clobber.
  writeInRepo(repo, 'src/other.ts', 'export const x = 1;\n');
  execFileSync('git', ['-C', repo, 'add', '--', 'src/other.ts'], { encoding: 'utf8' });

  const captured = statSig(repo, 'docs/file1.md');
  const scan = () => true;
  commitFileGuarded(repo, 'docs/file1.md', captured, 'docs(sweep): recover file1.md (#92)', scan);

  // The sweep commit must contain ONLY docs/file1.md — not src/other.ts.
  const headFiles = execFileSync(
    'git', ['-C', repo, 'show', '--name-only', '--format=', 'HEAD'],
    { encoding: 'utf8' },
  ).trim();
  assert.ok(
    headFiles.includes('docs/file1.md'),
    `HEAD commit must include docs/file1.md; got: ${headFiles}`,
  );
  assert.ok(
    !headFiles.includes('src/other.ts'),
    `HEAD commit must NOT include src/other.ts (another agent's staged work); got: ${headFiles}`,
  );

  // src/other.ts must still be staged (index intact) — not swept into the sweep commit.
  const status = execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' });
  assert.ok(
    status.includes('A  src/other.ts') || status.includes('A src/other.ts'),
    `src/other.ts must still be staged after sweep commit; status=${status}`,
  );

  // docs/file1.md must be committed and gone from status.
  assert.ok(
    !status.includes('docs/file1.md'),
    `docs/file1.md should be committed, not in status; status=${status}`,
  );
});

// ─── Follow-up C1: hook rejection handling + override env (§4.5 L1/H1) ───────

test('commitFileGuarded: hook rejection → not committed, index clean, reason hook-rejected', () => {
  const repo = makeTempRepo();
  installRejectingHook(repo);
  writeInRepo(repo, 'docs/blocked.md', 'safe content\n');
  const captured = statSig(repo, 'docs/blocked.md');

  const result = commitFileGuarded(repo, 'docs/blocked.md', captured, 'docs(sweep): recover blocked.md (#92)', () => true);

  assert.equal(result.committed, false, 'a hook-rejected commit must not succeed');
  assert.equal(result.reason, 'hook-rejected', `reason should be hook-rejected; got ${result.reason}`);
  // Index must be clean again — the failed add is unstaged, file back to untracked.
  const status = execFileSync('git', ['-C', repo, 'status', '--porcelain', '--', 'docs/blocked.md'], { encoding: 'utf8' });
  assert.ok(status.trim().startsWith('??'),
    `file must be untracked again (unstaged) after rejection; status=${JSON.stringify(status)}`);
});

// ─── archon-setup#295: placeholder gate + staged-candidate preservation ──────

test('commitFileGuarded: a placeholder doc is left + logged, never swept (reason placeholder)', () => {
  const repo = makeTempRepo();
  writeInRepo(repo, 'docs/stub.md', '# TODO\n'); // lone scaffold token → placeholder
  const captured = statSig(repo, 'docs/stub.md');

  const result = commitFileGuarded(repo, 'docs/stub.md', captured, 'docs(sweep): recover stub.md (#92)', () => true);

  assert.equal(result.committed, false, 'a placeholder doc must not be committed');
  assert.equal(result.reason, 'placeholder', `reason should be placeholder; got ${result.reason}`);
  // No sweep commit was created; the file stays untracked for human review.
  const status = execFileSync('git', ['-C', repo, 'status', '--porcelain', '--', 'docs/stub.md'], { encoding: 'utf8' });
  assert.ok(status.trim().startsWith('??'), `placeholder must remain untracked; status=${JSON.stringify(status)}`);
});

test('commitFileGuarded: hook rejection PRESERVES a pre-staged add-only candidate', () => {
  const repo = makeTempRepo();
  installRejectingHook(repo);
  writeInRepo(repo, 'docs/saved.md', 'real durable content\n');
  // Author staged it ("git add = save my work") BEFORE the sweep ran.
  execFileSync('git', ['-C', repo, 'add', '--', 'docs/saved.md'], { encoding: 'utf8' });
  const captured = statSig(repo, 'docs/saved.md');

  const result = commitFileGuarded(repo, 'docs/saved.md', captured, 'docs(sweep): recover saved.md (#92)', () => true);

  assert.equal(result.committed, false, 'hook must reject the commit');
  assert.equal(result.reason, 'hook-rejected', `reason should be hook-rejected; got ${result.reason}`);
  // The pre-staged add must SURVIVE — not be unstaged — so the work is not lost.
  const status = execFileSync('git', ['-C', repo, 'status', '--porcelain', '--', 'docs/saved.md'], { encoding: 'utf8' });
  assert.ok(
    status.includes('A  docs/saved.md') || status.includes('A docs/saved.md'),
    `pre-staged candidate must remain staged after hook rejection; status=${JSON.stringify(status)}`,
  );
});

test('isPlaceholderDoc: classifies empty/whitespace/single-token stubs vs real prose', () => {
  const repo = makeTempRepo();
  const abs = (rel, content) => { writeInRepo(repo, rel, content); return join(repo, rel); };

  assert.equal(isPlaceholderDoc(abs('docs/empty.md', '')), true, 'empty is placeholder');
  assert.equal(isPlaceholderDoc(abs('docs/ws.md', '   \n\t\n')), true, 'whitespace-only is placeholder');
  assert.equal(isPlaceholderDoc(abs('docs/todo.md', '# TODO\n')), true, 'lone TODO heading is placeholder');
  assert.equal(isPlaceholderDoc(abs('docs/tbd.md', 'TBD')), true, 'lone TBD is placeholder');
  assert.equal(isPlaceholderDoc(abs('docs/real.md', 'Real durable content here.\n')), false, 'real prose is not placeholder');
  assert.equal(
    isPlaceholderDoc(abs('docs/todo-prose.md', 'TODO: wire up the parser and document the flags.\n')),
    false,
    'a doc that mentions TODO in real prose is preserved',
  );
  assert.equal(isPlaceholderDoc(join(repo, 'docs', 'does-not-exist.md')), true, 'unreadable fails closed');
});

test('commitFileGuarded: allowMainCommit override lets a hook-gated commit through', () => {
  const repo = makeTempRepo();
  installRejectingHook(repo);
  writeInRepo(repo, 'docs/allowed.md', 'safe content\n');
  const captured = statSig(repo, 'docs/allowed.md');

  const result = commitFileGuarded(
    repo, 'docs/allowed.md', captured, 'docs(sweep): recover allowed.md (#92)', () => true,
    { allowMainCommit: true },
  );

  assert.equal(result.committed, true, `override should pass the hook; got ${JSON.stringify(result)}`);
  const tracked = execFileSync('git', ['-C', repo, 'ls-files', '--', 'docs/allowed.md'], { encoding: 'utf8' });
  assert.ok(tracked.includes('docs/allowed.md'), 'file must be committed under the override');
});

// ─── Task 1.5: acquireLock / releaseLock (§4.5 H5) ──────────────────────────

test('acquireLock: first acquire succeeds', () => {
  const repo = makeTempRepo();
  const result = acquireLock(repo);
  assert.equal(result.acquired, true, `first acquire should succeed; got ${JSON.stringify(result)}`);
  assert.ok(result.handle != null, 'handle should be present on success');
  releaseLock(result.handle);
});

test('acquireLock: second acquire while held returns acquired:false (skip, not queue)', () => {
  const repo = makeTempRepo();
  const first = acquireLock(repo);
  assert.equal(first.acquired, true, 'first acquire must succeed');

  const second = acquireLock(repo);
  assert.equal(second.acquired, false, `second acquire while held must return false; got ${JSON.stringify(second)}`);
  assert.equal(second.handle, undefined, 'no handle when not acquired');

  releaseLock(first.handle);
});

test('acquireLock: third acquire after release succeeds', () => {
  const repo = makeTempRepo();
  const first = acquireLock(repo);
  releaseLock(first.handle);

  const third = acquireLock(repo);
  assert.equal(third.acquired, true, `acquire after release should succeed; got ${JSON.stringify(third)}`);
  releaseLock(third.handle);
});

// ─── Follow-up B: stale sweep-lock TTL + reclaim (§4.5 H5, no-expiry fix) ─────

test('acquireLock: writes a parseable timestamp payload', () => {
  const repo = makeTempRepo();
  const now = 1_700_000_000_000;
  const r = acquireLock(repo, { now });
  assert.equal(r.acquired, true);
  const raw = readFileSync(join(repo, '.agent', 'coordination', 'doc-sweep.lock'), 'utf8');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.ts, now, `lock payload must record the acquire timestamp; got ${raw}`);
  releaseLock(r.handle);
});

test('acquireLock: fresh held lock (< TTL) is NOT reclaimed — skip, do not steal', () => {
  const repo = makeTempRepo();
  const t0 = 1_700_000_000_000;
  const first = acquireLock(repo, { now: t0 });
  assert.equal(first.acquired, true);
  // Just under the TTL → a live holder → must not reclaim.
  const second = acquireLock(repo, { now: t0 + LOCK_TTL_MS - 1000 });
  assert.equal(second.acquired, false, 'a lock held under the TTL must not be reclaimed');
  releaseLock(first.handle);
});

test('acquireLock: stale lock (older than TTL) is reclaimed', () => {
  const repo = makeTempRepo();
  const t0 = 1_700_000_000_000;
  const first = acquireLock(repo, { now: t0 });
  assert.equal(first.acquired, true);
  // Past the TTL → the holder is presumed dead → reclaim.
  const second = acquireLock(repo, { now: t0 + LOCK_TTL_MS + 1000 });
  assert.equal(second.acquired, true, 'a lock older than the TTL must be reclaimed');
  assert.equal(second.handle?.reclaimed, true, 'a reclaimed lock is flagged on the handle');
  releaseLock(second.handle);
});

test('acquireLock: unparseable lock payload falls back to file mtime for staleness', () => {
  const repo = makeTempRepo();
  const dir = join(repo, '.agent', 'coordination');
  mkdirSync(dir, { recursive: true });
  const lockFile = join(dir, 'doc-sweep.lock');
  writeFileSync(lockFile, 'garbage not json\n'); // corrupt payload, freshly written
  // now ~ file mtime → within TTL by mtime → must NOT reclaim a corrupt-but-fresh lock.
  const fresh = acquireLock(repo, { now: Date.now() });
  assert.equal(fresh.acquired, false, 'corrupt-but-fresh lock (by mtime) must not be reclaimed');
  // Far-future now → mtime older than TTL → reclaim even though the payload is unreadable.
  const stale = acquireLock(repo, { now: Date.now() + LOCK_TTL_MS + 60_000 });
  assert.equal(stale.acquired, true, 'corrupt lock older than TTL (by mtime) must be reclaimed');
  releaseLock(stale.handle);
});
