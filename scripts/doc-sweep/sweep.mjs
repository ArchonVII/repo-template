// sweep.mjs — orchestrator for doc-sweep (Task 1.6)
// Spec: docs/agent-process/doc-sweep.md §4.2–§4.5, §7 acceptance fixture
// Wires lib.mjs + git.mjs into a single sweepRepo() function + CLI entry point.

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';

import { isSweepable, classify, coveringClaimStatus, norm } from './lib.mjs';
import {
  enumerateCandidates,
  enumerateIgnored,
  statSig,
  commitFileGuarded,
  acquireLock,
  releaseLock,
} from './git.mjs';

// ─── Commit message (lane-aware — spec §4.5 + commit-msg hook exemption) ───────
// Source: spec §4.5 convention ("docs(sweep): recover orphaned docs from prior session")
// reconciled with archon's .githooks/commit-msg, which requires an issue ref UNLESS the
// subject is docs(owner):/chore(owner): (owner-maintenance lane) on owner-maintenance-safe
// paths. The hardcoded (#92) is replaced by per-lane selection so the runner is repo-agnostic.

/** Normalize a caller-supplied or branch-derived issue ref to "#N", or null if none. */
function deriveIssueRef(issueRef, branch) {
  if (issueRef != null && String(issueRef).trim() !== '') {
    return `#${String(issueRef).replace(/^#/, '').trim()}`;
  }
  // Agent branch convention: agent/<tool>/<issue>-<slug> → take the issue number.
  const m = /^agent\/[^/]+\/(\d+)-/.exec(branch ?? '');
  return m ? `#${m[1]}` : null;
}

/**
 * buildSweepMessage({ lane, issueRef, branch }) → string
 *
 * Lane-aware sweep commit subject:
 *   - primary-default with NO issue ref → docs(owner): … (exempt from the issue-ref rule;
 *     no fabricated issue number — works for owner-maintenance-safe paths).
 *   - otherwise → docs(sweep): … (#N), carrying the caller's issueRef or one derived from the
 *     agent branch name. On the primary-default lane this pairs with the ALLOW_MAIN_COMMIT
 *     override to recover sweepable docs outside the narrow owner-maintenance-safe set.
 */
export function buildSweepMessage({ lane, issueRef, branch } = {}) {
  const ref = deriveIssueRef(issueRef, branch);
  if (lane === 'primary-default' && !ref) {
    return 'docs(owner): recover orphaned docs from prior session';
  }
  return `docs(sweep): recover orphaned docs from prior session${ref ? ` (${ref})` : ''}`;
}

// ─── Default secret scanner ───────────────────────────────────────────────────
/**
 * defaultScan(absPath) → boolean
 *
 * Shells out to gitleaks for a deterministic secret gate (spec §4.4 M2).
 * exit 0 = clean → true. Any hit → false.
 * If gitleaks is not installed (ENOENT) → false (fail closed: no scanner ⇒ no auto-commit).
 * Tests always inject a stub so this path is never hit in test runs.
 */
function defaultScan(absPath) {
  try {
    execFileSync('gitleaks', ['detect', '--no-git', '--source', absPath], {
      stdio: 'ignore',
    });
    return true; // exit 0 = clean
  } catch (err) {
    if (err.code === 'ENOENT') {
      // gitleaks not installed — fail closed (spec §4.4: no scanner ⇒ no auto-commit)
      process.stderr.write('[doc-sweep] gitleaks not found; failing closed (no auto-commit)\n');
      return false;
    }
    // Non-zero exit = scan found a hit
    return false;
  }
}

// ─── Git helpers (used only in the orchestrator) ───────────────────────────────

/** Run git synchronously with buffer output; never throws unless stdio fails. */
function gitBuf(wt, args) {
  return execFileSync('git', ['-C', wt, ...args], { encoding: 'buffer' });
}

/**
 * gitStr(wt, args) → string (trimmed)
 * Returns empty string on non-zero exit (for commands like symbolic-ref -q HEAD).
 * stderr is suppressed so git diagnostic noise (e.g. "fatal: origin/HEAD is not a
 * symbolic ref") never leaks to the terminal — errors are caught, not printed (M1 fix).
 */
function gitStr(wt, args) {
  try {
    return execFileSync('git', ['-C', wt, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

// ─── Checkout-state / lane detection (spec §4.3, D10, adversarial C3) ─────────

/**
 * detectLane(wt, defaultBranch) → 'primary-default' | 'worktree' | 'detached'
 *
 * Step 1: symbolic-ref -q HEAD — exits non-zero for detached HEAD (C3).
 *   - non-zero → 'detached'
 *   - zero: get short branch name
 * Step 2: compare --git-dir and --git-common-dir to determine primary vs linked worktree.
 *   - equal ⇒ primary checkout; differ ⇒ linked worktree
 * Step 3: lane assignment:
 *   - primary && branch === defaultBranch → 'primary-default'
 *   - primary && branch !== defaultBranch (F19 guard broken) → 'worktree'
 *   - linked worktree (non-primary) → 'worktree'
 *   - detached HEAD → 'detached'
 */
function detectLane(wt, defaultBranch) {
  // Detached HEAD detection — symbolic-ref -q HEAD exits non-zero when detached (D10 C3).
  // Do NOT use abbrev-ref (returns literal "HEAD" when detached — adversarial C3).
  const symRef = gitStr(wt, ['symbolic-ref', '-q', 'HEAD']);
  if (!symRef) return 'detached'; // non-zero exit → detached HEAD

  // Short branch name (strip refs/heads/ prefix)
  const branch = gitStr(wt, ['symbolic-ref', '--short', 'HEAD']);

  // Primary vs linked worktree: --git-dir vs --git-common-dir
  // Equal paths ⇒ primary checkout; differ ⇒ linked worktree (spec §4.3 D10).
  const gitDir    = gitStr(wt, ['rev-parse', '--git-dir']);
  const commonDir = gitStr(wt, ['rev-parse', '--git-common-dir']);
  const isPrimary = (gitDir === commonDir);

  if (!isPrimary) return 'worktree'; // linked worktree regardless of branch

  // Primary checkout
  if (branch === defaultBranch) return 'primary-default';
  // Primary but on non-default branch → F19 guard broken → treat as worktree (spec §4.3)
  return 'worktree';
}

/**
 * detectDefaultBranch(wt) → string
 *
 * Detect via `git symbolic-ref --short refs/remotes/origin/HEAD` (strip 'origin/').
 * Falls back to 'main' if no remote configured (common in temp-repo tests).
 * Source: spec §4.3 "if not passed, detect via symbolic-ref --short refs/remotes/origin/HEAD".
 */
function detectDefaultBranch(wt) {
  const ref = gitStr(wt, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (ref) {
    // ref is like "origin/main" → strip the "origin/" prefix
    return ref.replace(/^origin\//, '');
  }
  return 'main'; // fallback when no remote — spec §4.3
}

// ─── Repo name detection (I3) ────────────────────────────────────────────────

/**
 * detectRepoName(wt) → string
 *
 * Returns the canonical repository name for claim matching (spec §4.3 D3b).
 *
 * For a linked worktree the working-tree FOLDER name (basename(wt)) is wrong —
 * it reflects the worktree checkout directory, not the repo.  Two strategies:
 *
 * 1. Remote origin URL: `git remote get-url origin` → strip trailing `.git`,
 *    take the last path segment.  Works for any hosted repo.
 * 2. Fallback (no remote / ENOENT): `git rev-parse --path-format=absolute
 *    --git-common-dir` yields the shared .git dir; its parent is the primary
 *    checkout folder whose basename IS the repo name.
 *
 * Source: spec §4.3 I3 fix directive.
 */
function detectRepoName(wt) {
  // Strategy 1: derive from remote origin URL
  const originUrl = gitStr(wt, ['remote', 'get-url', 'origin']);
  if (originUrl) {
    // Strip trailing .git, then take the last path segment.
    // Works for https://github.com/owner/repo.git  and  git@github.com:owner/repo.git
    const stripped = originUrl.replace(/\.git$/, '');
    const segment = stripped.split(/[/:]/).filter(Boolean).pop();
    if (segment) return segment;
  }

  // Strategy 2: common-dir parent basename (linked worktree fallback)
  const commonDir = gitStr(wt, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (commonDir) {
    // commonDir is the shared .git directory; its parent is the primary checkout.
    return basename(dirname(commonDir));
  }

  // Last resort: folder name (original behaviour, correct for non-worktree cases)
  return basename(wt);
}

// ─── Default loadClaims ───────────────────────────────────────────────────────

/**
 * defaultLoadClaims(wt) → claim[]
 *
 * Reads .agent/coordination/claims/*.json if the directory exists, else returns [].
 * Parses each file as JSON; silently skips unparseable files (fail-safe: ambiguity
 * never makes a doc eligible — spec §4.3 H3).
 */
function defaultLoadClaims(wt) {
  const claimsDir = join(wt, '.agent', 'coordination', 'claims');
  let entries;
  try {
    entries = readdirSync(claimsDir);
  } catch {
    return []; // directory absent → no claims
  }
  const claims = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      const raw = readFileSync(join(claimsDir, entry), 'utf8');
      claims.push(JSON.parse(raw));
    } catch {
      // Unparseable claim — skip; fail-safe is handled in coveringClaimStatus
    }
  }
  return claims;
}

// ─── Default open-PR check (destination tiering, H1) ───────────────────────────

/**
 * defaultHasOpenPR(wt, branch) → boolean
 *
 * True iff an OPEN PR tracks `branch`. Used by the worktree-lane destination tier:
 * the sweep commits a recovered doc only when a PR tracks the branch, so the commit is
 * pushed/visible rather than re-stranded on a local-only branch (spec §4.5 H1).
 *
 * gh infers the repo from the working tree's origin remote. Any failure (no open PR,
 * gh not installed, not authenticated) → false: conservative, never commit to a branch
 * we cannot prove a PR tracks.
 */
function defaultHasOpenPR(wt, branch) {
  try {
    const out = execFileSync(
      'gh', ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number'],
      { cwd: wt, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return JSON.parse(out).length > 0;
  } catch {
    return false;
  }
}

// ─── sweepRepo ────────────────────────────────────────────────────────────────

/**
 * sweepRepo(wt, opts) → { eligible, leaveLog, skip, surfaceOnly }
 *
 * Main orchestrator. Implements spec §4.2–§4.5 in order.
 *
 * @param {string} wt           Absolute path to the working tree root.
 * @param {object} opts
 * @param {number}   opts.now             Current timestamp (ms); use Date.now() in CLI.
 * @param {boolean}  [opts.apply=false]   If true, acquires lock and commits eligible items.
 * @param {string}   [opts.defaultBranch] Default branch name; detected if omitted.
 * @param {(abs: string) => boolean} [opts.scan] Secret scanner; defaults to gitleaks.
 * @param {(wt: string) => object[]} [opts.loadClaims] Claims loader; defaults to reading .agent/coordination/claims/*.json.
 * @param {boolean}  [opts.owner=false]   Owner gate (L2): authorizes commits on the primary-default lane.
 * @param {(wt: string, branch: string) => boolean} [opts.hasOpenPR] Worktree-lane gate (H1); defaults to a gh query.
 * @param {boolean}  [opts.allowMainCommit=false] Pass the audited ALLOW_MAIN_COMMIT override on the primary-default lane.
 *
 * Returns buckets:
 *   eligible    — docs ready to commit (or that were committed when apply=true)
 *   leaveLog    — docs that need human review / cannot be proven dead
 *   skip        — docs with an active live claim (worktree lane)
 *   surfaceOnly — gitignored allow-listed docs (surface for awareness, never commit)
 *
 * Each item: { path: string, lane: string, reason: string }
 */
export async function sweepRepo(wt, {
  now,
  apply = false,
  defaultBranch,
  scan,
  loadClaims,
  owner = false,
  hasOpenPR,
  allowMainCommit = false,
  issueRef,
} = {}) {
  // Resolve defaults
  const resolvedDefaultBranch = defaultBranch ?? detectDefaultBranch(wt);
  const resolvedScan          = scan          ?? defaultScan;
  const resolvedLoadClaims    = loadClaims    ?? defaultLoadClaims;
  const resolvedHasOpenPR     = hasOpenPR     ?? defaultHasOpenPR;

  // Repo name for claim matching — detect from remote URL or common-dir (spec §4.3 I3).
  // basename(wt) is wrong for linked worktrees whose folder name differs from the repo name.
  const repo = detectRepoName(wt);

  // Buckets — returned regardless of apply mode
  const eligible    = [];
  const leaveLog    = [];
  const skip        = [];
  const surfaceOnly = [];

  // ── Step 1: Checkout-state / lane detection (spec §4.3, D10) ──────────────
  const lane = detectLane(wt, resolvedDefaultBranch);

  // Hoist currentBranch — used in the claim worktree field for every candidate (M2 fix).
  // Computing this once avoids a redundant git call per candidate in the loop below.
  const currentBranch = gitStr(wt, ['symbolic-ref', '--short', 'HEAD']) || 'HEAD';

  // ── Step 2a: Enumerate ignored allow-listed docs → surfaceOnly (spec §4.2 C2) ──
  // Must be done BEFORE enumerateCandidates so the gitignored set is separate.
  const ignoredPaths = enumerateIgnored(wt);
  for (const p of ignoredPaths) {
    const rel = norm(p);
    if (isSweepable(rel)) {
      surfaceOnly.push({ path: rel, lane, reason: 'gitignored' });
    }
  }

  // Build a set of ignored paths so we can skip them in candidate enumeration
  // (though they're disjoint by git's own logic, be defensive)
  const ignoredSet = new Set(ignoredPaths.map(norm));

  // ── Step 2b: Enumerate candidates (spec §4.2 D9) ──────────────────────────
  const candidates = enumerateCandidates(wt);

  // Load claims once for the entire sweep (spec §4.3 D3b)
  const claims = resolvedLoadClaims(wt);

  // ── Step 3–5: Per-candidate classification ────────────────────────────────
  for (const rawPath of candidates) {
    const rel = norm(rawPath);

    // Skip gitignored paths (they go to surfaceOnly above, not candidates — but be safe)
    if (ignoredSet.has(rel)) continue;

    // §4.1 allow-list / hard-exclude filter — non-sweepable → drop (not bucketed)
    if (!isSweepable(rel)) continue;

    // Capture mtime+size at classify time (TOCTOU re-stat later at commit — spec §4.5 C4)
    let captured;
    try {
      captured = statSig(wt, rel);
    } catch {
      // File disappeared between enumeration and stat — leave+log
      leaveLog.push({ path: rel, lane, reason: 'stat-error' });
      continue;
    }

    const { mtimeMs } = captured;

    // claimStatus needed only for worktree lane (spec §4.3)
    let claimStatus = 'absent';
    if (lane === 'worktree') {
      claimStatus = coveringClaimStatus(claims, {
        repo,
        worktree: currentBranch,
        relPath: rel,
        now,
      });
    }

    // Classify
    const { verdict, reason } = classify({ lane, mtimeMs, now, claimStatus });

    if (verdict === 'eligible') {
      eligible.push({ path: rel, lane, reason, captured });
    } else if (verdict === 'skip') {
      skip.push({ path: rel, lane, reason });
    } else {
      // leave-log
      leaveLog.push({ path: rel, lane, reason });
    }
  }

  // ── Step 6: Apply mode — acquire lock and commit eligible items ────────────
  if (apply && eligible.length > 0) {
    const lockResult = acquireLock(wt);
    if (!lockResult.acquired) {
      // Lock held by another sweep — skip without queuing (spec §4.5 H5)
      process.stderr.write('[doc-sweep] Lock held by another sweep; skipping apply.\n');
      return { eligible, leaveLog, skip, surfaceOnly };
    }

    try {
      // Process eligible items in place; failed/blocked ones move to leaveLog.
      // Destination is tiered by lane (spec §4.5 H1/L2):
      //   primary-default → owner-maintenance lane, gated by an explicit owner assertion (L2)
      //   worktree        → commit only when an open PR tracks the branch; else re-strands (H1)
      const committed = [];
      for (const item of eligible) {
        let result;
        if (item.lane === 'primary-default') {
          if (!owner) {
            leaveLog.push({ path: item.path, lane: item.lane, reason: 'owner-gate' });
            continue;
          }
          const message = buildSweepMessage({ lane: 'primary-default', issueRef, branch: currentBranch });
          result = commitFileGuarded(wt, item.path, item.captured, message, resolvedScan, { allowMainCommit });
        } else {
          if (!resolvedHasOpenPR(wt, currentBranch)) {
            leaveLog.push({ path: item.path, lane: item.lane, reason: 'no-open-pr' });
            continue;
          }
          const message = buildSweepMessage({ lane: 'worktree', issueRef, branch: currentBranch });
          result = commitFileGuarded(wt, item.path, item.captured, message, resolvedScan);
        }
        if (result.committed) {
          committed.push(item);
        } else {
          // TOCTOU / secret-scan / hook-rejected → move to leaveLog
          leaveLog.push({ path: item.path, lane: item.lane, reason: result.reason });
        }
      }
      // Replace eligible with only the committed ones
      eligible.length = 0;
      eligible.push(...committed);
    } finally {
      releaseLock(lockResult.handle);
    }
  }

  // Strip the internal `captured` field before returning — callers only need path/lane/reason
  for (const item of eligible) {
    delete item.captured;
  }

  return { eligible, leaveLog, skip, surfaceOnly };
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

// Detect if run directly: import.meta.url matches process.argv[1] (cross-platform safe)
const isMain = process.argv[1] &&
  (new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname ||
   import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/')));

if (isMain) {
  // Parse CLI args: --repo <path> [--apply] [--json]
  const args = process.argv.slice(2);
  const repoIdx = args.indexOf('--repo');
  if (repoIdx === -1 || !args[repoIdx + 1]) {
    process.stderr.write('Usage: node sweep.mjs --repo <path> [--apply] [--json]\n');
    process.exit(1);
  }
  const wt    = args[repoIdx + 1];
  const apply = args.includes('--apply');
  const json  = args.includes('--json');
  const owner = args.includes('--owner');
  const allowMainCommit = args.includes('--allow-main-commit');
  const issueIdx = args.indexOf('--issue');
  const issueRef = issueIdx !== -1 ? args[issueIdx + 1] : undefined;

  sweepRepo(wt, { now: Date.now(), apply, owner, allowMainCommit, issueRef }).then((buckets) => {
    if (json) {
      process.stdout.write(JSON.stringify(buckets, null, 2) + '\n');
    } else {
      const fmt = (label, items) => {
        if (items.length === 0) return `${label}: (none)\n`;
        return `${label} (${items.length}):\n` +
          items.map((e) => `  ${e.path}  [${e.reason}]`).join('\n') + '\n';
      };
      process.stdout.write(
        `\n=== doc-sweep report for ${wt} ===\n` +
        fmt('eligible', buckets.eligible) +
        fmt('leaveLog', buckets.leaveLog) +
        fmt('skip', buckets.skip) +
        fmt('surfaceOnly', buckets.surfaceOnly) + '\n'
      );
    }
  }).catch((err) => {
    process.stderr.write(`[doc-sweep] Error: ${err.message}\n`);
    process.exit(1);
  });
}
