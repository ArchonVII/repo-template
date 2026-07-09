# AGENTS.md

Cross-tool contract for agents in this repo. Keep this file a quick reference; move detail to `docs/agent-process/`.

## Read First

- `README.md` - purpose and run commands.
- `ARCHITECTURE.md` - subsystem map, when present.
- When the repo runs the Librarian wiki: `docs/INDEX.md`, `docs/CANON.md`, `docs/LIBRARIAN.md`.

<!-- BEGIN MANAGED AGENT START MAP -->

## Agent Start Map

Start here; do not rediscover process files:

- Document policy: `docs/agent-process/document-policy.md`.
- Plans: `docs/plans/`.
- Agent process: `docs/agent-process/`.
- Changelog: `CHANGELOG.md` is release-class; folded by `npm run docs:changelog`.
- Check map: `.agent/check-map.yml`.
- Coordination: `.agent/coordination/README.md`.
- PR process: `.github/PULL_REQUEST_TEMPLATE.md`.
- Agent scripts: `scripts/agent/`.
- Close guards: `scripts/close/`.
- Doc sweep: `scripts/doc-sweep/`.
- Doc health: `scripts/doc-health/`.
- Legacy plans: `docs/superpowers/plans/` is history only; do not add new plans there.
- Friction ledger: for a non-bug workflow hiccup, append one row to `.claude/friction.md`, do not fix it mid-task, and keep working; bugs/security or off-task defects go to `.archon/anomalies-thispr.md`.

If these files are missing or unclear, stop searching and run:

```text
node <path-to-archon-setup>/bin/onboard.mjs <repo> --audit
```

<!-- END MANAGED AGENT START MAP -->

## Workflow

1. Issue first; use explicit acceptance criteria.
2. One issue -> one active branch -> one linked worktree -> one PR per phase.
3. Branches use `agent/<tool>/<issue>-<slug>`.
4. Never commit feature, config, behavior, or shared-doc changes on `main`.
5. Retired branches stay retired; merged or closed PR branch means start fresh from `origin/main`.
6. Commit messages use Conventional Commits.
7. PR bodies come from `.github/PULL_REQUEST_TEMPLATE.md` or `npm run agent:pr-body -- <issue>`.
8. Close or supersede any plan/status artifact used by the lane before review.

## Checkout Role / Worktrees

Primary checkout stays on the default branch. Feature work happens in sibling worktrees.

```powershell
npm run agent:start-task -- <issue> [--agent <name>] [--slug <slug>]
npm run agent:status
npm run agent:prune
npm run agent:pr-body -- [issue]
```

Do not run `git switch -c` in the primary checkout. If unsure, run `bash .githooks/scripts/checkout-doctor.sh`.

## Verification And Delivery

- Required branch-protection check: `repo-required-gate / decision`.
- Path-to-check map: `.agent/check-map.yml`.
- Run the repo's lint/typecheck/test commands before review and record exact results.
- Validate PR bodies before ready: `npm run pr:contract -- --body-file - --title "<title>" --branch <branch>`.
- Do not run `gh pr ready` directly. Use:

```powershell
npm run agent:close-preflight -- --repo OWNER/REPO --pr <number>
npm run agent:pr-ready -- --repo OWNER/REPO --pr <number>
```

### Local Delivery Guards

Before push/ready/merge on the current `HEAD`:

```powershell
npm run close:scan:complete -- --repo OWNER/REPO --pr <number> --findings-decision "<decision>"
npm run close:ci:guard -- --repo OWNER/REPO --pr <number>
```

Re-run only after `HEAD` changes. Missing, pending, or unavailable required CI is not a pass.

### Closeout Modes

- `close:review`: verify -> push -> PR body -> ready-for-review handoff.
- `close:ship`: only when the owner says `/close`, `ship it`, `land it`, `merge to main`, or equivalent.
- For stacked docs PRs, review `origin/main..HEAD`, not only the narrow PR diff; guidance only, not a gate.

## Owner Maintenance Lane

Use only when the repo documents a direct owner-maintenance path and every staged path is add-only and allowed. Unsafe paths require the normal issue/branch/worktree/PR lane: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `README.md`, `.github/**`, `.githooks/**`, `.agent/schema/**`, `package*.json`, `src/**`, `scripts/**`, and protected docs.

## Coordination

Use only `.agent/coordination/` for claims, locks, handoffs, or active boards. If a claim fails, stop and report the conflict.

## Anomaly And Friction Ledgers

- Off-task bugs, stale files, security concerns, or tech debt found during a PR: `.archon/anomalies-thispr.md`; `.github/workflows/anomaly-triage.yml` routes entries.
- Non-bug workflow friction: `.claude/friction.md`; record the cost and keep moving.

## Message Protocol

Turn-terminal messages use one status tag plus the human/agent lane split. Full rules: `docs/agent-process/message-protocol.md`. `SAFE TO CLEAR` requires the close-scan marker for the pushed `HEAD`.

## Vision Drift Duties

- At plan time, read `VISION.md` when present and treat Scope / explicitly-not as owner intent.
- If work conflicts with it, surface the conflict and cite `docs/decisions/decision-log.md`.
- At closeout, append owner scope decisions to `docs/decisions/decision-log.md`; record none when none were made.

## Librarian Wiki

Applies only when the repo installs the Librarian wiki feature. Before wiki maintenance, read `docs/LIBRARIAN.md` and `docs/CANON.md`; run wiki operations through the repo's `wiki:*` scripts.

## Project Capsules

Applies only when the repo adopts project capsules. Active multi-session feature work lives in `projects/<slug>/PLAN.md`; full convention: `docs/agent-process/project-capsules.md`.

## Doc Sweep-Up

Run `node scripts/doc-sweep/sweep.mjs --repo <repo>` at session boundaries. Full spec: `docs/agent-process/doc-sweep.md`.

- Sweep only add-only allowed docs/assets; never sweep code, CI, hooks, `.claude/`, `AGENTS.md`, `CLAUDE.md`, `README.md`, manifests, or package files.
- Auto-commit only provably stranded docs. Ambiguity means leave and log.
- The sweep locks, stages selectively, scans secrets, and never pushes recovery branches.

## Document Policy

Use `docs/agent-process/document-policy.md` for document charters, lifecycle, placement, budgets, and doc-health duties. If a rule needs more than five lines here, move it there.

## Doc Health

Run `node scripts/doc-health/health.mjs --repo <repo> --report <path>` for report-only checks. It never edits docs. Full contract: `docs/agent-process/doc-health.md`.

## CHANGELOG

`CHANGELOG.md` is release-class and folded from Conventional Commit history by `npm run docs:changelog`; do not edit it per PR unless repo policy says otherwise.

## Commit Hygiene

- Stage specific files only.
- Do not bypass hooks.
- Keep one logical unit per commit.

## Reference Precision

Use unambiguous refs in durable artifacts: `origin/main` when remote-vs-local matters; "local default branch" when that is what you mean.

## When Stuck

If the same approach fails twice, stop, switch tactics, ask the owner, or document what you tried in the issue.
