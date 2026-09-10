# AGENTS.md

Cross-tool contract for AI agents (Claude, Codex, Copilot, Gemini, etc.) working in this repo.
Per-tool addenda such as `CLAUDE.md` and `GEMINI.md` are adapters only; rules that apply to every tool live here.

## Read First

- `README.md` - what this project is and how to run it.
- `ARCHITECTURE.md` - subsystem ownership, when the repo has one.
- When the repo runs the Librarian wiki (see "Librarian Wiki"): `docs/INDEX.md` (map of durable docs),
  `docs/CANON.md` (current truth and locked decisions), and `docs/LIBRARIAN.md` (wiki schema and
  operations). Repos onboarded without the wiki feature skip these.

<!-- BEGIN MANAGED AGENT START MAP -->

## Agent Start Map

Agents should not spend time rediscovering process files. Start here:

- Document policy: `docs/agent-process/document-policy.md` - charters, lifecycle, placement rules.
- Message protocol: `docs/agent-process/message-protocol.md` - terminal status tags and close-safety evidence.
- Plans: `docs/plans/` - dated plan files for feature and cross-cutting work; one file per plan.
- Agent process: `docs/agent-process/`.
- Changelog: `CHANGELOG.md` - follow this repo's changelog policy (modes differ per repo). `docs/repo-update-log.md` is the retired ledger's frozen archive.
- Check map: `.agent/check-map.yml`.
- Coordination: `.agent/coordination/README.md`.
- PR process: `.github/PULL_REQUEST_TEMPLATE.md`.
- Agent scripts: `scripts/agent/`.
- Close guards: `scripts/close/`.
- Doc sweep: `scripts/doc-sweep/`.
- Doc health: `scripts/doc-health/`.
- Legacy plans: `docs/superpowers/plans/` is history only; do not add new implementation plans there.
- Friction ledger: for a non-bug workflow hiccup, append one row to `.claude/friction.md`, do not fix it mid-task, and keep working; bugs/security or off-task defects still go to `.archon/anomalies-thispr.md`.
- Feature-gated bullets: the check map (`.agent/check-map.yml`), PR template (`.github/PULL_REQUEST_TEMPLATE.md`), `scripts/agent/` + `scripts/close/`, `scripts/doc-sweep/`, and `scripts/doc-health/` exist only where the repo installs the feature that provides each — the check-map, PR-template, agent-lifecycle, doc-sweep, and doc-health features respectively. Repos onboarded without a given feature skip its bullet.

If these files are missing or unclear, stop searching and run:

```text
# from a clone of ArchonVII/archon-setup (any location; target = this repo's path):
node bin/onboard.mjs <path-to-this-repo> --audit
```

No archon-setup checkout available? Stop and ask the owner — do not reconstruct process files by hand.

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
7. **Changelog policy lives in this repo's changelog section.** Follow it —
   modes differ per repo — and never hand-edit changelog artifacts beyond what it
   prescribes. Write clear Conventional Commit subjects either way.
8. **Plan/status closeout required.** Any plan, progress file, handoff, audit, roadmap,
   status tracker, or coordination note created or used by the lane must be closed,
   narrowed, or marked superseded before review.
9. **Atomic commits are not atomic PRs.** Amendments to work still under review —
   reviewer findings, doc-line corrections, formatting fixes for the same issue/slice —
   are follow-up commits pushed to the same open PR, never a new issue, branch, or PR.
   Open a separate PR only for a separate issue/phase, unrelated housekeeping, or
   material scope expansion.
10. **Re-verify proportionally.** For a mechanical-only amendment (whitespace, a typo,
    comment wording — no behavior change), confirm the diff is mechanical and rerun only
    the check that flagged it; do not rerun full review, spec, or verification pipelines.
    The PR gate rerun on push is the authoritative full check.

## Message protocol

Turn-terminal messages to the owner (the message that ends a turn or asks for input) open with one
status tag, then a `For you` lane (the owner's action; omitted for state-only messages) and a
`My work` lane. The tag vocabulary, the human/agent split, and the machine-backed `SAFE TO CLEAR`
rule live in [`docs/agent-process/message-protocol.md`](docs/agent-process/message-protocol.md).
Do not claim `SAFE TO CLEAR` with `marker=verified` unless the close-scan marker's HEAD matches the pushed HEAD.

## Vision Drift Duties

- At plan time, read `VISION.md` when present and treat Scope / explicitly-not as owner intent.
- If `VISION.md` is absent or thin, install it by copying `repo-template/VISION.md` verbatim and **ask the owner to fill it** — never compose a skeleton or seed content. `Owner: human` means elicit, don't author; a blank section is a question for the owner.
- If requested work conflicts with it, surface the conflict and cite the relevant `docs/decisions/decision-log.md` entry before proceeding.
- At closeout, append owner scope decisions made during the lane to `docs/decisions/decision-log.md`; record none in the PR when none were made.
- Keep detail in `docs/agent-process/document-policy.md`; do not turn `VISION.md` into implementation notes or status logs.

## Checkout Role / Worktrees

The primary checkout stays on the default branch. Feature work happens in linked worktrees:

```text
git worktree add -b agent/<tool>/<issue>-<slug> ../<repo>-<issue>-<slug>
```

Prefer repo helpers:

- `npm run agent:start-task -- <issue> [--agent <name>] [--slug <slug>] [--carry <path...>]` - fetch default,
  create the worktree, and record current task state.
- `npm run agent:status` - branch, upstream, PR, issue, dirty state, claims, and next action.
- `npm run agent:prune` - retire merged and clean agent worktrees using GitHub PR evidence.
- `npm run agent:pr-body -- [issue]` - print the committed PR template with issue filled.

These `agent:*` helpers exist only when the agent-lifecycle feature (its `package.json` scripts) is installed; a repo onboarded without it has no `npm run` targets, so use the raw `git worktree add` command shown above.

Do not run `git switch -c` in the primary checkout; if unsure, run `bash .githooks/scripts/checkout-doctor.sh`.
Use `--carry` only for explicit in-repo task inputs: every dirty path must be covered, each destination is verified before only the named sources are cleaned, and unrelated dirt still blocks startup. Cleanup is bound to that verified filesystem and Git-index state; divergent index/worktree versions are rejected because one copy cannot represent both. Detected changes or recreations make startup fail without overwriting them and report every location that may hold recovery data. A tracked deletion is carried as an absent destination; a rename requires both its original and destination paths to be covered before task branch/worktree creation. No portable lock spans these filesystem and Git operations, so do not edit either checkout until `agent:start-task` returns.

## Verification And Delivery

- Treat `repo-required-gate / decision` as the stable branch-protection check. Do not make
  path-filtered leaf workflows required.
- Use `.agent/check-map.yml` for path-to-check expectations. If the repo stack changes,
  update the check map and `repo-required-gate` caller in the same PR.
- Run focused local checks needed to implement or reproduce a finding. GitHub's required gate is
  the sole required full-suite run; do not repeat it locally as delivery ceremony or during review.
- `## Verification` needs at least one substantive item — a plain bullet or a checkbox —
  recording what was actually run or checked (substance-only contract, gw#99). Placeholders
  and generic claims ("tests pass", "CI green") fail; a bullet with the real command and
  result passes. Evidence blocks are the recommended shape and are validated when present;
  their absence is advisory. If you do tick a checkbox, tick it only after the backing
  command or manual check actually passed.
- Validate a drafted body BEFORE creating the PR — same validator CI runs, zero paid
  re-runs on formatting. Save the filled body to a temporary file outside the worktree,
  set `$bodyFile`, `$title`, and `$branch`, then run:
  `npm run pr:contract -- --body-file "$bodyFile" --title "$title" --branch "$branch"`.
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
npm run close:scan:complete -- --repo OWNER/REPO --pr <number> --findings-decision "<decision>"
git push
npm run close:ci:guard -- --repo OWNER/REPO --pr <number>
```

`close:ci:guard` must pass before `agent:close-preflight`, `agent:pr-ready`, or merge
actions. Missing, pending, or unavailable required CI is not a pass. The guard checks the
gate this repo declares in `.agent/check-map.yml` (`required_gate.check_name`) — here
`repo-required-gate / decision`; `--required-check <name>` overrides for one run.

The guard is idempotent against `HEAD`: run `close:ci:guard` **once for the current
`HEAD`**. A single passing run covers `agent:close-preflight`, `agent:pr-ready`, and the
merge — do not re-run it for each gate while `HEAD` is unchanged; re-run only after a new
commit moves `HEAD`. Once it passes and the PR is ready with `repo-required-gate /
decision` green, one confirming status read is enough: do not repeatedly re-poll checks,
re-snapshot PR status, or re-list review threads on an unchanged, green, ready PR.

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

`.agent/coordination/` is canonical for durable repository coordination; do not assume sibling repos exist.
Machine-global staging and handoffs may be transport queues, and ephemeral runtime claims and locks may remain machine-local.
Neither is durable repo authority. If claim acquisition fails, stop and report the conflict.

## Anomaly And Friction Ledgers

- Off-task bugs, stale files, security concerns, or tech debt found during a PR go in
  `.archon/anomalies-thispr.md` on the PR branch. The installed
  `.github/workflows/anomaly-triage.yml` routes related entries to PR review comments and
  unrelated entries to issues.
- Use one `## <short title>` block per anomaly with severity, representative file when
  useful, related-to-PR status, and downstream repo only when the fix lives elsewhere.
- Non-bug workflow friction goes in `.claude/friction.md`; record the cost and keep moving.

## Librarian Wiki

**Applies only when the repo installs the Librarian wiki feature** - the `wiki:*`
npm scripts plus `docs/CANON.md`, `docs/LIBRARIAN.md`, `docs/INDEX.md`, and
`docs/raw/`. Repos onboarded without it have none of these paths; skip this
section and keep durable docs under `docs/` directly.

The `docs/` tree is an agent-maintained wiki. `AGENTS.md`, `llms.txt`, `docs/CANON.md`,
`docs/LIBRARIAN.md`, and `docs/INDEX.md` are the canonical navigation layer. Anything under
`.claude/`, `.codex/`, `.gemini/`, plus `CLAUDE.md` and `GEMINI.md`, is an adapter only.

- Before wiki maintenance, read `docs/LIBRARIAN.md` and `docs/CANON.md`.
- `docs/raw/` is immutable intake; `docs/` holds durable pages; `docs/memory/` is a
  machine-local junction; corrections go in `docs/audits/`.
- Run wiki operations through `npm run wiki:start`, `wiki:ingest`, `wiki:query`,
  `wiki:lint`, `wiki:crystallize`, `wiki:compact-save`, `wiki:doctor`, and `wiki:graph`
  (the last renders the wiki as a graph to `.html-artifacts/wiki-graph.html`).
- When `docs/CANON.md`, `docs/project-status.md`, or release/deploy-status facts change,
  resync both `llms.txt` and relevant `README.md` status/overview prose in the same PR.

## Project Capsules

**Applies only when the repo adopts project capsules** - `projects/<slug>/PLAN.md`
plus `docs/agent-process/project-capsules.md`. Repos onboarded without the capsule
feature track multi-session feature work under `docs/plans/` instead; skip this
section.

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

**Applies only when the repo installs the doc-health feature.** Without it, skip the runner and use available repo-local targeted checks.
When installed, run the report-only `node scripts/doc-health/health.mjs --repo <repo> --report <path>`; full contract: `docs/agent-process/doc-health.md`.
The checker never edits docs. Targeted policy failures block; unrelated warnings do not prevent document-policy activation.

## CHANGELOG

`CHANGELOG.md` is **release-class**: its `[Unreleased]` section is folded from Conventional
Commit history by `npm run docs:changelog` at release-cut, never edited per PR (`feat`→Added,
`fix`→Fixed, `perf`/`refactor`→Changed; breaking changes always surfaced). Write clear Conventional Commit subjects; that is the changelog.

## Commit Hygiene

- Stage specific files: `git add <path> <path>`. Never use `git add -A`, `git add .`, or `git add --all`.
- If a formatter or fixer changes a staged file, re-stage that path before committing.
  `.githooks/pre-commit` blocks same-file staged plus unstaged drift; use
  `ALLOW_PARTIAL_COMMIT=1` only for an intentional partial snapshot with audit logging.
- Keep one logical unit per commit. If the message needs "and", split it.
- Do not bypass hooks with `--no-verify` or `--no-gpg-sign`; fix the underlying failure.

## Reference Precision

In durable artifacts such as decision logs, ADRs, PR bodies, update-log fragments, and verification notes, name refs unambiguously.
Use `origin/main` when remote-vs-local matters, and write "the local default branch" when that is what you mean.

## When Stuck

If the same approach fails twice, stop. Switch tactics, ask the user, or document what you tried in the issue.
