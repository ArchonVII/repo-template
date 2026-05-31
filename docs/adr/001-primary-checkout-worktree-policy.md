# 001. Primary checkout is the stable lane; feature work happens in linked worktrees

Date: 2026-05-30
Status: Accepted

## Context

The ecosystem baseline ships `.githooks/pre-commit` (feature "F18", `ArchonVII/repo-template#16`).
It blocks commits on `main`/`master` and, in its own error text, instructs the agent to run:

```
git switch -c <type>/<short-description>
```

That guidance is the *in-place feature-branch* model: it re-points **the current checkout**
onto a new branch. The owner's working model is the opposite — the **worktree** model: the
primary checkout stays on the default branch (a stable "desk"), and feature work happens in a
separate linked worktree folder (a disposable "bench").

This mismatch produced a real incident. In a not-yet-onboarded consumer repo (`jma-history`),
an agent that said it would "start on a branch/worktree" ran `git switch -c` in the primary
checkout, re-pointing the owner's primary working folder onto `feat/start-screen-ui` and
committing there. Nothing was lost, but the owner's primary folder was sitting on a feature
branch — exactly the state the worktree model is meant to prevent. The tooling steered the
agent into it: the hook's error message recommends the in-place move.

We want one enforced convention across every agent-driven repo (Claude / Codex / Gemini),
shipped the tool-agnostic way (see `pattern-tool-agnostic-capability`): an `AGENTS.md` contract
section plus a tracked git hook, distributed via `repo-template` → `archon-setup`. Not a
per-CLI skill, and not an untracked local `.git/hooks` script (which never survives a fresh
clone and so is the *least* global option available).

There is no reusable-workflow half for this capability: CI runs server-side and cannot observe
a clone's local worktree topology, so enforcement lives entirely in the hook + the contract.

## Decision

Adopt the **checkout-role** model and enforce it by **extending the existing
`.githooks/pre-commit`** — not by adding a parallel hook system.

- **Primary checkout** (where `git rev-parse --git-dir` == `git rev-parse --git-common-dir`)
  is the stable owner/admin lane. It accepts commits **only** on the default branch, and only
  through the existing owner-maintenance safe-path lane. A commit on any non-default branch in
  the primary checkout is **blocked** and redirected to `git worktree add`.
- **Linked worktrees** (where `--git-dir` != `--git-common-dir`) are where feature work
  happens; feature-branch commits there remain **allowed** (unchanged behavior).
- The **default branch is resolved dynamically**: prefer
  `git symbolic-ref --short refs/remotes/origin/HEAD` (stripping the `origin/` prefix); when
  that is unset (common in fresh clones), fall back to the existing `main`/`master` allowlist
  the current hooks already use. Not hardcoded to `main`.
- The existing pre-commit **error message is rewritten** to recommend
  `git worktree add ../<repo>-<issue>-<slug> -b <branch>` instead of `git switch -c`, so the
  hook and the `AGENTS.md` contract stop contradicting each other.
- `AGENTS.md` gains a **"Checkout role / worktrees"** contract section stating the invariant so
  every agent, regardless of vendor, reads it.
- `archon-setup` onboarding installs `core.hooksPath=.githooks` (via the existing
  `install-githooks.sh`) and ships the refreshed snapshot carrying the updated hook + contract.
- A small **`checkout-doctor.sh`** diagnostic prints the checkout role, current/default branch,
  hooks path, and whether feature commits are allowed here — a cheap orientation check before
  an agent or human acts.

### Rule matrix

"Primary" = the checkout where `--git-dir` equals `--git-common-dir`.

| Context | Commit? | Source of rule |
| --- | --- | --- |
| Primary, default branch, owner-maintenance safe paths | **allow** | existing owner lane |
| Primary, default branch, unsafe paths | **block** | existing F18 |
| Primary, **non-default branch** | **block → worktree** | **NEW (this ADR)** |
| Linked worktree, non-default branch | **allow** | normal feature flow |
| Linked worktree, default branch | **block** | existing F18 |

## Consequences

- The `jma-history` failure mode becomes **structurally impossible** on onboarded repos: an
  agent cannot commit feature work in the primary checkout; it must create a worktree first.
- The **owner-maintenance lane is preserved unchanged** — add-only safe-path commits on the
  default branch in the primary checkout still pass. The owner's low-friction docs/maintenance
  workflow is untouched (see `policy-owner-maintenance-lane`).
- The existing hook's rebase/merge/cherry-pick exemptions, detached-HEAD handling, and
  `ALLOW_MAIN_COMMIT` / `ALLOW_NO_ISSUE_REF` bypasses carry over untouched.
- **One intended behavior change:** anyone relying on in-place feature branches in the primary
  checkout must switch to worktrees. That is the point of the change, not a side effect.
- Distribution is the standard rollout (`playbook-ecosystem-capability-rollout`) **minus the
  workflow half and the `v1` tag move** (no reusable workflow changes): update `repo-template`
  → refresh `archon-setup` snapshots + add a registry feature → onboard repos through the
  wizard. `jma-history` is onboarded like any other repo, with no bespoke work.

## Implementation outline

1. **repo-template** (done in a linked worktree — dogfood the model):
   - Add `.githooks/scripts/checkout-role.sh`: resolves primary-vs-linked
     (`--git-dir` vs `--git-common-dir`) and the default branch, sharing the precedent set by
     `.githooks/scripts/owner-maintenance.sh`.
   - Extend `.githooks/pre-commit`: after the existing main-block, add the
     primary + non-default-branch block via the helper; rewrite the error text to recommend
     `git worktree add`. Comment the new block's authority as **this ADR (001)** — do **not**
     touch the pre-existing `docs/phase2/hook-authority.md` "Authority" comments; those are
     general hook-layer authority and are repointed by the catalog follow-up (see Decisions).
   - Add `.githooks/scripts/checkout-doctor.sh` and document its invocation
     (`bash .githooks/scripts/checkout-doctor.sh`; Node repos may add an `npm run` alias but it
     must not depend on npm).
   - Add the `AGENTS.md` "Checkout role / worktrees" section; remove any in-place `switch -c`
     guidance.
   - Extend `.githooks/scripts/test-owner-maintenance.sh` (or a sibling test script) to cover
     the new matrix rows: primary+feature blocked, linked+feature allowed, owner lane intact.
   - Add a `docs/repo-update-log.md` entry.
2. **archon-setup**:
   - `npm run refresh-snapshots`; confirm onboarding runs `install-githooks.sh`
     (sets `core.hooksPath`); add/confirm a registry feature in the `agent-workflow` group;
     re-run tests; open PR.
3. **jma-history**: restore its primary checkout to the default branch and move the in-flight
   `feat/start-screen-ui` work into a linked worktree, then onboard it through `archon-setup`
   exactly like every other repo. No customization.

## Decisions

- **Feature number.** This capability is **F19** ("Primary checkout worktree guard"). The
  capability catalog records and normalizes the ID later, but the ADR carries it now. The
  catalog itself is a **separate, lightweight follow-up foundation task**
  (`docs/capabilities/catalog.md`), explicitly **not a blocker** for this guard. That follow-up
  owns the **Option-B repoint** of the four dangling `docs/phase2` references (`hook-authority.md`
  in `commit-msg` / `pre-commit` / `install-githooks.sh`; `findings.md` in `README.md:30`) to the
  catalog. `docs/phase2/` never existed in this repo's git history — it is inherited scaffolding,
  so the references are repointed, not restored. Logged in `.claude/noticed.md`.
- **Linked worktree on the default branch.** Blocked by the existing F18 rule — no v1 warning
  downgrade: git refuses to check out the same branch in two worktrees, so the state is only
  reachable via `--detach`/`--force`, and a warning would weaken default-branch protection for a
  near-unreachable case.
- **Default-branch resolution when `origin/HEAD` is unset.** Falls back to the `main`/`master`
  allowlist the current hooks already use.

## Related

- `pattern-tool-agnostic-capability` — workflow/contract two-halves shape (here: contract-only).
- `playbook-ecosystem-capability-rollout` — merge sequence (here: no workflow PR / `v1` move).
- `policy-owner-maintenance-lane` — the lane this decision deliberately preserves.
- `reference-archonvii-repos` — the four sibling repos and the snapshot data flow.
