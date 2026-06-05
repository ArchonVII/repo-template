// git.mjs — git I/O layer for doc-sweep (Tasks 1.4–1.5)
// Spec: docs/agent-process/doc-sweep.md §4.2 (enumeration D6/D9), §4.4/§4.5 (commit safety)
// All git output parsed NUL-safe via -z flags; buffer encoding prevents mojibake on paths.

import { execFileSync } from 'node:child_process';
import { lstatSync, statSync, openSync, closeSync, unlinkSync, mkdirSync, readFileSync, writeSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Run git with -C <wt> and return raw Buffer output.
 * Using { encoding: 'buffer' } is NUL-safe (spec D6): we split on \0, not newlines,
 * so paths with spaces, Unicode, or newlines are preserved correctly.
 */
function git(wt, args, extraEnv) {
  return execFileSync('git', ['-C', wt, ...args], {
    encoding: 'buffer',
    ...(extraEnv ? { env: { ...process.env, ...extraEnv } } : {}),
  });
}

/**
 * Split a NUL-delimited Buffer into non-empty UTF-8 strings.
 * Spec §4.2 D6: always parse -z output this way; never split on newlines.
 */
function splitNul(buf) {
  return buf.toString('utf8').split('\0').filter(Boolean);
}

/**
 * Returns true if the repo-relative path inside wt is a symlink or junction.
 * Spec §4.2: skip symlinks/junctions — lstat only, never follow (M3).
 */
function isSymlink(wt, rel) {
  try {
    return lstatSync(join(wt, rel)).isSymbolicLink();
  } catch {
    // If lstat fails (path gone between enumeration and check), treat as non-symlink;
    // the TOCTOU re-stat in commitFileGuarded will catch any disappearing file later.
    return false;
  }
}

// ─── §4.2 Enumeration ─────────────────────────────────────────────────────────

/**
 * enumerateCandidates(wt) → string[]
 *
 * Returns the union of two DISJOINT NUL-delimited git views (spec §4.2 D9):
 *   (a) untracked files:             git ls-files --others --exclude-standard -z
 *   (b) staged-but-uncommitted ADDs: git diff --cached --name-only --diff-filter=A -z
 *
 * The two views are disjoint: a staged file does NOT appear in --others; both are required
 * to capture the author's "git add = save my work" signal (adversarial C1).
 *
 * Per-entry filters applied before returning:
 *   - Skip entries ending in '/' (collapsed untracked directory / nested repo — spec H4).
 *   - Skip symlinks/junctions (lstat; never follow — spec M3).
 * Duplicates are removed via Set (possible if the same path somehow appears in both views).
 */
export function enumerateCandidates(wt) {
  const untracked = splitNul(git(wt, ['ls-files', '--others', '--exclude-standard', '-z']));
  const stagedAdds = splitNul(git(wt, ['diff', '--cached', '--name-only', '--diff-filter=A', '-z']));

  // Union: Set dedup preserves order of first appearance
  const union = new Set([...untracked, ...stagedAdds]);

  return [...union].filter((p) => {
    if (p.endsWith('/')) return false;   // collapsed dir / nested repo — spec §4.2 D9
    if (isSymlink(wt, p)) return false;  // symlink — spec §4.2 M3
    return true;
  });
}

/**
 * enumerateIgnored(wt, roots) → string[]
 *
 * Returns ignored-but-present files under the allow-listed roots (spec §4.2 C2).
 * These are SURFACE-ONLY — the orchestrator must never auto-commit them.
 * Committing a gitignored file is a policy violation; the sweep only surfaces them.
 *
 * Default roots match the spec §4.2 allow-listed paths that are commonly gitignored
 * (especially .html-artifacts/).
 */
export function enumerateIgnored(wt, roots = ['docs', '.changelog', '.html-artifacts']) {
  const raw = splitNul(git(wt, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', ...roots]));
  // Filter out collapsed dir/ entries (same rule as candidates)
  return raw.filter((p) => !p.endsWith('/'));
}

// ─── §4.5 TOCTOU capture ─────────────────────────────────────────────────────

/**
 * statSig(wt, rel) → { mtimeMs: number, size: number }
 *
 * Captures mtime + size for TOCTOU re-stat (spec §4.5 C4).
 * Call at classify time; re-stat immediately before git add; abort if changed.
 * Uses statSync (follows symlinks) — but symlinks are filtered before this is called.
 */
export function statSig(wt, rel) {
  const s = statSync(join(wt, rel));
  return { mtimeMs: s.mtimeMs, size: s.size };
}

// ─── §4.4 / §4.5 Commit safety ───────────────────────────────────────────────

/**
 * commitFileGuarded(wt, rel, captured, message, scan) → { committed: boolean, reason?: string }
 *
 * Commits a single file only when ALL safety checks pass (spec §4.4/§4.5):
 *
 * 1. TOCTOU re-stat (C4): re-stat now; if mtimeMs or size differ from `captured`
 *    → return { committed: false, reason: 'toctou' }. Do NOT proceed.
 *
 * 2. Secret gate (M2): call scan(absPath). `scan` is dependency-injected so the
 *    orchestrator can wire a real gitleaks runner; tests inject a stub.
 *    scan returns true = clean, false = hit.
 *    → scan returns false: return { committed: false, reason: 'secret-scan' }.
 *
 * 3. Commit: git add -- <rel> (exactly one path, NEVER -A or '.') then git commit -m <message>.
 *    Hooks and signing are respected — no --no-verify (spec §4.5 L1).
 *
 * @param {string}   wt        Absolute path to the working tree root
 * @param {string}   rel       Repo-relative POSIX path of the file to commit
 * @param {{ mtimeMs: number, size: number }} captured  Stat captured at classify time
 * @param {string}   message   Commit message (must already contain the issue ref per the hook)
 * @param {(absPath: string) => boolean} scan  Secret scanner; true = clean
 * @param {object}   [opts]
 * @param {boolean}  [opts.allowMainCommit=false]  Set ALLOW_MAIN_COMMIT=1 in the commit env —
 *   the repo's own AUDITED owner-maintenance override. Hooks still run (it is not --no-verify);
 *   the override is logged by the hook to .agent/bypass.log. Used only on the owner-gated
 *   primary-default lane for sweepable docs outside the repo's narrow owner-maintenance-safe set.
 *
 * On hook rejection (or any git error) the staged path is reset and { committed:false,
 * reason:'hook-rejected' } is returned — never --no-verify (spec §4.5 L1).
 */
export function commitFileGuarded(wt, rel, captured, message, scan, { allowMainCommit = false } = {}) {
  // Step 1 — TOCTOU re-stat (spec §4.5 C4)
  const now = statSig(wt, rel);
  if (now.mtimeMs !== captured.mtimeMs || now.size !== captured.size) {
    return { committed: false, reason: 'toctou' };
  }

  // Step 2 — Deterministic secret gate (spec §4.4, M2)
  const absPath = join(wt, rel);
  if (!scan(absPath)) {
    return { committed: false, reason: 'secret-scan' };
  }

  // Step 3 — Selective, file-by-file staging then commit (spec §4.5 H4 / L1).
  // --only commits exactly the given path regardless of what else is in the index,
  // preventing a clobber of another agent's pre-staged work (C1 fix).
  const env = allowMainCommit ? { ALLOW_MAIN_COMMIT: '1' } : undefined;
  try {
    git(wt, ['add', '--', rel]);                              // exactly one path, never -A or '.'
    git(wt, ['commit', '-m', message, '--only', '--', rel], env); // path-scoped; hooks/signing run
  } catch {
    // Hook rejection or git failure → restore a clean index, then leave + log (spec §4.5 L1).
    try { git(wt, ['reset', '-q', '--', rel]); } catch { /* best-effort unstage */ }
    return { committed: false, reason: 'hook-rejected' };
  }

  return { committed: true };
}

// ─── §4.5 Sweep lock (H5) ────────────────────────────────────────────────────

/**
 * Lock file path — per-repo, under .agent/coordination/ so it sits beside claim files.
 * Source: spec §4.5 H5 "acquire a per-repo lock … held across classify+commit".
 */
function lockPath(wt) {
  return join(wt, '.agent', 'coordination', 'doc-sweep.lock');
}

/**
 * Sweep-lock staleness TTL. A held lock older than this is presumed abandoned (the
 * holding sweep crashed/was killed) and may be reclaimed — without this, a single
 * crashed sweep would strand the O_EXCL lock forever and block all future sweeps.
 * Source: owner decision 2026-06-04 — a sweep completes in seconds; 15 min is far
 * longer than any legitimate run, so an older lock cannot belong to a live sweep.
 */
export const LOCK_TTL_MS = 15 * 60 * 1000; // 900 000 ms

/**
 * Read the acquire timestamp recorded in a lock file.
 * Prefers the JSON `ts` field; falls back to the lock file's own mtime when the
 * payload is missing/corrupt (a lock with no readable ts must still be able to expire).
 * Returns null only if the file cannot be stat'd at all.
 */
function readLockTimestamp(path) {
  try {
    const ts = JSON.parse(readFileSync(path, 'utf8'))?.ts;
    if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
  } catch {
    // unparseable / missing payload — fall through to the mtime fallback
  }
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

/** Create the lock file with O_EXCL and write the forensic payload. Throws EEXIST if held. */
function createLockFile(path, now, pid) {
  const fd = openSync(path, 'wx'); // O_WRONLY | O_CREAT | O_EXCL — atomic exclusive create
  try {
    writeSync(fd, JSON.stringify({ ts: now, pid, host: hostname() }) + '\n');
  } finally {
    closeSync(fd);
  }
}

/**
 * acquireLock(wt, opts?) → { acquired: boolean, handle?: { path, reclaimed? } }
 *
 * Acquires an exclusive per-repo sweep lock (spec §4.5 H5).
 *
 * The lock records { ts, pid, host }. A second concurrent call fails on O_EXCL and
 * returns { acquired: false } — UNLESS the existing lock is older than ttlMs, in which
 * case its holder is presumed dead and the lock is reclaimed (handle.reclaimed = true).
 * This fixes the original no-expiry lock, where a crashed sweep stranded it forever.
 *
 * @param {string} wt   Working-tree root.
 * @param {object} [opts]
 * @param {number} [opts.now=Date.now()]   Current time (ms); injectable for tests.
 * @param {number} [opts.ttlMs=LOCK_TTL_MS] Staleness threshold.
 * @param {number} [opts.pid=process.pid]   Recorded for forensics.
 */
export function acquireLock(wt, { now = Date.now(), ttlMs = LOCK_TTL_MS, pid = process.pid } = {}) {
  const path = lockPath(wt);
  // Ensure the coordination directory exists (may not exist in fresh repos)
  mkdirSync(join(wt, '.agent', 'coordination'), { recursive: true });

  try {
    createLockFile(path, now, pid);
    return { acquired: true, handle: { path } };
  } catch (err) {
    if (err.code !== 'EEXIST') throw err; // unexpected error — re-throw
  }

  // Lock already exists — reclaim only if the holder is stale (older than ttlMs).
  const heldTs = readLockTimestamp(path);
  if (heldTs != null && now - heldTs < ttlMs) {
    return { acquired: false }; // a live (recent) holder — skip, do NOT queue
  }

  // Stale (or unreadable + old) → reclaim atomically: remove, then re-create with O_EXCL.
  try {
    unlinkSync(path);
  } catch {
    // Another process may have just removed/reclaimed it — fall through to the create attempt.
  }
  try {
    createLockFile(path, now, pid);
    return { acquired: true, handle: { path, reclaimed: true } };
  } catch (err) {
    if (err.code === 'EEXIST') return { acquired: false }; // lost the reclaim race — skip
    throw err;
  }
}

/**
 * releaseLock(handle)
 *
 * Removes the lock file acquired by acquireLock.
 * Call exactly once per successful acquire; double-release throws (file already gone).
 */
export function releaseLock(handle) {
  unlinkSync(handle.path);
}
