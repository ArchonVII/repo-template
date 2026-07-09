# Doc Sweep-Up — Standard & Design Spec

> **Status:** Design approved with amendments (2026-06-02); hardened after an adversarial
> discriminator pass (2026-06-03, see §3 D8–D10 and the Adversarial Findings appendix).
> Pilot in `archon`, then propagate via the standard 3-PR sequence.
> **Owner decision date:** 2026-06-02 (brainstorming); 2026-06-03 (adversarial amendments).
> **Canonical home:** `repo-template/docs/agent-process/doc-sweep.md` (this is the `archon`
> pilot copy). The short contract lives in `AGENTS.md`; this is the full spec.

---

## 1. Problem

Docs that agents produce as **side artifacts** (roadmaps, handoffs, research notes,
changelog fragments, `.html-artifacts`) are valuable but routinely stranded uncommitted:

1. **No flush-on-exit.** Selective-staging + "one logical unit per commit" means a doc that
   isn't part of the feature's logical change never gets staged. Sessions die (power outage,
   `/clear`, crash) before a deliberate doc commit.
2. **No abandoned-vs-live discriminator.** The next agent sees the dirty file and — correctly,
   under the "Concurrent Agents" rule — refuses to touch it, because it cannot tell an
   abandoned doc from a live sibling's in-progress work. Orphans accumulate forever.

**Live proof (2026-06-02):** `archon`'s primary `main` checkout carried two untracked roadmap
docs (that repo's *docs/archon/ROADMAP.md* and *docs/archon/window-interaction-roadmap.md*)
plus a modified `README.md`, none committed.

## 2. Understanding Summary

- **What:** an ecosystem capability that **prevents** stranded docs (flush-on-close) and
  **recovers** docs that dead/outage-killed sessions left behind (sweep-on-open + dual
  backstop), auto-committing the _provably-safe_ ones and surfacing the rest.
- **Who:** every agent (Claude / Codex / Gemini), via an `AGENTS.md` contract that points
  agents at a runner + this spec + an archon-setup registry feature + a github-workflows
  backstop. **Agents run it; the user runs no commands** — so the contract wiring is what makes
  the capability real, not the script alone.
- **Constraints:** must not break the concurrent-agents safety rule. Add-only; conservative
  allow-list; ambiguity → leave + log; **deterministic** secret scan before commit; commits
  ride the owner-maintenance lane — no PR/issue ceremony.
- **Non-goals:** sweeping code/CI/hooks/`.claude/`/README/AGENTS/CLAUDE/`package*.json`;
  touching modified tracked files; auto-committing gitignored files; auto-pushing recovery
  branches; deleting or relocating anything.

## 3. Decision Log

| #       | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Rejected alternatives                                                                                                                                                                                                                                                                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1      | Two-halves + local: `AGENTS.md` short contract → runner + this full spec + archon-setup registry + github-workflows backstop.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Personal `~/.claude/CLAUDE.md` tweak (tool-specific); full contract inline in `AGENTS.md`.                                                                                                                                                                                                      |
| D2      | All three triggers: flush-on-close, sweep-on-open, **dual** backstop.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Any single trigger.                                                                                                                                                                                                                                                                             |
| D3      | Layered discriminator, no new infra; 12h freshness applies to the primary default branch too.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Instant-eligible on default branch; heartbeat infra now.                                                                                                                                                                                                                                        |
| D3b     | Claim liveness = repo + branch/worktree + path coverage + `status: active` + not past `expiresAt`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | "A claim file exists"; parallel liveness model.                                                                                                                                                                                                                                                 |
| D4      | Conservative allow-list, **add-only**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Modified-tracked files; broad extension match.                                                                                                                                                                                                                                                  |
| D5      | Auto-commit _provably-safe_, surface rest; commit destination tiered by PR state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Always-confirm; auto-commit-all.                                                                                                                                                                                                                                                                |
| D6      | Enumeration NUL-safe.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Raw `git status --porcelain` parsing.                                                                                                                                                                                                                                                           |
| D7      | gh-cron detector scans `origin/main...branch` diffs, not just HEAD.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | "Newest commit touches docs."                                                                                                                                                                                                                                                                   |
| **D8**  | **Worktree recovery requires a POSITIVE death signal (Option A, 2026-06-03).** mtime alone is necessary-not-sufficient on a worktree. A worktree doc is eligible only when a \*covering claim is **expired\***; claim **active** → skip (live); claim **absent / board off** → leave + log + surface. Only the **primary-default-branch lane** auto-commits on staleness alone (F19 ⇒ no concurrent agent expected there).                                                                                                                                                                                                                                                                                                                 | mtime-only worktree recovery (adversarial pass: clobbers a blocked-but-live >12h agent, or one whose mtimes were reset by checkout/backup/clock-skew). Heartbeat-in-v1 (bigger build; deferred to §9 as the _second_ positive signal).                                                          |
| **D9**  | **Enumeration unions disjoint git views (2026-06-03):** untracked (`ls-files --others`) **+** staged-but-uncommitted adds (`diff --cached --diff-filter=A`); a separate ignored-but-present pass over allow-list roots routes to **surface-only** (never auto-commit a gitignored file). Skip collapsed `dir/` entries (nested repos), symlinks/junctions. Stage **file-by-file** with per-file error isolation.                                                                                                                                                                                                                                                                                                                           | Single enumerator (drops the author's `git add` "save my work" signal — adversarial C1, verified); directory-level staging (one nested repo aborts the batch — H4).                                                                                                                             |
| **D10** | **Robust checkout-state detection + TOCTOU close (2026-06-03):** classify on `git symbolic-ref -q HEAD` (3 states: primary-default / primary-non-default-or-detached / worktree). Detached HEAD → never eligible. Primary-but-not-default (F19 guard broken) → treat as worktree (positive signal required) or abort+log. Capture mtime+size at classify; **re-stat immediately before `git add`**; any change → abort that doc → leave + log; stage from the captured state. Case-**insensitive** allow/exclude matching (NTFS); exclude wins ties. Per-repo **sweep lock** (the sweep files its own `doc-sweep` claim) held across classify+commit. Deterministic secret scanner (e.g. gitleaks) as a hard gate in addition to the read. | `abbrev-ref HEAD` (returns `HEAD` when detached — adversarial C3, verified); classify-then-commit with no re-stat (TOCTOU C4); lowercase-only matching (NTFS case bypass H2); no mutual exclusion (concurrent sweepers double-commit H5); "the agent reads it" as the only secret control (M2). |

## 4. Specification

### 4.1 Scope — sweepable docs

**Allow-list (candidate roots; sweep only NEW add-only docs matching):**

- `docs/**` — **except** `docs/process/**` and `docs/architecture/**` (review-required)
- `.changelog/**`
- `.html-artifacts/**`
- image assets: `**/*.{png,jpg,jpeg,gif,webp,svg}`

**Hard-exclude (NEVER swept — leave + log):**

- code, CI, hooks: `src/**`, `scripts/**`, `.github/**`, `.githooks/**`
- agent/tool config: `.claude/**`, `.codex/**`, `.gemini/**`, `.agent/schema/**`
- governance: `README.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`
- manifests: `package*.json` (any depth)
- **anything modified** (tracked-file changes are not add-only)

**Matching rules (D10):** normalize every path from **git output** (not the filesystem) to
repo-relative POSIX (forward slashes, decode `core.quotePath` quoting). Match
**case-insensitively**; when both allow and exclude match, **exclude wins**.

### 4.2 Enumeration (NUL-safe, unioned — D6 / D9)

Add-only candidates = the **union** of two disjoint git views, both NUL-delimited:

```bash
# (a) untracked, gitignore-respecting
git -C <wt> ls-files --others --exclude-standard -z
# (b) staged-but-uncommitted ADDs (the author's "git add = save my work" signal — C1)
git -C <wt> diff --cached --name-only --diff-filter=A -z
```

> The two views are **disjoint, not interchangeable.** `ls-files --others` does NOT show a
> staged file; `diff --cached` shows only staged. Both are required.

**Ignored-but-present pass (surface only — C2):** allow-listed roots (esp. `.html-artifacts/`)
are commonly gitignored. Separately enumerate them and route to **leave + log + surface**,
never auto-commit (committing a gitignored file is itself a policy violation):

```bash
git -C <wt> ls-files --others --ignored --exclude-standard -z -- docs .changelog .html-artifacts
```

**Per-candidate filtering before classify:**

- Skip any entry ending in `/` (collapsed untracked directory / nested repo) → leave + log.
- Skip symlinks/junctions (`lstat`; never follow) → leave + log.
- Apply §4.1 allow-list / hard-exclude (case-insensitive).

### 4.3 Liveness discriminator (D3 / D8 / D10)

**Step 1 — checkout state** (per working tree), via `git symbolic-ref -q HEAD`:

```text
symbolic-ref -q HEAD succeeds, ref == default branch, AND this is the PRIMARY checkout
                                              → lane = primary-default
symbolic-ref -q HEAD succeeds, ref != default (a feature branch)
                                              → lane = worktree
symbolic-ref -q HEAD fails (DETACHED HEAD)    → never eligible → leave + log
PRIMARY checkout NOT on default branch (F19 guard broken)
                                              → treat as worktree (positive signal required),
                                                or abort + log repo as "guard-violation"
```

**Step 2 — eligibility:**

```text
lane = primary-default:
  if mtime < 12h        → leave + log (possibly-live)
  else                  → eligible          # F19 ⇒ no concurrent agent expected here

lane = worktree:                            # D8 — positive death signal REQUIRED
  covering claim status == active (unexpired)  → skip (live)
  covering claim status == expired             → eligible   # the lane wasn't renewed
  no covering claim / board off                → leave + log + surface  # cannot prove dead
  (mtime is necessary-not-sufficient here; it never makes a worktree doc eligible alone)
```

All "eligible" results still pass the §4.4 review gate and the §4.5 TOCTOU re-stat before commit.

**12h staleness threshold** — _source: owner decision 2026-06-02. Rationale: long enough that
a live-but-slow session never trips it; short enough to recover within a workday._ Single
named constant. It is **local-clock-relative**; never compare an mtime written by another host.

**Claim coverage (D3b, fail-safe — adversarial H3):** a claim covers a doc iff ALL of: claim
repo == repo; claim branch/worktree == the doc's worktree; claim path-glob (same normalizer as
§4.1) includes the doc; and (for the "active" verdict) `status: active` and not past
`expiresAt`. **On any ambiguity** — path-glob parse failure, or a claim that matches
repo+branch+`active` but is unclear on path — **fail safe: treat as covering (live) → skip.**
Claims err toward over-blocking. Align with the `.agent/coordination/claims/` lifecycle
(`active | released | expired | merged`, `expiresAt`); do not invent a parallel model.

**Task claim (#124 S2 coordination bookend):** a lane's `.agent/current-task.json`
(written by `agent:start-task`) is synthesized into a whole-worktree claim on the
task's branch — no separate claim file needed. `expiresAt` derives from
`lastActivityAt` (refreshed by every `close:dod` capture) or `createdAt` plus a 24h
TTL (`TASK_CLAIM_TTL_MS`). Live → skip (the lane's in-flight docs are never recovered
out from under it); past TTL → the claim reads as **expired**, which is exactly the
positive death signal D8 requires to make an abandoned lane's docs eligible.

### 4.4 Review gate (D5 / D10)

Before committing any eligible doc, ALL must pass (any failure → leave + log):

1. **Coherence read.** Reject stubs/templates/placeholders/empty files.
2. **Deterministic secret/PII scan** (e.g. `gitleaks`/`trufflehog`/`detect-secrets`) as a
   **hard gate**, in addition to the read. Any hit → leave + log, never commit. The LLM read
   supplements the scanner; it does not replace it.
3. **Re-confirm** add-only + allow-list + not hard-excluded + not a symlink/dir.

This gate applies to **flush-on-close too** (M4): "I authored it" waives the liveness check,
not the secret scan.

### 4.5 Commit rules (D5 / D10 / amendment 4)

- **Sweep lock first (H5):** acquire a per-repo lock (the sweep files its own
  `.agent/coordination/` claim with a reserved `doc-sweep` actor) and hold it across
  classify+commit. If the lock is held → **skip, don't queue.**
- **TOCTOU re-stat (C4):** capture (mtime, size) at classify; immediately before `git add`,
  re-stat — if changed, **abort that doc → leave + log.** Stage from the captured state.
- **Selective, file-by-file staging (H4):** `git add -- <one path>` per file with per-file
  error isolation (one failure → leave + log that file, continue). **Never** `git add -A`/`.`.
- **Destination, tiered by PR state (H1 — no invisible local-only durability):**

```text
- worktree branch WITH an open PR   → commit to that branch
- primary checkout / default branch → owner-maintenance path: gated by an explicit
                                       owner/actor check (L2), selective staging, clean
                                       pre/post `git status`, respect hooks/signing
- stale worktree branch, NO open PR → do NOT create a local-only commit on a branch no PR
                                       tracks (that re-strands it — H1). v1: leave + log to a
                                       DISCOVERABLE, pushed location (the tracking issue / a
                                       pushed recovery manifest). Auto-push of recovery
                                       branches is out of scope for v1.
```

- **Convention:** `docs(sweep): recover orphaned docs from prior session`, file list in body.
- **Attribution:** actor's git identity (no per-doc author known; no `--author` spoofing).
- **Hooks/signing (L1):** never `--no-verify` / bypass signing. On hook rejection → leave + log.

### 4.6 Triggers (D2)

- **sweep-on-open** — at session start (`/open`, `/session`), the agent runs §4.2–§4.5 for the
  current repo. The `AGENTS.md` contract is what makes the agent do this.
- **flush-on-close** — at `/close` and `/bookmark`, the agent applies §4.1 + the §4.4 secret
  scan to **its own** uncommitted docs and commits them (`docs(...)`, not `docs(sweep):`).

### 4.7 Backstops (D2 / D7)

**gh-cron detector** (`github-workflows/doc-orphan-detector.yml@v1`) — detection only, never
commits; **paths only, never contents**:

```text
For every branch with no open PR:
  diff origin/main...branch
  if the diff contains allow-list docs
  AND the latest commit touching those paths is older than 12h
  → open/update a tracking issue listing the paths
```

> A gh-cron sees only **pushed** commits — committed-but-orphaned docs on stale branches. It
> cannot see uncommitted working-tree files.

**Template caller wired:** `repo-template/.github/workflows/doc-orphan-detector.yml` invokes
`ArchonVII/github-workflows/.github/workflows/doc-orphan-detector.yml@v1` on the weekly
`0 7 * * 1` cadence described above, with manual `workflow_dispatch` available for owner
smokes.

**Local backstop** — a scheduled local agent (`/schedule` + Cron) or SessionStart hook runs the
sweep-on-open algorithm across ecosystem repos periodically. Tool-specific (operator config);
the tool-agnostic contract keeps the behavior portable.

### 4.8 Runner interface & implemented hardening (2026-06-04)

The `scripts/doc-sweep/` runner implements §4.1–§4.5. CLI:

```text
node scripts/doc-sweep/sweep.mjs --repo <path> [--apply] [--owner]
    [--allow-main-commit] [--issue <n>] [--json]
```

- `--apply` — acquire the lock and commit eligible docs (default: read-only report).
- `--owner` — owner gate (§4.5 L2): authorizes commits on the **primary-default** lane.
  Without it, primary-default eligibles route to leave + log (`reason: owner-gate`).
- `--allow-main-commit` — pass the repo's audited `ALLOW_MAIN_COMMIT=1` override on the
  primary-default lane, for sweepable docs outside a repo's narrow owner-maintenance-safe
  set. Hooks still run; the override is logged to `.agent/bypass.log`. Never `--no-verify`.
- `--issue <n>` — issue ref for the commit message; on a worktree branch it is otherwise
  derived from the `agent/<tool>/<issue>-<slug>` branch name.

The four pre-`--apply` follow-ups, folded in on 2026-06-04:

- **Owner gate + destination tiering (§4.5 L2/H1).** primary-default → owner-gated
  owner-maintenance commit; worktree → commit only with an open PR (else `no-open-pr`);
  any hook rejection → unstage + `hook-rejected` (never `--no-verify`).
- **Lane-aware commit message.** primary-default with no issue ref → `docs(owner): …`
  (the commit-msg issue-ref **exemption**, no fabricated number); otherwise
  `docs(sweep): … (#N)`. Replaces the pilot's hardcoded `(#92)`.
- **Stale-lock TTL.** the lock records `{ts,pid,host}`; a lock older than `LOCK_TTL_MS`
  (15 min — owner decision 2026-06-04) is reclaimed, fixing the original no-expiry deadlock
  where a crashed sweep stranded the O_EXCL lock forever.
- **Brace-glob fail-closed.** an unsupported `{a,b}` claim glob now throws, so the §4.3
  fail-safe (H3) over-blocks an active claim, instead of silently failing **open** by
  matching only the literal `{a,b}` string.

## 5. Where it lives (D1)

| Half                         | Location                                                           | Content                              |
| ---------------------------- | ------------------------------------------------------------------ | ------------------------------------ |
| Contract (every agent reads) | `repo-template/AGENTS.md` → `## Doc Sweep-Up`                      | pointer block → runner + spec (§5.1) |
| Full spec                    | `repo-template/docs/agent-process/doc-sweep.md`                    | this document                        |
| Runner                       | `scripts/doc-sweep/` (Node, depless `node --test`)                 | §4 algorithm                         |
| gh-cron backstop             | `github-workflows/doc-orphan-detector.yml` (`@v1`)                 | §4.7 detector                        |
| Registry feature             | `archon-setup` → `agent-workflow.doc-sweep` (locked) + cron opt-in | exposes it                           |
| Local backstop               | operator's local config (NOT in the ecosystem PRs)                 | scheduled agent / hook               |

### 5.1 `AGENTS.md` short contract block

```markdown
## Doc Sweep-Up

Run `node scripts/doc-sweep/sweep.mjs --repo <repo>` at session boundaries. Full spec: `docs/agent-process/doc-sweep.md`.

- Sweep only add-only allowed docs/assets; never sweep code, CI, hooks, `.claude/`, `AGENTS.md`, `CLAUDE.md`, `README.md`, manifests, or package files.
- Auto-commit only provably stranded docs. Ambiguity means leave and log.
- The sweep locks, stages selectively, scans secrets, and never pushes recovery branches.
```

## 6. Rollout (pilot → propagate)

1. **Pilot in `archon`:** land this spec + the short `AGENTS.md` contract + the runner;
   validate against the §7 fixture.
2. **Propagate** via the standard sequence (`playbook-ecosystem-capability-rollout`):
   `github-workflows` detector PR → force-move `v1` → `repo-template` PR (contract + spec) →
   refresh `archon-setup` snapshots → merge → pull main everywhere, delete agent branches.

## 7. Pilot acceptance fixture

The classifier must produce these verdicts. Build as deterministic `node --test` fixtures
(pin mtimes/claims; assert with `\r?\n` for CRLF tolerance):

```text
# Primary default-branch lane (the live archon orphans)
docs/archon/ROADMAP.md                 mtime 13h  → eligible (commit)
docs/archon/window-interaction-roadmap.md  mtime 13h  → eligible (commit)
README.md                              modified   → not enumerated (not add-only) → leave
.claude/noticed.md                     untracked  → hard-excluded → leave
.claude/settings.local.json            untracked  → hard-excluded → leave

# Discriminator edge cases (adversarial fixtures)
docs/a.md          primary-default  mtime 11h59m   → leave (fresh)
docs/b.md          primary-default  mtime 12h01m   → eligible
docs/staged.md     staged-not-committed            → enumerated (C1) → classify normally
docs/Process/x.md  mixed-case excluded             → leave (exclude wins, case-insensitive)
.html-artifacts/r.html  gitignored                 → surface-only, never commit (C2)
docs/notes.md → <external>  symlink                → leave (skip symlink)
docs/w.md          worktree, claim ACTIVE          → skip (live)
docs/w.md          worktree, claim EXPIRED         → eligible
docs/w.md          worktree, NO claim              → leave + log (cannot prove dead)
docs/w.md          worktree, detached HEAD         → leave + log
docs/race.md       eligible, touched after classify → abort → leave (TOCTOU re-stat)
```

## 8. Failure modes & fail-safes

- **Idempotent:** committed docs aren't re-enumerated; the sweep lock prevents concurrent
  double-commits.
- **Fail-safe default:** any error, parse ambiguity, classification doubt, claim ambiguity,
  detached HEAD, symlink, nested repo, or TOCTOU change → abort _that doc_ and log; never
  destructive.
- **No clobber:** add-only; worktree auto-commit requires a positive death signal; TOCTOU
  re-stat closes the resurrection window.
- **No invisible durability:** never a local-only commit on an untracked branch; surface to a
  pushed, discoverable location.
- **No silent caps:** any bounded/skipped work is logged.

## 9. Future hardening (out of scope for v1)

The gh-cron detector is wired for this template in
`.github/workflows/doc-orphan-detector.yml`; the remaining items below are still future
hardening.

- **Session heartbeat** (`.agent/coordination/heartbeat/<session>.json`) — the _second_
  positive worktree-liveness signal (a dead heartbeat marks abandonment without an expired
  claim). Until adopted across all agent tools, worktree auto-recovery needs an **expired
  claim** (D8). This is the path to broadening worktree coverage safely.
- Auto-pushed recovery refs for stale-branch-no-PR orphans, if a discoverable scheme is agreed.

---

## Appendix — Adversarial Findings (2026-06-03)

A pre-build adversarial review (most-capable model) stress-tested §4.2/§4.3/§4.5 against live
git. Folded in: **C1** staged-but-uncommitted invisible + disjoint enumerators (→ D9);
**C2** gitignored allow-listed docs invisible (→ D9 surface pass); **C3** detached-HEAD/broken-
guard misrouting (→ D10 `symbolic-ref -q`); **C4** classify→commit TOCTOU (→ D10 re-stat);
**H1** "commit local, don't push" re-strands (→ §4.5 discoverable pushed log); **H2** NTFS
case bypass (→ §4.1 case-insensitive); **H3** claim glob fail-open (→ §4.3 fail-safe); **H4**
nested-repo aborts batch (→ D9 file-by-file); **H5** concurrent sweepers (→ §4.5 lock);
**M2** secret scan hand-waving (→ §4.4 deterministic scanner); **M3** symlink escape (→ §4.2
skip). **Verdict adopted:** 12h-mtime is NOT sound as the primary worktree-liveness signal →
Option A (D8): positive death signal required on worktrees; mtime-alone gates only the
primary-default lane.
