# AGENTS.md

Cross-tool contract for AI agents (Claude, Codex, Copilot, Gemini, etc.) working in this
repo. Per-tool addenda such as `CLAUDE.md` and `GEMINI.md` are adapters only; rules that
apply to every tool live here.

## Read First

- `README.md` - what this project is and how to run it.
- `docs/CANON.md` - current truth, intended state, and locked decisions.
- `docs/LIBRARIAN.md` - wiki schema and operations.
- `docs/INDEX.md` - map of durable docs.
- `ARCHITECTURE.md` - subsystem ownership when the repo has one.

<!-- BEGIN MANAGED AGENT START MAP -->

## Agent Start Map

Agents should not spend time rediscovering process files. Start here:

- Document policy: `docs/agent-process/document-policy.md` - charters, lifecycle, placement rules.
- Projects: `projects/<slug>/PLAN.md` - one capsule per active feature; see `docs/agent-process/project-capsules.md`.
- Plans: `docs/plans/` - loose/cross-cutting plans; prefer a project capsule for feature work.
- Agent process: `docs/agent-process/`.
- Repo update log: `docs/repo-update-log/` - one fragment per PR; `docs/repo-update-log.md` is the frozen archive.
- Check map: `.agent/check-map.yml`.
- Coordination: `.agent/coordination/README.md`.
- PR process: `.github/PULL_REQUEST_TEMPLATE.md`.
- Agent scripts: `scripts/agent/`.
- Close guards: `scripts/close/`.
- Doc sweep: `scripts/doc-sweep/`.
- Doc health: `scripts/doc-health/`.
- Legacy plans: `docs/superpowers/plans/` is history only; do not add new implementation plans there.
- Friction ledger: for a non-bug workflow hiccup, append one row to `.claude/friction.md`, do not fix it mid-task, and keep working; bugs/security or off-task defects still go to `.archon/anomalies-thispr.md`.

If these files are missing or unclear, stop searching and run:

```text
node <path-to-archon-setup>/bin/onboard.mjs <repo> --audit
```

<!-- END MANAGED AGENT START MAP -->

## Workflow

1. **Issue first.** Create or use a GitHub issue with explicit acceptance criteria before
   branching. Use the Task issue form.
2. **One issue -> one active branch -> one linked worktree -> one PR per phase.** Branch
   name: `agent/<tool>/<issue>-<slug>`. Follow-up phases for the same issue start from
   fresh `origin/main` in a new phase-specific branch/worktree.
3. **Never commit feature work to `main`.** Repo-facing docs, plans, prompts, ADRs, and
   shared markdown use the same branch/PR path when committed.
4. **Retired branches stay retired.** Before reusing an issue branch, run
   `gh pr list --head <branch> --state all --json number,state,url,mergedAt`; merged or
   closed PR state means start a new branch/worktree.
5. **Conventional commits.** Use `<type>(<scope>): <description>` with
   `feat fix refactor test docs style chore perf ci build revert`.
6. **PR bodies use the committed template.** If `.github/PULL_REQUEST_TEMPLATE.md` exists,
   fill it through `npm run agent:pr-body -- <issue>` or the committed file; do not
   freehand or leave scratch PR-body files in the worktree.
7. **Repo update log required.** Code, config, behavior, protected docs, workflows, and
   repository-policy PRs add one fragment at
   `docs/repo-update-log/<YYYY-MM-DD>-<issue>-<slug>.md`.
8. **Plan/status closeout required.** Any plan, progress file, handoff, audit, roadmap,
   status tracker, or coordination note created or used by the lane must be closed,
   narrowed, or marked superseded before review.

## Vision Drift Duties

- At plan time, read `VISION.md` when present and treat Scope / explicitly-not as owner intent.
- If requested work conflicts with it, surface the conflict and cite the relevant `docs/decisions/decision-log.md` entry before proceeding.
- At closeout, append owner scope decisions made during the lane to `docs/decisions/decision-log.md`; record none in the PR when none were made.
- Keep detail in `docs/agent-process/document-policy.md`; do not turn `VISION.md` into implementation notes or status logs.

## Checkout Role / Worktrees

The primary checkout stays on the default branch. Feature work happens in linked worktrees:

```text
git worktree add -b agent/<tool>/<issue>-<slug> ../<repo>-<issue>-<slug>
```

Prefer repo helpers:

- `npm run agent:start-task -- <issue> [--agent <name>] [--slug <slug>]` - fetch default,
  create the worktree, and record current task state.
- `npm run agent:status` - branch, upstream, PR, issue, dirty state, claims, and next action.
- `npm run agent:prune` - retire merged and clean agent worktrees using GitHub PR evidence.
- `npm run agent:pr-body -- [issue]` - print the committed PR template with issue filled.

Do not run `git switch -c` in the primary checkout. If unsure where you are, run
`bash .githooks/scripts/checkout-doctor.sh`.

## Verification And Delivery

- Treat `repo-required-gate / decision` as the stable branch-protection check. Do not make
  path-filtered leaf workflows required.
- Use `.agent/check-map.yml` for path-to-check expectations. If the repo stack changes,
  update the check map and `repo-required-gate` caller in the same PR.
- Run the repo's lint, typecheck, and test commands before review. Record exact commands and
  results in PR verification notes.
- Tick a verification checkbox only after the backing command or manual check actually
  passed, or after marking it explicitly not relevant in the template.
- If user-visible behavior changed, smoke-test it and record what was exercised.
- Do not run `gh pr ready` directly. Use:

```powershell
npm run agent:close-preflight -- --repo OWNER/REPO --pr <number>
npm run agent:pr-ready -- --repo OWNER/REPO --pr <number>
```

### Local Delivery Guards

When a push updates the remote branch, run close-scan after final verification and before
the push so the marker binds to the exact `HEAD`:

```powershell
npm run close:scan:complete -- --repo OWNER/REPO --pr <number> --changelog-decision "<fragment-or-no-changelog>" --findings-decision "<decision>"
git push
npm run close:ci:guard -- --repo OWNER/REPO --pr <number>
```

`close:ci:guard` must pass before `agent:close-preflight`, `agent:pr-ready`, or merge
actions. Missing, pending, or unavailable required CI is not a pass.

### Closeout Modes

- Preparing for review and shipping are different states.
- Use `close:review` for verify -> push -> PR body -> ready-for-review handoff.
- Use `close:ship` only when the user says `/close`, `ship it`, `land it`, `merge to main`,
  or equivalent delivery language.
- For stacked docs PRs, review `origin/main..HEAD`, not only the narrow PR diff; guidance only, not a gate.
- Do not push directly to `main`, merge locally, or bypass review/check gates.

## Owner Maintenance Lane

If the working tree contains only add-only safe maintenance files, agents may use the
repo-defined owner-maintenance path instead of full issue/PR ceremony. Safe paths:

- `docs/**`
- image files (`png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`)
- `.changelog/**`

The lane is add-only. Stop if any unsafe file is staged or if any non-ledger file is
modified, deleted, renamed, or copied. Unsafe paths include `README.md`, `AGENTS.md`,
`CLAUDE.md`, `GEMINI.md`, `.github/**`, `.githooks/**`, `.claude/**` except named ledgers,
`.agent/schema/**`, `package*.json`, `src/**`, `scripts/**`, `docs/process/**`, and
`docs/architecture/**`.

Append-log ledgers may be added or modified directly on `main` when every staged path is one
of these files:

- `.claude/noticed.md` - per-repo observation log.
- `.claude/napkin.md` - curated runbook.
- `.claude/friction.md` - structured friction ledger.
- `docs/decisions/decision-log.md` - owner intent decision log.

Renames, copies, and deletes of a ledger still require the normal branch/PR lane.

## Coordination

This repo is coordination-isolated. Do not read from or write to machine-global boards, and
do not assume sibling repos exist. Use only `.agent/coordination/` for claims, locks,
handoffs, or active boards. If claim acquisition fails, stop and report the conflict.

## Anomaly And Friction Ledgers

- Off-task bugs, stale files, security concerns, or tech debt found during a PR go in
  `.archon/anomalies-thispr.md` on the PR branch. The installed
  `.github/workflows/anomaly-triage.yml` routes related entries to PR review comments and
  unrelated entries to issues.
- Use one `## <short title>` block per anomaly with severity, representative file when
  useful, related-to-PR status, and downstream repo only when the fix lives elsewhere.
- Non-bug workflow friction goes in `.claude/friction.md`; record the cost and keep moving.

## Librarian Wiki

The `docs/` tree is an agent-maintained wiki. `AGENTS.md`, `llms.txt`, `docs/CANON.md`,
`docs/LIBRARIAN.md`, and `docs/INDEX.md` are the canonical navigation layer. Anything under
`.claude/`, `.codex/`, `.gemini/`, plus `CLAUDE.md` and `GEMINI.md`, is an adapter only.

- Before wiki maintenance, read `docs/LIBRARIAN.md` and `docs/CANON.md`.
- `docs/raw/` is immutable intake; `docs/` holds durable pages; `docs/memory/` is a
  machine-local junction; corrections go in `docs/audits/`.
- Run wiki operations through `npm run wiki:start`, `wiki:ingest`, `wiki:query`,
  `wiki:lint`, `wiki:crystallize`, `wiki:compact-save`, and `wiki:doctor`.
- When `docs/CANON.md`, `docs/project-status.md`, or release/deploy-status facts change,
  resync both `llms.txt` and relevant `README.md` status/overview prose in the same PR.

## Project Capsules

Active feature work that spans more than one session or one PR lives in
`projects/<slug>/PLAN.md`. The PLAN owns summary and pointers only; it links out to specs,
ADRs, research, issues, and PRs. One-off fixes do not need a capsule. Full convention:
`docs/agent-process/project-capsules.md`.

## Doc Sweep-Up

Agents recover and preserve docs across sessions. Run `scripts/doc-sweep/` at session
boundaries; full spec: `docs/agent-process/doc-sweep.md`.

- **sweep-on-open:** run `node scripts/doc-sweep/sweep.mjs --repo <repo>` to surface
  add-only docs stranded by prior/dead sessions; commit only provably-safe ones with
  `--apply`, and leave+log the rest.
- **flush-on-close:** before ending a session, commit your own pending add-only docs after
  the secret scan so they are never stranded.
- **Allow-list only:** new add-only docs under `docs/**` except `docs/process/**` and
  `docs/architecture/**`, `.changelog/**`, `.html-artifacts/**`, and image assets. Never
  sweep code, CI, hooks, `.claude/`, `AGENTS.md`, `CLAUDE.md`, `README.md`, or manifests.
- **Liveness:** auto-commit only default-branch docs stale over 12 hours or worktree docs
  whose coordination claim is expired. Active claim means live; ambiguity means leave+log.
- **Safety:** the sweep takes a lock, stages files selectively, runs a deterministic secret
  scan before commit, and never pushes recovery branches.

## Document Policy

Use `docs/agent-process/document-policy.md` for document charters, status/lifecycle rules,
placement priority, budgets, and doc-health duties. If a rule needs more than 10 lines in
`AGENTS.md`, keep a short contract here and move the detail there.

## Doc Health

Run `node scripts/doc-health/health.mjs --repo <repo> --report <path>` for report-only document-policy drift checks.
The checker emits warning findings and issue payloads; it never edits docs, opens gates, or blocks.
Full contract: `docs/agent-process/doc-health.md`.

## CHANGELOG

This repo uses **<Mode 1: direct edit / Mode 2: `.changelog/unreleased/` fragments>** -
pick one and delete the other during initial setup. For PRs that do not warrant a
CHANGELOG entry, apply the `no-changelog` label.

## Commit Hygiene

- Stage specific files: `git add <path> <path>`. Never use `git add -A`, `git add .`, or
  `git add --all`.
- Keep one logical unit per commit. If the message needs "and", split it.
- Do not bypass hooks with `--no-verify` or `--no-gpg-sign`; fix the underlying failure.

## Reference Precision

In durable artifacts such as decision logs, ADRs, PR bodies, update-log fragments, and
verification notes, name refs unambiguously. Use `origin/main` when remote-vs-local matters,
and write "the local default branch" when that is what you mean.

## When Stuck

If the same approach fails twice, stop. Switch tactics, ask the user, or document what you
tried in the issue.
