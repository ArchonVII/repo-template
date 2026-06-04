# AGENTS.md

Cross-tool contract for AI agents (Claude, Codex, Copilot, Gemini, etc.) working in this repo.

> **Per-tool addenda** live in `CLAUDE.md`, `GEMINI.md` etc. when they exist. This file holds the rules every agent must follow.

## Read First

- `README.md` — what this project is and how to run it
- `ARCHITECTURE.md` — directory ownership and cross-boundary rules (add when the layout outgrows obviousness)

## Workflow

1. **Issue first.** Create a GitHub issue with explicit `Acceptance Criteria` before branching. Use the `Task` issue form.
2. **One issue → one branch (in a linked worktree) → one PR.** Branch name: `agent/<tool>/<issue>-<slug>` (e.g. `agent/claude/42-oauth-flow`); quick fixes without an issue use `agent/<tool>/<YYYY-MM-DD>-<slug>`. Create the branch with `git worktree add`, not `git switch -c` in the primary checkout — see "Checkout role / worktrees".
3. **Never commit to `main`.** Branch protection enforces this. Repo-facing docs, planning notes, prompts, ADRs, and shared markdown use the same branch/PR path when they are committed to the repo.
4. **Conventional Commits** for messages: `<type>(<scope>): <description>` where `<type>` is one of `feat fix refactor test docs style chore perf ci build revert`.
5. **PR metadata must pass the shared contract before ready-for-review.** Non-doc PRs must use this exact body order: `## Summary`, `## Verification`, `### Verification Notes`, `## Docs / Changelog`, and an issue link (`Closes #N`, `Fixes #N`, or `Refs #N`). The PR title must use Conventional Commits. Each checked verification box must be backed by concrete command/check/manual evidence, and placeholders such as TODO/TBD/N/A must be gone. Doc-only PRs (every file matches `*.md`, `*.txt`, an image extension, or `.changelog/**`) skip the body ceremony but still need a valid title and branch.
6. **Repo update log.** Every PR that changes code, config, behavior, protected docs, tracked workflows, or repository policy must append one entry to `docs/repo-update-log.md` before review. Include the date, issue/PR, branch, changed paths, verification, and whether follow-up propagation is needed. Doc-only typo fixes may skip the log only when the PR body says why.

## Checkout role / worktrees

This repo uses the **checkout-role** model, enforced by `.githooks/pre-commit`:

- The **primary checkout** stays on the default branch. It is the stable owner/admin
  lane and accepts only owner-maintenance commits (see below). It is **not** where
  feature work is committed.
- **Feature work happens in a linked worktree.** Create one per issue:

  ```
  git worktree add -b agent/<tool>/<issue>-<slug> ../<repo>-<issue>-<slug>
  ```

  Commit, push, and open the PR from that folder. After the PR merges, retire the
  worktree with **`npm run agent:prune`** (see below) — not bare `git worktree remove`.
- **Do not run `git switch -c` in the primary checkout.** A feature-branch commit
  there is blocked and redirected to `git worktree add`.
- Unsure where you are? Run `bash .githooks/scripts/checkout-doctor.sh`.

### Agent lifecycle commands

Repo-owned helpers (zero-dep, `node`):

- `npm run agent:start-task -- <issue> [--agent <name>] [--slug <slug>]` — fetch the
  default branch, create `agent/<tool>/<issue>-<slug>` in a sibling worktree, and write
  `.agent/current-task.json` (gitignored). Refuses if the checkout is dirty or off the
  default branch, or if the issue already has a branch.
- `npm run agent:status` — branch, default branch, upstream, PR, issue, dirty state,
  worktree path, claims (if installed), and the next recommended action.
- `npm run agent:prune` — **the way to retire finished worktrees.** Removes every merged +
  clean agent worktree/branch in one sweep; never touches dirty work, locked worktrees, or
  the primary/current checkout. Survives Windows `git worktree remove` failures: when a
  worktree still holds ignored build residue (`node_modules/`, `dist/`) or long paths, bare
  `git worktree remove` aborts with "Directory not empty" and strands a half-removed lane,
  whereas `agent:prune` finishes the delete and skips any single un-removable lane instead
  of aborting the batch. Idempotent.

Optional capabilities (claims #14, close-scan #28) are reported as "not installed" when absent.

## Owner Maintenance Lane

When the working tree contains only add-only safe maintenance files, agents must not invoke Issue-Admiral, Project-Captain, Project-Lieutenant, Release-Admiral, claim records, handoff blocks, or full CI. Either report `owner maintenance present, no action required` or, if explicitly asked to commit, commit directly on `main` with `docs(owner): ...` or `chore(owner): ...`.

Safe owner-maintenance paths are:

- `docs/research/**`
- `docs/notes/**`
- `docs/assets/**`
- image files (`png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`)
- `.changelog/**`

The lane is add-only. If any unsafe file is staged or any file is modified, deleted, renamed, or copied, stop and report. Unsafe paths include `README.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/**`, `.githooks/**`, `.claude/**`, `.agent/schema/**`, `package*.json`, `src/**`, `scripts/**`, `docs/process/**`, and `docs/architecture/**`.

## Anomaly triage

While working on a PR, you'll often notice off-task bugs, stale files, or tech debt that **don't belong in the current change** but shouldn't be lost. The convention: write a structured entry to `.archon/anomalies-thispr.md` on the PR branch. A reusable workflow (`anomaly-triage.yml` from [`ArchonVII/github-workflows`](https://github.com/ArchonVII/github-workflows)) reads that file on every PR event and routes each entry — related entries become sticky PR review comments, unrelated entries become new GitHub issues. Re-runs are idempotent (each entry carries a fingerprint).

### Entry format

```markdown
## <Short title — what's wrong>

- **Severity:** low | medium | high | critical
- **File:** path/to/file.ext (optional; helps the classifier)
- **Related to PR:** yes | no | unknown (optional; default unknown)
- **Downstream repo:** owner/repo (optional; only when the root cause lives in another repo)

<One or two paragraphs explaining what's wrong, what you observed, and any fix
hypothesis you have. Imagine a different agent or human picking this up cold.>
```

- **Title** uses `## ` so the workflow can split entries cleanly.
- **Severity** is your best read. `medium` is fine when unsure.
- **File** is one path; if multiple files are implicated, pick the most representative one.
- **Related to PR** — say `yes` if your in-flight change touches the same code, `no` if the issue is wholly elsewhere, `unknown` if you're not sure. The workflow infers from the PR diff when set to `unknown`.
- **Downstream repo** is only used when the anomaly's fix lives in a different repo (e.g. an upstream library you happen to call). The workflow will file the issue there if a `triage-token` secret is configured on this repo.

### Rules

- The file lives at `.archon/anomalies-thispr.md` on the PR branch. The `.archon/` directory should be in `.gitignore` **except** for this one file (use `!anomalies-thispr.md`).
- Append rather than overwrite — multiple entries are normal across a PR's commits.
- Don't summarize the anomaly in your PR description. The triage workflow does that automatically in its summary comment.
- If you notice something while working but realize it _is_ part of the PR's scope, fix it directly in the PR — don't write an anomaly entry for work you're about to do anyway.
- Removing an entry from the file before merge cancels its routing (no issue gets filed). Use this to retract on second thought.

### What the workflow does

- Parses each `## <title>` block.
- Classifies as related-to-PR (file in PR diff or `Related to PR: yes`) or unrelated.
- **Related** → posts a sticky PR review comment with the entry body. Re-runs update the same comment.
- **Unrelated** → opens a new GitHub issue in this repo (or `Downstream repo` if specified) with a back-link to this PR and the `auto-triaged` label.
- Posts a single summary comment on the PR listing everything filed.

Set this up by adding the caller workflow from [`github-workflows/examples/anomaly-triage.yml`](https://github.com/ArchonVII/github-workflows/blob/main/examples/anomaly-triage.yml) to `.github/workflows/`.

## Verification

Before marking a PR ready for review:

- Treat `repo-required-gate / decision` as the stable branch-protection check. Do not make path-filtered leaf workflows required.
- Use `.agent/check-map.yml` to record repo-specific path-to-check expectations. If the repo stack changes, update both `.agent/check-map.yml` and `.github/workflows/repo-required-gate.yml` in the same PR.
- Run the repo's lint, typecheck, and test commands. Record exact commands in `### Verification Notes`.
- If the change is user-visible, smoke-test it. Record what you exercised.
- Tick a `- [x]` box **only after** the command actually passed.
- Do **not** run `gh pr ready` directly. Run the blessed wrapper so malformed PRs cannot trigger paid or expensive ready-for-review checks:

  ```powershell
  npm run agent:close-preflight -- --repo OWNER/REPO --pr <number>
  npm run agent:pr-ready -- --repo OWNER/REPO --pr <number>
  ```

  If the npm wrapper scripts are missing, add the repo's portable wrapper
  setup first. Do not substitute direct `gh pr ready` or machine-local
  command paths.

## Local delivery guards

If this repo adds a local close-scan, pre-push, or CI-delivery guard, keep the
guard strict for pushes that would update the remote branch: verification and
any close-scan completion marker must bind to the exact final `HEAD` after the
last commit.

The guard should still allow true no-op finalization pushes, where local `HEAD`
already matches the upstream branch and no remote update or CI-triggering
delivery action would occur. This keeps Copilot/Codex automatic cleanup pushes
from failing after the branch is already synced, without creating a bypass for
real changes.

## Closeout

- Preparing a PR for review and shipping it are different states.
- Use `close:review` for verify -> push -> PR body -> ready-for-review handoff.
- Use `close:ship` only when the user explicitly says `/close`, `ship it`,
  `land it`, `merge to main`, or equivalent delivery language.
- If this repo adds a local close-scan guard, run it before `git push`,
  `npm run agent:pr-ready`, and `gh pr merge`.

## CHANGELOG

This repo uses **<Mode 1: direct edit / Mode 2: `.changelog/unreleased/` fragments>** — pick one and delete the other in initial setup.

- **Mode 1:** Edit `CHANGELOG.md` under `## [Unreleased]` on the PR branch.
- **Mode 2:** Add a file at `.changelog/unreleased/<issue>-<slug>.md`. See that directory's README.

For PRs that don't warrant a CHANGELOG entry (refactor, tests, chore), apply the `no-changelog` label.

## Commit hygiene

- One logical unit per commit. If the message needs "and," split into two commits.
- Stage specific files: `git add <path> <path>`. Never `git add -A` or `git add .` — that's how `.env` files get committed.
- Don't bypass hooks (`--no-verify`, `--no-gpg-sign`). If a hook fails, fix the underlying issue.

## Reference precision

In durable written artifacts — decision logs, ADRs, PR bodies, `docs/repo-update-log.md`, and verification notes — name git refs unambiguously. When a statement turns on the local-vs-remote distinction, write `origin/main` for the remote branch and "the local default branch" (or a specific local ref) for local state. Never write bare `main` when the local-vs-remote distinction is load-bearing: it reads as both and undermines the rule being recorded (e.g. "verify against `origin/main`").

This generalizes: when a workflow rule turns on a distinction — ref, environment, scope, or time — use the fully-qualified term in the artifact, not the shorthand.

## When stuck

If the same approach fails twice, stop. Switch tactics, ask the user, or document what you tried in the issue.

## Coordination

This repo is **coordination-isolated**. It coordinates only itself.

- Do not read from or write to machine-global coordination boards.
- Do not assume sibling repositories exist.
- Do not reference another repo unless this repo explicitly documents that dependency.

When coordination is needed, use this repo's local coordination area: `.agent/coordination/`
(see `.agent/coordination/README.md` for the convention). Active boards, claims, locks, or
handoffs belong there — or in another repo-local location this repo documents. The active
board template lives at `.agent/coordination/board.md` and is opt-in; delete it if this
repo does not do active multi-agent coordination.
