// sweep.test.mjs — orchestrator tests for sweepRepo (Task 1.6)
// Spec: docs/agent-process/doc-sweep.md §4.2–§4.5, §7 acceptance fixture
// Uses TEMP git repos; never touches the archon repo.
// Stubs: scan, loadClaims, now — so tests never depend on gitleaks or real claims.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { sweepRepo, buildSweepMessage } from './sweep.mjs';
import { basename } from 'node:path';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a fresh temp git repo with an initial commit on 'main'. */
function makeTempRepo({ branch = 'main' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sweep-test-'));
  const g = (...args) =>
    execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  g('init', '-q', '-b', branch);
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test Agent');
  writeFileSync(join(dir, '.gitkeep'), '');
  g('add', '--', '.gitkeep');
  g('commit', '-q', '-m', 'chore: initial commit (#0)');
  return dir;
}

/** Write a file under repo, creating intermediate dirs. */
function writeInRepo(repo, rel, content = 'hello\n') {
  const parts = rel.split('/');
  if (parts.length > 1)
    mkdirSync(join(repo, ...parts.slice(0, -1)), { recursive: true });
  writeFileSync(join(repo, ...parts), content);
  return join(repo, ...parts);
}

// Common stubs
const cleanScan = () => true;   // always passes secret scan
const failScan  = () => false;  // always fails secret scan
const noClaims  = () => [];     // no coordination claims
// 12h + a little in ms — source: spec §4.3 STALE_MS = 12 * 60 * 60 * 1000
const STALE_MS = 12 * 60 * 60 * 1000;

// ─── §7 Fixture: primary-default lane ─────────────────────────────────────────

test('sweepRepo: stale doc on primary-default → eligible', async () => {
  const repo = makeTempRepo();
  writeInRepo(repo, 'docs/ROADMAP.md', '# Roadmap\nsome content\n');

  // Pin now to 13h after file's mtime so it's stale
  const { mtimeMs } = (await import('node:fs')).statSync(join(repo, 'docs/ROADMAP.md'));
  const now = mtimeMs + STALE_MS + (60 * 60 * 1000); // 13h after mtime

  const buckets = await sweepRepo(repo, {
    now,
    apply: false,
    defaultBranch: 'main',
    scan: cleanScan,
    loadClaims: noClaims,
  });

  const paths = buckets.eligible.map((e) => e.path);
  assert.ok(paths.some((p) => p === 'docs/ROADMAP.md'),
    `docs/ROADMAP.md should be eligible; eligible=${JSON.stringify(paths)}`);
});

test('sweepRepo: fresh (<12h) doc on primary-default → leaveLog', async () => {
  const repo = makeTempRepo();
  writeInRepo(repo, 'docs/fresh.md', '# Fresh\nsome content\n');

  // now = just created; file is fresh
  const now = Date.now();

  const buckets = await sweepRepo(repo, {
    now,
    apply: false,
    defaultBranch: 'main',
    scan: cleanScan,
    loadClaims: noClaims,
  });

  const paths = buckets.leaveLog.map((e) => e.path);
  assert.ok(paths.some((p) => p === 'docs/fresh.md'),
    `docs/fresh.md should be leaveLog (fresh); leaveLog=${JSON.stringify(paths)}`);
  assert.ok(!buckets.eligible.some((e) => e.path === 'docs/fresh.md'),
    'fresh doc must NOT be eligible');
});

test('sweepRepo: hard-excluded path (.claude/x.md) is not bucketed', async () => {
  const repo = makeTempRepo();
  writeInRepo(repo, '.claude/x.md', 'agent config\n');

  const now = Date.now() + STALE_MS + 1000; // ensure stale

  const buckets = await sweepRepo(repo, {
    now,
    apply: false,
    defaultBranch: 'main',
    scan: cleanScan,
    loadClaims: noClaims,
  });

  const allPaths = [
    ...buckets.eligible,
    ...buckets.leaveLog,
    ...buckets.skip,
    ...buckets.surfaceOnly,
  ].map((e) => e.path);

  assert.ok(!allPaths.some((p) => p === '.claude/x.md'),
    `.claude/x.md is hard-excluded and must not appear in any bucket; allPaths=${JSON.stringify(allPaths)}`);
});

test('sweepRepo: gitignored allow-listed doc → surfaceOnly (never eligible)', async () => {
  const repo = makeTempRepo();

  // Commit a .gitignore that ignores .html-artifacts/
  writeFileSync(join(repo, '.gitignore'), '.html-artifacts/\n');
  execFileSync('git', ['-C', repo, 'add', '--', '.gitignore'], { encoding: 'utf8' });
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'chore: gitignore (#0)'], { encoding: 'utf8' });

  mkdirSync(join(repo, '.html-artifacts'), { recursive: true });
  writeFileSync(join(repo, '.html-artifacts', 'r.html'), '<html/>');

  const now = Date.now() + STALE_MS + 1000;

  const buckets = await sweepRepo(repo, {
    now,
    apply: false,
    defaultBranch: 'main',
    scan: cleanScan,
    loadClaims: noClaims,
  });

  assert.ok(
    buckets.surfaceOnly.some((e) => e.path === '.html-artifacts/r.html'),
    `.html-artifacts/r.html must be surfaceOnly (gitignored); surfaceOnly=${JSON.stringify(buckets.surfaceOnly)}`
  );
  assert.ok(
    !buckets.eligible.some((e) => e.path === '.html-artifacts/r.html'),
    'gitignored doc must NOT be eligible'
  );
});

// ─── §7 Fixture: worktree lane via defaultBranch override ─────────────────────
//
// Lane detection is honest: we use a real git repo on 'main' but pass
// defaultBranch='other-default' so the branch≠default comparison routes the
// repo into the worktree lane WITHOUT stubbing the detection function.
// This satisfies the spec instruction: "don't stub away the function under test."
//
// I3 fix: claims use the REPOSITORY name (derived from the remote URL by detectRepoName),
// NOT basename(wt).  We configure a fake remote URL so the folder name and the
// repo name differ — this is the real-world linked-worktree scenario.

/** Add a fake remote URL to a temp repo so detectRepoName returns a known name. */
function setFakeOrigin(repo, repoName) {
  execFileSync(
    'git', ['-C', repo, 'remote', 'add', 'origin', `https://github.com/owner/${repoName}.git`],
    { encoding: 'utf8' },
  );
}

test('sweepRepo: worktree lane with ACTIVE claim → skip (live) [folder≠repo name]', async () => {
  const repo = makeTempRepo({ branch: 'main' });
  writeInRepo(repo, 'docs/w.md', '# Worktree doc\nsome content\n');

  // The real repository name is 'archon-real'; the folder name (basename(repo)) differs.
  const repoName = 'archon-real';
  setFakeOrigin(repo, repoName);

  const now = Date.now() + STALE_MS + 1000;

  // Active claim uses the REPOSITORY name, not the folder name.
  const activeClaim = [{
    repo: repoName,
    worktree: 'main',
    paths: ['docs/'],
    status: 'active',
    // expiresAt in the future — source: spec §4.3 D3b "not past expiresAt"
    expiresAt: new Date(now + 10 * 60 * 1000).toISOString(),
  }];

  const buckets = await sweepRepo(repo, {
    now,
    apply: false,
    defaultBranch: 'other-default', // 'main' ≠ 'other-default' → worktree lane
    scan: cleanScan,
    loadClaims: () => activeClaim,
  });

  assert.ok(
    buckets.skip.some((e) => e.path === 'docs/w.md'),
    `docs/w.md should be skip (active claim); skip=${JSON.stringify(buckets.skip)}`
  );
  assert.ok(!buckets.eligible.some((e) => e.path === 'docs/w.md'), 'must not be eligible');
});

test('sweepRepo: worktree lane with EXPIRED claim → eligible [folder≠repo name]', async () => {
  const repo = makeTempRepo({ branch: 'main' });
  writeInRepo(repo, 'docs/w.md', '# Worktree doc\nsome content\n');

  // The real repository name is 'archon-real'; the folder name (basename(repo)) differs.
  const repoName = 'archon-real';
  setFakeOrigin(repo, repoName);

  const now = Date.now() + STALE_MS + 1000;

  const expiredClaim = [{
    repo: repoName,
    worktree: 'main',
    paths: ['docs/'],
    status: 'active',
    // expiresAt in the past → expired
    expiresAt: new Date(now - 10 * 60 * 1000).toISOString(),
  }];

  const buckets = await sweepRepo(repo, {
    now,
    apply: false,
    defaultBranch: 'other-default', // worktree lane
    scan: cleanScan,
    loadClaims: () => expiredClaim,
  });

  assert.ok(
    buckets.eligible.some((e) => e.path === 'docs/w.md'),
    `docs/w.md should be eligible (expired claim); eligible=${JSON.stringify(buckets.eligible)}`
  );
});

test('sweepRepo: worktree lane with NO claim → leaveLog (cannot prove dead)', async () => {
  const repo = makeTempRepo({ branch: 'main' });
  writeInRepo(repo, 'docs/w.md', '# Worktree doc\nsome content\n');

  const now = Date.now() + STALE_MS + 1000;

  const buckets = await sweepRepo(repo, {
    now,
    apply: false,
    defaultBranch: 'other-default', // worktree lane
    scan: cleanScan,
    loadClaims: noClaims,
  });

  assert.ok(
    buckets.leaveLog.some((e) => e.path === 'docs/w.md'),
    `docs/w.md should be leaveLog (no claim); leaveLog=${JSON.stringify(buckets.leaveLog)}`
  );
  assert.ok(!buckets.eligible.some((e) => e.path === 'docs/w.md'), 'must not be eligible');
});

// ─── §7 Fixture: detached HEAD → leaveLog ─────────────────────────────────────

test('sweepRepo: detached HEAD → all docs go to leaveLog', async () => {
  const repo = makeTempRepo();
  writeInRepo(repo, 'docs/detached.md', '# Detached\nsome content\n');

  // Put repo in detached HEAD state
  const sha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  execFileSync('git', ['-C', repo, 'checkout', '--detach', sha], { encoding: 'utf8', stdio: 'pipe' });

  const now = Date.now() + STALE_MS + 1000;

  const buckets = await sweepRepo(repo, {
    now,
    apply: false,
    defaultBranch: 'main',
    scan: cleanScan,
    loadClaims: noClaims,
  });

  assert.ok(
    buckets.leaveLog.some((e) => e.path === 'docs/detached.md'),
    `docs/detached.md should be leaveLog (detached HEAD); leaveLog=${JSON.stringify(buckets.leaveLog)}`
  );
  assert.ok(!buckets.eligible.some((e) => e.path === 'docs/detached.md'), 'must not be eligible');
});

// ─── apply=true: clean scan commits the file ──────────────────────────────────

test('sweepRepo apply=true: eligible stale doc with clean scan is committed', async () => {
  const repo = makeTempRepo();
  writeInRepo(repo, 'docs/orphan.md', '# Orphan\nsome safe content\n');

  const { mtimeMs } = (await import('node:fs')).statSync(join(repo, 'docs/orphan.md'));
  const now = mtimeMs + STALE_MS + (60 * 60 * 1000);

  const buckets = await sweepRepo(repo, {
    now,
    apply: true,
    defaultBranch: 'main',
    scan: cleanScan,
    loadClaims: noClaims,
    owner: true, // primary-default commits require the owner gate (spec §4.5 L2)
  });

  // Should have been eligible and committed
  assert.ok(
    buckets.eligible.some((e) => e.path === 'docs/orphan.md'),
    `docs/orphan.md should be in eligible; eligible=${JSON.stringify(buckets.eligible)}`
  );

  // Verify via git log that the file was actually committed. On primary-default with no
  // issue ref the message is docs(owner): … (the issue-ref exemption), so assert the subject.
  const log = execFileSync('git', ['-C', repo, 'log', '--oneline', '-3'], { encoding: 'utf8' });
  assert.ok(log.includes('recover orphaned docs'), `git log should show the sweep commit; log=${log}`);

  // docs/orphan.md should no longer be untracked
  const status = execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' });
  assert.ok(!status.includes('docs/orphan.md'),
    `docs/orphan.md should be committed, not in status; status=${status}`);
});

// ─── apply=true: failing scan keeps file in leaveLog ──────────────────────────

test('sweepRepo apply=true: failing scan → leaveLog with secret-scan reason', async () => {
  const repo = makeTempRepo();
  writeInRepo(repo, 'docs/secret.md', '# Secret\nsome content with secrets\n');

  const { mtimeMs } = (await import('node:fs')).statSync(join(repo, 'docs/secret.md'));
  const now = mtimeMs + STALE_MS + (60 * 60 * 1000);

  const buckets = await sweepRepo(repo, {
    now,
    apply: true,
    defaultBranch: 'main',
    scan: failScan,
    loadClaims: noClaims,
    owner: true, // owner gate passed so the commit path runs and the scan can reject (spec §4.5 L2)
  });

  // After apply, items that failed scan move from eligible → leaveLog
  const leaveReasons = buckets.leaveLog.map((e) => e.reason);
  assert.ok(
    leaveReasons.some((r) => r === 'secret-scan'),
    `leaveLog should contain a secret-scan reason; leaveLog=${JSON.stringify(buckets.leaveLog)}`
  );

  // Verify not committed: git ls-files reports tracked files; secret.md must NOT be tracked
  const tracked = execFileSync('git', ['-C', repo, 'ls-files', '--', 'docs/secret.md'], { encoding: 'utf8' });
  assert.ok(!tracked.includes('docs/secret.md'),
    `docs/secret.md must not be tracked (committed); ls-files=${tracked}`);
});

// ─── Follow-up D: lane-aware commit message (commit-msg hook exemption) ───────

test('buildSweepMessage: worktree/PR lane carries the issue ref', () => {
  assert.equal(
    buildSweepMessage({ lane: 'worktree', issueRef: '92' }),
    'docs(sweep): recover orphaned docs from prior session (#92)',
  );
});

test('buildSweepMessage: an issueRef already prefixed with # is not doubled', () => {
  assert.equal(
    buildSweepMessage({ lane: 'worktree', issueRef: '#92' }),
    'docs(sweep): recover orphaned docs from prior session (#92)',
  );
});

test('buildSweepMessage: worktree lane derives the issue ref from an agent branch name', () => {
  assert.equal(
    buildSweepMessage({ lane: 'worktree', branch: 'agent/claude/92-doc-sweep' }),
    'docs(sweep): recover orphaned docs from prior session (#92)',
  );
});

test('buildSweepMessage: primary-default with NO issue ref uses the docs(owner) exemption', () => {
  // No issue number to reference → docs(owner): subject, which archon's commit-msg hook
  // exempts from the issue-ref requirement (for owner-maintenance-safe paths). No fabricated #.
  assert.equal(
    buildSweepMessage({ lane: 'primary-default', branch: 'main' }),
    'docs(owner): recover orphaned docs from prior session',
  );
});

test('buildSweepMessage: primary-default WITH an issue ref uses docs(sweep) + (#N)', () => {
  // With a tracking issue, reference it so the issue-ref rule passes even for sweepable docs
  // outside the narrow owner-maintenance-safe set (paired with the ALLOW_MAIN_COMMIT override).
  assert.equal(
    buildSweepMessage({ lane: 'primary-default', issueRef: '92' }),
    'docs(sweep): recover orphaned docs from prior session (#92)',
  );
});

// ─── Follow-up C2: owner gate + destination tiering (spec §4.5 L2/H1) ─────────

test('sweepRepo apply: primary-default WITHOUT owner gate → leaveLog owner-gate, not committed', async () => {
  const repo = makeTempRepo();
  writeInRepo(repo, 'docs/orphan.md', '# Orphan\nsafe content\n');
  const { mtimeMs } = (await import('node:fs')).statSync(join(repo, 'docs/orphan.md'));
  const now = mtimeMs + STALE_MS + (60 * 60 * 1000);

  // No owner asserted — the owner gate (L2) must block the main-lane commit.
  const buckets = await sweepRepo(repo, {
    now, apply: true, defaultBranch: 'main', scan: cleanScan, loadClaims: noClaims,
  });

  assert.ok(
    buckets.leaveLog.some((e) => e.path === 'docs/orphan.md' && e.reason === 'owner-gate'),
    `must be leaveLog owner-gate; leaveLog=${JSON.stringify(buckets.leaveLog)}`,
  );
  const tracked = execFileSync('git', ['-C', repo, 'ls-files', '--', 'docs/orphan.md'], { encoding: 'utf8' });
  assert.ok(!tracked.includes('docs/orphan.md'), 'must NOT be committed without the owner gate');
});

test('sweepRepo apply: worktree eligible but NO open PR → leaveLog no-open-pr (H1)', async () => {
  const repo = makeTempRepo({ branch: 'main' });
  writeInRepo(repo, 'docs/w.md', '# WT\nsafe content\n');
  setFakeOrigin(repo, 'archon-real');
  const now = Date.now() + STALE_MS + 1000;
  const expiredClaim = [{
    repo: 'archon-real', worktree: 'main', paths: ['docs/'], status: 'active',
    expiresAt: new Date(now - 10 * 60 * 1000).toISOString(),
  }];

  const buckets = await sweepRepo(repo, {
    now, apply: true, defaultBranch: 'other-default', scan: cleanScan,
    loadClaims: () => expiredClaim, hasOpenPR: () => false,
  });

  assert.ok(
    buckets.leaveLog.some((e) => e.path === 'docs/w.md' && e.reason === 'no-open-pr'),
    `must be leaveLog no-open-pr; leaveLog=${JSON.stringify(buckets.leaveLog)}`,
  );
  const tracked = execFileSync('git', ['-C', repo, 'ls-files', '--', 'docs/w.md'], { encoding: 'utf8' });
  assert.ok(!tracked.includes('docs/w.md'), 'must NOT commit on a branch no PR tracks (re-strands — H1)');
});

test('sweepRepo apply: worktree eligible WITH open PR → committed to the branch', async () => {
  const repo = makeTempRepo({ branch: 'main' });
  writeInRepo(repo, 'docs/w.md', '# WT\nsafe content\n');
  setFakeOrigin(repo, 'archon-real');
  const now = Date.now() + STALE_MS + 1000;
  const expiredClaim = [{
    repo: 'archon-real', worktree: 'main', paths: ['docs/'], status: 'active',
    expiresAt: new Date(now - 10 * 60 * 1000).toISOString(),
  }];

  const buckets = await sweepRepo(repo, {
    now, apply: true, defaultBranch: 'other-default', scan: cleanScan,
    loadClaims: () => expiredClaim, hasOpenPR: () => true,
  });

  assert.ok(
    buckets.eligible.some((e) => e.path === 'docs/w.md'),
    `must be committed/eligible; eligible=${JSON.stringify(buckets.eligible)}`,
  );
  const tracked = execFileSync('git', ['-C', repo, 'ls-files', '--', 'docs/w.md'], { encoding: 'utf8' });
  assert.ok(tracked.includes('docs/w.md'), 'must be committed to the worktree branch with an open PR');
});

// ─── §7 Fixture: mixed-case excluded path ─────────────────────────────────────

test('sweepRepo: mixed-case excluded path (docs/Process/x.md) → not bucketed', async () => {
  const repo = makeTempRepo();
  writeInRepo(repo, 'docs/Process/x.md', '# Process\nsome content\n');

  const now = Date.now() + STALE_MS + 1000;

  const buckets = await sweepRepo(repo, {
    now,
    apply: false,
    defaultBranch: 'main',
    scan: cleanScan,
    loadClaims: noClaims,
  });

  const allPaths = [
    ...buckets.eligible,
    ...buckets.leaveLog,
    ...buckets.skip,
    ...buckets.surfaceOnly,
  ].map((e) => e.path);

  // On case-insensitive FS the path is docs/Process/x.md; on case-sensitive it's docs/Process/x.md
  // Either way it must not appear in any bucket (ALLOW_EXCEPT wins case-insensitively)
  assert.ok(
    !allPaths.some((p) => p.toLowerCase() === 'docs/process/x.md'),
    `docs/Process/x.md (case-insensitive exclude) must not appear in any bucket; allPaths=${JSON.stringify(allPaths)}`
  );
});

// ─── §7 Fixture: staged-but-uncommitted add is enumerated ─────────────────────

test('sweepRepo: staged-but-not-committed doc is enumerated and classified (C1)', async () => {
  const repo = makeTempRepo();
  writeInRepo(repo, 'docs/staged.md', '# Staged\nsome content\n');
  execFileSync('git', ['-C', repo, 'add', '--', 'docs/staged.md'], { encoding: 'utf8' });

  const { mtimeMs } = (await import('node:fs')).statSync(join(repo, 'docs/staged.md'));
  const now = mtimeMs + STALE_MS + (60 * 60 * 1000);

  const buckets = await sweepRepo(repo, {
    now,
    apply: false,
    defaultBranch: 'main',
    scan: cleanScan,
    loadClaims: noClaims,
  });

  // Staged doc should be classified (eligible on primary-default if stale)
  const allClassified = [
    ...buckets.eligible,
    ...buckets.leaveLog,
    ...buckets.skip,
  ].map((e) => e.path);

  assert.ok(
    allClassified.some((p) => p === 'docs/staged.md'),
    `docs/staged.md (staged C1) must appear in eligible/leaveLog/skip; got=${JSON.stringify(allClassified)}`
  );
});

// ─── #124 S2 coordination bookend: current-task.json IS the doc-sweep claim ───

test('sweepRepo: live current-task.json claims the worktree — stale doc → skip, no claim file needed', async () => {
  const repo = makeTempRepo({ branch: 'main' });
  writeInRepo(repo, 'docs/wip.md', '# In-flight lane doc\nsome content\n');
  setFakeOrigin(repo, 'archon-real');

  const now = Date.now() + STALE_MS + 1000; // stale enough to be eligible without a claim

  // agent:start-task metadata — branch matches the checked-out branch.
  mkdirSync(join(repo, '.agent'), { recursive: true });
  writeFileSync(join(repo, '.agent', 'current-task.json'), JSON.stringify({
    issue: 124,
    branch: 'main',
    createdAt: new Date(now - 60 * 60 * 1000).toISOString(), // 1h old: live
  }));

  const buckets = await sweepRepo(repo, {
    now,
    apply: false,
    defaultBranch: 'other-default', // worktree lane
    scan: cleanScan,
    // no loadClaims stub: defaultLoadClaims must synthesize the task claim
  });

  assert.ok(buckets.skip.some((e) => e.path === 'docs/wip.md'),
    `docs/wip.md must be skip (live task claim); skip=${JSON.stringify(buckets.skip)}`);
  assert.ok(!buckets.eligible.some((e) => e.path === 'docs/wip.md'), 'must not be eligible');
});

test('sweepRepo: stale current-task.json (past TASK_CLAIM_TTL_MS) does not claim — doc stays eligible', async () => {
  const repo = makeTempRepo({ branch: 'main' });
  writeInRepo(repo, 'docs/abandoned.md', '# Abandoned lane doc\nsome content\n');
  setFakeOrigin(repo, 'archon-real');

  const now = Date.now() + STALE_MS + 1000;

  mkdirSync(join(repo, '.agent'), { recursive: true });
  writeFileSync(join(repo, '.agent', 'current-task.json'), JSON.stringify({
    issue: 124,
    branch: 'main',
    createdAt: new Date(now - 48 * 60 * 60 * 1000).toISOString(), // 48h: past the 24h TTL
  }));

  const buckets = await sweepRepo(repo, {
    now,
    apply: false,
    defaultBranch: 'other-default',
    scan: cleanScan,
  });

  assert.ok(buckets.eligible.some((e) => e.path === 'docs/abandoned.md'),
    `docs/abandoned.md must be eligible (task claim expired); eligible=${JSON.stringify(buckets.eligible)}`);
});

test('sweepRepo: close:dod refresh (lastActivityAt) extends an otherwise-expired task claim', async () => {
  const repo = makeTempRepo({ branch: 'main' });
  writeInRepo(repo, 'docs/long-lane.md', '# Long-running lane doc\nsome content\n');
  setFakeOrigin(repo, 'archon-real');

  const now = Date.now() + STALE_MS + 1000;

  mkdirSync(join(repo, '.agent'), { recursive: true });
  writeFileSync(join(repo, '.agent', 'current-task.json'), JSON.stringify({
    issue: 124,
    branch: 'main',
    createdAt: new Date(now - 48 * 60 * 60 * 1000).toISOString(), // stale start...
    lastActivityAt: new Date(now - 30 * 60 * 1000).toISOString(), // ...but active 30min ago
  }));

  const buckets = await sweepRepo(repo, {
    now,
    apply: false,
    defaultBranch: 'other-default',
    scan: cleanScan,
  });

  assert.ok(buckets.skip.some((e) => e.path === 'docs/long-lane.md'),
    `docs/long-lane.md must be skip (claim refreshed by activity); skip=${JSON.stringify(buckets.skip)}`);
});
