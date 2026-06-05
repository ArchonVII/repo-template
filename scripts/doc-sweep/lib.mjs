// lib.mjs — pure classification core for doc-sweep
// Spec: docs/agent-process/doc-sweep.md §4.1 (allow-list/exclude) and §4.3 (classifier + claims)
// No I/O, no git — just pure functions for use by the orchestrator.

// ─── §4.1 Allow-list / hard-exclude ──────────────────────────────────────────
// Match case-insensitively (NTFS — spec §4.1 D10). Exclude wins ties.

/** Allow-list roots — docs/**, .changelog/**, .html-artifacts/**, image assets */
const ALLOW = [
  /^docs\//i,
  /^\.changelog\//i,
  /^\.html-artifacts\//i,
  /\.(png|jpe?g|gif|webp|svg)$/i,
];

/**
 * Carve-outs from the docs/** allow-list:
 *   docs/process/** and docs/architecture/** require review — spec §4.1.
 */
const ALLOW_EXCEPT = [/^docs\/process\//i, /^docs\/architecture\//i];

/**
 * Hard-excludes — spec §4.1: code/CI/hooks, agent config, governance files, manifests.
 * A path matching any of these is NEVER swept.
 *
 * I4: also exclude source/config files that can appear under docs/ in a Docusaurus site
 * (e.g. docs/docusaurus.config.ts, docs/src/**, docs/static/**).  Only .md and .mdx
 * remain sweepable inside docs/.
 */
const EXCLUDE = [
  /^src\//i,
  /^scripts\//i,
  /^\.github\//i,
  /^\.githooks\//i,
  /^\.claude\//i,
  /^\.codex\//i,
  /^\.gemini\//i,
  /^\.agent\/schema\//i,
  /^(README|AGENTS|CLAUDE|GEMINI)\.md$/i,
  // package*.json at any depth — spec §4.1
  /(^|\/)package[^/]*\.json$/i,
  // I4: code/config extensions never swept regardless of directory (Docusaurus site in docs/)
  // Source: spec §4.1 I4 — .json supersedes the package*.json rule but keep both for clarity.
  /\.(js|jsx|ts|tsx|mjs|cjs|mts|cts|json)$/i,
  // I4: Docusaurus source tree and static assets inside docs/ — never sweepable
  /^docs\/src\//i,
  /^docs\/static\//i,
];

/**
 * Normalize a path from git output to repo-relative POSIX:
 * backslashes → forward slashes, strip leading "./".
 * Spec §4.1 D10: normalize before matching.
 */
export const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');

/**
 * Returns true iff relPath is a sweepable doc candidate per §4.1.
 * Matching is case-insensitive (NTFS); exclude wins any tie (D10 H2).
 */
export function isSweepable(relPath) {
  const p = norm(relPath);
  // Hard-exclude wins over everything — spec "exclude wins" rule.
  if (EXCLUDE.some((r) => r.test(p))) return false;
  // Carve-outs within the docs/** allow-list also exclude.
  if (ALLOW_EXCEPT.some((r) => r.test(p))) return false;
  return ALLOW.some((r) => r.test(p));
}

// ─── §4.3 Staleness constant ──────────────────────────────────────────────────

/**
 * 12-hour staleness threshold for the primary-default-branch lane.
 * Source: owner decision 2026-06-02 (spec §4.3).
 * Rationale: long enough that a live-but-slow session never trips it;
 * short enough to recover within a workday. Local-clock-relative.
 */
export const STALE_MS = 12 * 60 * 60 * 1000; // 43 200 000 ms

// ─── §4.3 Checkout-state-aware classifier (D8/D10) ───────────────────────────

/**
 * classify({ lane, mtimeMs, now, claimStatus }) → { verdict, reason }
 *
 * verdict ∈ 'eligible' | 'leave-log' | 'skip'
 *
 * lane:
 *   'primary-default' — primary checkout on default branch (F19 ⇒ no concurrent agent expected)
 *   'worktree'        — a linked worktree (feature branch); positive death signal required (D8)
 *   'detached'        — detached HEAD; never eligible (D10 C3)
 *
 * claimStatus: 'active' | 'expired' | 'absent'
 *   Ignored for primary-default and detached lanes; mtime is the gate on primary-default.
 *   On worktrees, mtime is NEVER the eligibility gate (D8 adversarial hardening).
 */
export function classify({ lane, mtimeMs, now, claimStatus = 'absent' }) {
  if (lane === 'detached') {
    // Detached HEAD → never eligible (spec §4.3 D10, adversarial C3).
    return { verdict: 'leave-log', reason: 'detached-head' };
  }

  if (lane === 'worktree') {
    // Worktrees require a POSITIVE death signal (D8).
    // mtime alone is necessary-not-sufficient; it never makes a worktree doc eligible.
    if (claimStatus === 'active') return { verdict: 'skip',      reason: 'active-claim' };
    if (claimStatus === 'expired') return { verdict: 'eligible', reason: 'expired-claim' };
    // absent / board-off → cannot prove dead → leave + log + surface
    return { verdict: 'leave-log', reason: 'no-positive-death-signal' };
  }

  // primary-default: 12h freshness gate only (F19 ⇒ no concurrent agent expected)
  if (now - mtimeMs < STALE_MS) return { verdict: 'leave-log', reason: 'fresh<12h' };
  return { verdict: 'eligible', reason: 'stale-on-default' };
}

// ─── §4.3 Claim coverage + status (D3b, fail-safe H3) ────────────────────────

/**
 * coveringClaimStatus(claims, { repo, worktree, relPath, now })
 *   → 'active' | 'expired' | 'absent'
 *
 * A claim covers a doc iff ALL of:
 *   - claim.repo   === repo
 *   - claim.worktree OR claim.branch === worktree  (either field accepted)
 *   - claim.paths glob covers relPath
 *   - for 'active': status === 'active' AND not past expiresAt
 *
 * Fail-safe (H3): if path-glob parsing throws for a claim that otherwise matches
 * repo+worktree+active, treat it as covering+active to block (err toward over-blocking).
 *
 * active (unexpired) dominates; expired/expiresAt-past yields 'expired'; none → 'absent'.
 */
export function coveringClaimStatus(claims, { repo, worktree, relPath, now }) {
  let best = 'absent';

  for (const c of claims ?? []) {
    // Filter: repo must match
    if (c.repo !== repo) continue;
    // Filter: branch or worktree field must match (spec D3b: "claim branch/worktree")
    if (c.worktree !== worktree && c.branch !== worktree) continue;

    // Path-glob coverage check — with fail-safe (H3)
    let covers;
    try {
      covers = pathCovers(c.paths ?? [], relPath);
    } catch {
      // Path-glob parse failure for a repo+worktree-matching active claim → fail safe: block.
      covers = c.status === 'active';
    }
    if (!covers) continue;

    // Determine whether the claim is expired
    const pastExpiry = c.expiresAt && Date.parse(c.expiresAt) <= now;
    const isActive = c.status === 'active' && !pastExpiry;

    if (isActive) return 'active'; // active dominates; short-circuit
    best = 'expired';
  }

  return best;
}

/**
 * Returns true if any entry in `paths` covers `relPath`.
 * Entries ending in '/' are treated as directory prefixes.
 * Entries containing glob metacharacters ('[', '*', '?', '{') are parsed as glob patterns
 * using a minimal glob-to-regex converter; invalid patterns cause a throw (H3 fail-safe).
 * Plain entries use exact-match or prefix-match.
 */
function pathCovers(paths, relPath) {
  return paths.some((pre) => {
    if (/[*?{[]/.test(pre)) {
      // Glob-like entry: convert to regex. Throws on invalid bracket expressions (H3).
      const re = globToRegex(pre);
      return re.test(relPath);
    }
    const prefix = pre.endsWith('/') ? pre : pre + '/';
    return relPath === pre || relPath.startsWith(prefix);
  });
}

/**
 * Minimal glob-to-regex converter.
 * Supports: '*' (any chars except '/'), '**' (any chars incl '/'), '?' (one char), '[…]' bracket.
 * Throws SyntaxError on an unclosed bracket expression — callers catch for H3 fail-safe.
 */
function globToRegex(glob) {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; } else { re += '[^/]*'; }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '[') {
      const close = glob.indexOf(']', i + 1);
      if (close === -1) throw new SyntaxError(`Unclosed bracket in glob: ${glob}`);
      re += glob.slice(i, close + 1);
      i = close;
    } else if (c === '{' || c === '}') {
      // Brace expansion ({a,b}) is unsupported. Throw rather than escape-to-literal:
      // escaping would silently match only the literal "{a,b}" (fail OPEN — a claim meant
      // to cover docs/a/** + docs/b/** would block nothing). Throwing lets the
      // coveringClaimStatus fail-safe (H3) over-block an active claim instead.
      // Source: spec §4.3 fail-safe + "brace-glob fail-closed" hardening follow-up.
      throw new SyntaxError(`Unsupported brace glob (fail-closed): ${glob}`);
    } else {
      re += c.replace(/[.+^${}()|\\]/g, '\\$&');
    }
  }
  re += '$';
  return new RegExp(re);
}
