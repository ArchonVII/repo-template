# Repository Update Log

This log records agent-visible repository changes that should be easy to audit later. It complements `CHANGELOG.md`: the changelog is user-facing release history, while this file is the operational ledger for what changed in this repo and whether more propagation is needed.

## Entry Template

```markdown
## YYYY-MM-DD - <short title>

- **Issue/PR:** #issue / #pr
- **Branch:** agent/<tool>/<issue>-<slug>
- **Changed paths:** path, path
- **What changed:** One or two sentences.
- **Verification:** Exact commands/results, or docs-only rationale.
- **Propagation:** none | pending <repo/path> | completed <repo/path>
```

## 2026-06-12 - Default-branch owner-lane hook gate

- **Issue/PR:** #77 / (pending)
- **Branch:** agent/codex/77-hooks-default-branch-doc-refs
- **Changed paths:** .githooks/commit-msg, .githooks/pre-commit, .githooks/scripts/install-githooks.sh, .githooks/scripts/test-owner-maintenance.sh, README.md, docs/adr/001-primary-checkout-worktree-policy.md, .changelog/unreleased/77-hooks-default-branch-doc-refs.md, docs/repo-update-log.md
- **What changed:** The pre-commit owner-lane gate now compares the current branch with `checkout_default_branch()` instead of the literal `main`/`master` pair, so unsafe direct commits are blocked on repos whose default branch is named differently. Hook-layer authority references now point to ADR-001 and the Owner Maintenance Lane contract instead of missing legacy docs.
- **Verification:** `C:\Program Files\Git\bin\bash.exe .githooks/scripts/test-owner-maintenance.sh` passed, including the new `trunk` default-branch unsafe-path regression; `C:\Program Files\Git\bin\bash.exe .githooks/scripts/test-checkout-role.sh` passed; `C:\Program Files\Git\bin\bash.exe -n .githooks/commit-msg .githooks/pre-commit .githooks/scripts/*.sh` passed; `C:\Program Files\Git\bin\bash.exe .githooks/scripts/checkout-doctor.sh` passed and reported this lane as a linked worktree on `agent/codex/77-hooks-default-branch-doc-refs`; `npm test` passed 103/103; `$pattern = "docs/phase" + "2"; rg -n $pattern .` returned no matches; `git diff --check` passed with CRLF normalization warnings only.
- **Propagation:** pending archon-setup snapshot refresh after merge.

## 2026-06-12 - Doc orphan detector caller

- **Issue/PR:** #76 / (pending)
- **Branch:** agent/codex/76-doc-orphan-detector
- **Changed paths:** .github/workflows/doc-orphan-detector.yml, docs/agent-process/doc-sweep.md, test/doc-orphan-detector-workflow.test.mjs, .changelog/unreleased/76-doc-orphan-detector.md, docs/repo-update-log.md
- **What changed:** Added the template's doc-orphan-detector GitHub Actions caller, pinned to `ArchonVII/github-workflows/.github/workflows/doc-orphan-detector.yml@v1`, with the weekly Monday 07:00 UTC cadence and manual dispatch. Updated the doc-sweep spec to mark the gh-cron backstop as wired for this template.
- **Verification:** `npm test -- test/doc-orphan-detector-workflow.test.mjs` first failed with the expected missing-workflow ENOENT, then passed 1/1 after the caller was added. `C:\Users\josep\go\bin\actionlint.exe .github\workflows\doc-orphan-detector.yml` passed with no output. `npm test` passed 104/104.
- **Propagation:** pending archon-setup snapshot refresh after merge.

## 2026-06-12 - Install anomaly triage caller

- **Issue/PR:** #75 / (pending)
- **Branch:** agent/codex/75-anomaly-triage-caller
- **Changed paths:** .github/workflows/anomaly-triage.yml, .gitignore, AGENTS.md, .agent/startup-baseline.json, test/startup-baseline.test.mjs, docs/repo-update-log.md
- **What changed:** Installed the anomaly-triage caller workflow from `ArchonVII/github-workflows`, kept `.archon/anomalies-thispr.md` as the canonical anomaly ledger path, and made `.archon/*` ignored except for that ledger file so agents can commit anomaly reports on PR branches.
- **Verification:** `node --test test/startup-baseline.test.mjs` passed 5/5 after the red/green cycle; `npm test` passed 105/105; `C:\Users\josep\go\bin\actionlint.exe .github/workflows/actionlint.yml .github/workflows/repo-required-gate.yml .github/workflows/anomaly-triage.yml` passed; `git diff --check` passed with CRLF warnings only.
- **Propagation:** pending archon-setup snapshot refresh after merge.

## 2026-06-11 - Baseline audit residual adjudication

- **Issue/PR:** #68 / (pending)
- **Branch:** agent/codex/68-chore-baseline-close-onboarding-audit-residuals
- **Changed paths:** CLAUDE.md, GEMINI.md, .github/CODEOWNERS, .changelog/unreleased/68-baseline-audit-residuals.md, docs/repo-update-log.md
- **What changed:** Added the Claude and Gemini pointer files so per-tool addenda exist and simplified CODEOWNERS to the generated baseline owner entry. Adjudicated remaining audit drift: README.md and AGENTS.md are intentional template/provider content, docs/repo-update-log.md is the provider's operational ledger, .githooks drift is intentional because archon-setup scrubs repo-template-only F18/F19 authority references for generated consumers, and `docs/superpowers/plans/` remains history-only per AGENTS.md.
- **Verification:** `npm test` passed 103/103. `node C:\GitHub\archon-setup\bin\onboard.mjs C:\GitHub\repo-template-68-chore-baseline-close-onboarding-audit-residuals --audit --json` reported 27 present / 0 missing / 9 drifted, with the remaining drift adjudicated above. `C:\Program Files\Git\bin\bash.exe .githooks/scripts/install-githooks.sh`, `test-owner-maintenance.sh`, `test-checkout-role.sh`, and `bash -n .githooks/commit-msg .githooks/pre-commit .githooks/scripts/*.sh` passed. `C:\Users\josep\go\bin\actionlint.exe .github/workflows/actionlint.yml` passed.
- **Propagation:** pending archon-setup snapshot refresh after merge.

## 2026-06-11 - Port archon-setup #197 lifecycle/doc-sweep fixes

- **Issue/PR:** #66 / (pending)
- **Branch:** agent/claude/66-port-197-fixes
- **Changed paths:** .agent/startup-baseline.json, scripts/agent/lib.mjs, scripts/agent/status.mjs, scripts/agent/prune.mjs, scripts/doc-sweep/sweep.mjs, test/startup-baseline.test.mjs, test/agent/lib.test.mjs, .changelog/unreleased/66-port-197-fixes.md, docs/repo-update-log.md
- **What changed:** Ported the five review fixes from archon-setup PR #197 that had been hand-applied to archon-setup's snapshot mirror of this repo: the startup baseline requires `scripts/agent/pr-body.mjs`; claims detection reads `.agent/coordination/claims/`; `agent:prune` uses a backslash-tolerant `primaryRootFromCommonDir` helper exported from `lib.mjs` (with unit tests); the doc-sweep `--apply` lock-held early return strips the internal `captured` field. Owner review of PR #67 then corrected the ported claims check to resolve against the current worktree (`--show-toplevel`) instead of the primary checkout (`--git-common-dir`), matching doc-sweep's per-worktree claims loader; status.mjs's primary-root derivation became unused and was removed. Restores provider-first flow so the next archon-setup snapshot refresh cannot clobber the fixes (ArchonVII/archon-setup#199).
- **Verification:** `npm test` (node --test) passed 103/103 after each fix commit; merged-file deltas verified against archon-setup `main` snapshot bodies (byte-identical for `.agent/startup-baseline.json`, `scripts/doc-sweep/sweep.mjs`, `test/startup-baseline.test.mjs`; fix-only additive deltas on the three files #65 touched; `scripts/agent/status.mjs` intentionally diverges from the snapshot by the worktree-claims correction, which propagates back at the next refresh). Manual smoke: `npm run agent:status` from a linked worktree reports claims installed/not-installed correctly with/without a worktree-local `.agent/coordination/claims/`.
- **Propagation:** pending archon-setup snapshot refresh (ArchonVII/archon-setup#199).

## 2026-06-10 - Safe agent prune retirement

- **Issue/PR:** #64 / (pending)
- **Branch:** agent/codex/64-safe-agent-prune
- **Changed paths:** AGENTS.md, scripts/agent/lib.mjs, scripts/agent/prune.mjs, test/agent/lib.test.mjs, .changelog/unreleased/64-safe-agent-prune.md, docs/repo-update-log.md
- **What changed:** Changed `agent:prune` so clean agent worktrees are retired only with merged-PR head evidence, not from ancestry alone. Added regression coverage for fresh no-PR branches that are reachable from the default branch but still active.
- **Verification:** `npm test -- test/agent/lib.test.mjs` passed (34/34); `npm test` passed (102/102).
- **Propagation:** pending archon-setup snapshot refresh and consumer sync for ArchonVII/jma-history.

## 2026-06-09 - Drop scratch .pr-body.md; read committed PR template directly

- **Issue/PR:** #58 / (pending)
- **Branch:** agent/claude/58-drop-scratch-pr-body
- **Changed paths:** scripts/agent/start-task.mjs, scripts/agent/pr-body.mjs, package.json, AGENTS.md, .gitignore, .changelog/unreleased/58-pr-body-stdout.md (replaces 54-prepopulate-pr-body.md), docs/repo-update-log.md
- **What changed:** `agent:start-task` no longer writes an untracked `.pr-body.md` (which dirtied worktrees and tripped close/preflight clean-tree gates). New `agent:pr-body` prints the issue-filled committed PR template to stdout for `gh pr create/edit --body-file -`. Removed the now-dead `.pr-body.md` gitignore line. Reverses unshipped #54.
- **Verification:** `npm test` (node --test) green; `node scripts/agent/pr-body.mjs 58` emits the filled template to stdout.
- **Propagation:** pending — shared skill `jma-git-pr-lifecycle` (replace `.pr-body.md` copy step), then archon-setup snapshot refresh.

## 2026-06-09 - Versioned agent startup baseline

- **Issue/PR:** #56 / (pending)
- **Branch:** agent/codex/56-startup-baseline
- **Changed paths:** AGENTS.md, .agent/startup-baseline.json, docs/plans/README.md, scripts/agent/lib.mjs, scripts/agent/status.mjs, test/agent/lib.test.mjs, test/startup-baseline.test.mjs, .changelog/unreleased/56-startup-baseline.md, docs/repo-update-log.md
- **What changed:** Added a versioned, machine-readable startup baseline and surfaced the same canonical plans/process paths in `AGENTS.md` and `npm run agent:status`, so agents start from known repo process files instead of rediscovering them. The contract now names concrete agent lifecycle and doc-sweep files so setup audits can detect stale startup tooling instead of only seeing parent directories.
- **Verification:** `node --test test/agent/lib.test.mjs` passed (25/25); `node --test test/startup-baseline.test.mjs` passed (3/3); `npm test` passed (93/93); `git diff --check` passed with CRLF warnings only; `node --check scripts/agent/lib.mjs; node --check scripts/agent/status.mjs` passed.
- **Propagation:** pending archon-setup snapshot refresh and startup-readiness audit support, then Hudson Bend pilot rollout

## 2026-06-08 - Start-task prepopulates PR bodies

- **Issue/PR:** #54 / (pending)
- **Branch:** agent/codex/54-prepopulate-pr-body
- **Changed paths:** AGENTS.md, scripts/agent/lib.mjs, scripts/agent/start-task.mjs, test/agent/lib.test.mjs, .changelog/unreleased/54-prepopulate-pr-body.md, docs/repo-update-log.md
- **What changed:** `agent:start-task` now writes an ignored `.pr-body.md` from the committed `.github/PULL_REQUEST_TEMPLATE.md` in the new worktree and prepopulates `Closes #<issue>`, so agents start from the exact strict PR contract instead of reconstructing the PR body late from memory or notes.
- **Verification:** `npm test` passed (88/88); `node --check scripts/agent/lib.mjs; node --check scripts/agent/start-task.mjs; node --check scripts/agent/status.mjs; node --check scripts/agent/prune.mjs` passed; `git diff --check` passed with CRLF warnings only; focused `populatePrBodyTemplate(.github/PULL_REQUEST_TEMPLATE.md, { issue: 54 })` smoke preserved `### Verification Notes` and filled `Closes #54`. `npm ci` is not applicable on the current depless template because #52 intentionally removed the lockfile and added `package-lock=false`.
- **Propagation:** pending archon-setup snapshot refresh after merge

## 2026-06-06 - Depless repos disable lockfile generation

- **Issue/PR:** #52 / (pending)
- **Branch:** agent/claude/52-depless-no-lockfile
- **Changed paths:** .npmrc (added), package-lock.json (removed), docs/repo-update-log.md
- **What changed:** Removed the committed, meaningless `package-lock.json` (it locked 0 packages because this template is depless) and added `.npmrc` with `package-lock=false` so npm never regenerates a stray lockfile here or in scaffolded repos. Repos that add real dependencies delete `.npmrc` to regain a committed lockfile.
- **Verification:** `npm test` (`node --test`) green; confirmed no test/check asserts the lock exists (`.agent/check-map.yml` package-lock pattern is a generic path map, not a presence requirement; `scripts/doc-sweep/lib.test.mjs` reference is a fixture string).
- **Propagation:** pending archon-setup (refresh-snapshots `copyFiles` must drop `package-lock.json`, add `.npmrc`, then re-snapshot) and depless sibling hudson-bend (`.npmrc`).

## 2026-06-05 - Owner Maintenance Lane append-log ledgers

- **Issue/PR:** #50 / (pending)
- **Branch:** agent/claude/50-owner-append-log-ledgers
- **Changed paths:** .githooks/scripts/owner-maintenance.sh, .githooks/scripts/test-owner-maintenance.sh, .githooks/commit-msg, .githooks/pre-commit, AGENTS.md, .changelog/unreleased/50-owner-append-log-ledgers.md, docs/repo-update-log.md
- **What changed:** Added a narrow, named append-log ledger allowlist (`.claude/noticed.md`, `.claude/napkin.md`) that may be added OR modified directly on `main` under the Owner Maintenance Lane, with the issue-ref requirement waived when every staged path is a ledger. All other paths keep the strict add-only + unsafe-set rules; ledger renames/copies/deletes still require a PR. Also corrected stale `docs/research|notes|assets` help text to `docs/**` (aligning with #46).
- **Verification:** `bash .githooks/scripts/test-owner-maintenance.sh` passed (incl. 7 new ledger cases); `npm test` passed (84/84); `bash -n .githooks/commit-msg .githooks/pre-commit .githooks/scripts/*.sh` passed.
- **Propagation:** pending — consumer repos (jma-history et al.) pick up the new lane on the next archon-ecosystem-sync / archon-setup snapshot refresh; tracked by repo-template#50.

## 2026-06-04 - Doc Sweep-Up capability (Phase 2)

- **Issue/PR:** #48 / (pending)
- **Branch:** agent/claude/48-doc-sweep
- **Changed paths:** AGENTS.md, scripts/doc-sweep/{lib,git,sweep}.mjs (+ matching `*.test.mjs`), docs/agent-process/doc-sweep.md, .changelog/unreleased/48-doc-sweep.md, docs/repo-update-log.md
- **What changed:** Ported the Doc Sweep-Up capability into repo-template (its canonical home) from the `archon` pilot: a depless `node:test` runner, the full standard/design spec, and the `## Doc Sweep-Up` contract section.
- **Verification:** `node --test "scripts/doc-sweep/*.test.mjs"` passed (60/60); full `npm test` passed (84/84); `git diff --cached --check` clean (line-ending warnings only).
- **Propagation:** pending archon-setup snapshot refresh after merge

## 2026-06-05 - Owner maintenance docs safe paths

- **Issue/PR:** #46 / (pending)
- **Branch:** agent/codex/46-owner-docs-safe-paths
- **Changed paths:** AGENTS.md, README.md, CHANGELOG.md, .githooks/scripts/owner-maintenance.sh, .githooks/scripts/test-owner-maintenance.sh, docs/repo-update-log.md
- **What changed:** Broadened the Owner Maintenance Lane safe set so add-only `docs/**` files are safe by default, while explicit unsafe docs paths such as `docs/process/**` and `docs/architecture/**` still require normal PR lanes.
- **Verification:** `bash .githooks/scripts/test-owner-maintenance.sh` passed; `bash -n .githooks/commit-msg .githooks/pre-commit .githooks/scripts/*.sh` passed; `git diff --check` passed with line-ending warnings only.
- **Propagation:** pending archon-setup snapshot refresh after merge

## 2026-06-04 - Reference precision contract clause

- **Issue/PR:** #44 / (pending)
- **Branch:** agent/claude/44-reference-precision
- **Changed paths:** AGENTS.md, docs/repo-update-log.md
- **What changed:** Added a `## Reference precision` clause to the cross-tool agent contract requiring unambiguous git refs in durable artifacts (`origin/main` for the remote branch, "the local default branch" for local state; no bare `main` when the local-vs-remote distinction is load-bearing), generalized to other distinction-bearing terms. Prompted by a Copilot PR review flagging an ambiguous bare `main` in a decision-log entry.
- **Verification:** docs-only contract change; `git diff --check` and `git diff origin/main...HEAD --check` clean; `npm test` (node:test) passes.
- **Propagation:** pending archon-setup snapshot refresh (`archon-setup/src/snapshots/repo-template/AGENTS.md`) after merge

## 2026-06-02 - Branch retirement policy

- **Issue/PR:** #31 / #pr
- **Branch:** agent/codex/31-branch-retirement-policy
- **Changed paths:** AGENTS.md, docs/repo-update-log.md
- **What changed:** Clarified that each workflow phase gets one active branch/worktree/PR, and that a branch with a merged or closed PR is retired. Follow-up phases for the same issue now start from the default branch in a new phase-specific lane.
- **Verification:** `git diff --check` and `git diff origin/main...HEAD --check` passed.
- **Propagation:** pending archon-setup snapshots

## 2026-06-10 - Plan/status artifact closeout guidance

- **Issue/PR:** #62 / (pending)
- **Branch:** agent/codex/62-plan-status-closeout-guidance
- **Changed paths:** AGENTS.md, .github/PULL_REQUEST_TEMPLATE.md, .changelog/unreleased/62-plan-status-closeout-guidance.md, docs/repo-update-log.md
- **What changed:** Added default cross-tool guidance that delivery is incomplete while lane-created or lane-used plan/status artifacts still read as active execution guidance. The PR template now prompts authors to record whether those artifacts were closed, narrowed, deprecated/superseded, or not applicable.
- **Verification:** `git diff --check` passed with CRLF warnings only; `npm test` passed (100/100); `npm run agent:pr-body -- 62 | Select-String -Pattern "Plan/status artifacts|Closes #62"` showed both the new plan/status prompt and the filled issue link.
- **Propagation:** pending archon-setup snapshot refresh after merge

## 2026-06-02 - Template library inventory

- **Issue/PR:** #38 / (pending)
- **Branch:** agent/codex/38-template-inventory-usage-doc
- **Changed paths:** README.md, docs/template-library-inventory.md, .changelog/unreleased/38-template-inventory-usage-doc.md, docs/repo-update-log.md
- **What changed:** Added a durable inventory of current template-system files, their repository paths, current use order, and candidate future templates. Root README now links to the inventory from the Template library section.
- **Verification:** `git diff --check` passed with line-ending warnings only; inventory path check validated 35 current paths; README link check found `docs/template-library-inventory.md`; `npm test` passed (24/24).
- **Propagation:** pending archon-setup snapshot refresh after merge

## 2026-06-02 - Strict PR ready wrapper scripts

- **Issue/PR:** #36 / (pending)
- **Branch:** agent/codex/36-strict-pr-ready-wrappers
- **Changed paths:** package.json, scripts/pr-contract.mjs, scripts/agent-close-preflight.mjs, scripts/agent-pr-ready.mjs, test/pr-contract.test.mjs, README.md, .changelog/unreleased/36-strict-pr-ready-wrappers.md, docs/repo-update-log.md
- **What changed:** Added repo-owned `agent:close-preflight`, `agent:pr-ready`, and `pr:contract` commands using the shared ArchonVII PR contract implementation, plus node:test coverage and README guidance.
- **Verification:** `node --check scripts/pr-contract.mjs; node --check scripts/agent-close-preflight.mjs; node --check scripts/agent-pr-ready.mjs` passed; `npm test` passed (24/24); `npm run pr:contract -- --repo ArchonVII/repo-template --pr 35` correctly rejected a generic verification item in draft PR #35; `npm run agent:pr-ready -- --repo ArchonVII/repo-template --pr 35 --dry-run` correctly refused promotion for the same contract violation; `git diff --check` passed.
- **Propagation:** pending archon-setup snapshot refresh after merge

## 2026-06-02 - Centralized template system baseline

- **Issue/PR:** #34 / (pending)
- **Branch:** agent/codex/34-centralized-template-system
- **Changed paths:** README.md, templates/**, styles/**, schemas/**, examples/**, .changelog/unreleased/34-centralized-template-system.md, docs/repo-update-log.md
- **What changed:** Added the first centralized template-system baseline for reusable agent messages, prompt workflows, findings reports, GitHub artifacts, operations intake, shared partials, style skins, schemas, and filled examples. Root README now points to the template library.
- **Verification:** `node -e "JSON.parse(...)"` for both schema files passed; metadata sweep passed for 30 `templates/**` and `styles/**` Markdown files; `git diff --check` passed; `npm test` passed (19/19).
- **Propagation:** pending archon-setup snapshot refresh after merge

## 2026-06-01 - Agent lifecycle command surface

- **Issue/PR:** #27 / (pending)
- **Branch:** agent/claude/27-agent-lifecycle-commands
- **Changed paths:** package.json, package-lock.json, scripts/agent/lib.mjs, scripts/agent/start-task.mjs, scripts/agent/status.mjs, scripts/agent/prune.mjs, test/agent/lib.test.mjs, .github/workflows/repo-required-gate.yml, AGENTS.md, .gitignore, .changelog/unreleased/27-agent-lifecycle-commands.md
- **What changed:** Added repo-owned agent lifecycle commands (`agent:start-task`, `agent:status`, `agent:prune`) as a zero-dependency baseline (repo-template's first `package.json`), with pure tested logic in `scripts/agent/lib.mjs` (19 `node --test` cases) and thin git/gh shims. Switched the required gate from the `minimal` to the `node` stack so `language-ci` runs `npm ci` + `npm test`. Documented the commands in AGENTS.md.
- **Verification:** `npm ci` (0 deps) + `npm test` (19/19) pass; `node --check` on all three shims; `agent:start-task` happy-path + guard smokes verified end-to-end; `agent:prune` removal/dirty-skip safety verified end-to-end (removed merged+clean, skipped merged+dirty, kept unmerged).
- **Propagation:** pending archon-setup#64 (downstream snapshot/install/audit of the lifecycle baseline)

## 2026-05-31 - Strict PR contract ready preflight

- **Issue/PR:** #29 / #30
- **Branch:** agent/codex/29-strict-pr-contract
- **Changed paths:** AGENTS.md, .github/PULL_REQUEST_TEMPLATE.md, docs/repo-update-log.md
- **What changed:** Updated the template's cross-tool agent contract to forbid direct `gh pr ready` and require the shared strict PR metadata contract before ready-for-review. Reordered the default PR template to match the canonical Summary / Verification / Verification Notes / Docs / Changelog / issue-link structure.
- **Verification:** `git diff --check`, `git diff origin/main...HEAD --check`, `bash .githooks/scripts/test-owner-maintenance.sh`, `bash .githooks/scripts/test-checkout-role.sh`, `bash -n .githooks/pre-commit .githooks/commit-msg .githooks/scripts/*.sh`, and `C:\Tools\actionlint\actionlint.exe .github\workflows\actionlint.yml .github\workflows\repo-required-gate.yml` passed.
- **Propagation:** pending archon-setup snapshots

## 2026-05-30 - F19 primary-checkout worktree guard

- **Issue/PR:** #25 / #pr
- **Branch:** agent/claude/25-primary-checkout-worktree-guard
- **Changed paths:** docs/adr/001-primary-checkout-worktree-policy.md, .githooks/pre-commit, .githooks/scripts/checkout-role.sh, .githooks/scripts/checkout-doctor.sh, .githooks/scripts/test-checkout-role.sh, AGENTS.md, docs/repo-update-log.md
- **What changed:** The primary checkout now accepts only default-branch owner-maintenance commits; feature-branch commits in the primary checkout are blocked and redirected to `git worktree add` (bypass `ALLOW_PRIMARY_FEATURE_COMMIT=1`, audit-logged to `.agent/bypass.log`). F18's `git switch -c` guidance is replaced with worktree guidance. Adds the `checkout-role.sh` helper, a `checkout-doctor.sh` diagnostic, and the AGENTS.md "Checkout role / worktrees" contract. Note: `checkout_is_primary` requires git >= 2.31 (`--path-format`) and fails open (skips the block) on older git.
- **Verification:** `bash .githooks/scripts/test-checkout-role.sh` passed; `bash .githooks/scripts/test-owner-maintenance.sh` passed (regression); `bash -n .githooks/pre-commit .githooks/scripts/*.sh` clean.
- **Propagation:** pending archon-setup snapshots; legacy hook-authority refs are repointed by #77.

## 2026-05-28 - Owner Maintenance Lane hooks

- **Issue/PR:** #21 / #22
- **Branch:** agent/codex/21-owner-maintenance-lane
- **Changed paths:** AGENTS.md, README.md, CHANGELOG.md, .githooks/commit-msg, .githooks/pre-commit, .githooks/scripts/owner-maintenance.sh, .githooks/scripts/test-owner-maintenance.sh
- **What changed:** Documented the Owner Maintenance Lane and taught the hook baseline to allow direct-main add-only safe maintenance commits with `docs(owner):` / `chore(owner):` messages while continuing to block unsafe main changes.
- **Verification:** `bash .githooks/scripts/test-owner-maintenance.sh` passed; `bash -n .githooks/commit-msg .githooks/pre-commit .githooks/scripts/*.sh` passed; `git diff origin/main...HEAD --check` passed.
- **Propagation:** pending archon-setup snapshots

## 2026-05-19 - Required gate baseline

- **Issue/PR:** #15 / #pr
- **Branch:** agent/codex/15-check-map-gate
- **Changed paths:** .agent/check-map.yml, .github/workflows/repo-required-gate.yml, .github/workflows/\*
- **What changed:** Replaced the template's multiple default PR governance workflows with one always-reporting required gate caller and a repo-local check map.
- **Verification:** `actionlint .github/workflows/repo-required-gate.yml` passed; Python/PyYAML parsed `.github/workflows/repo-required-gate.yml` and `.agent/check-map.yml`.
- **Propagation:** pending archon-setup snapshots

## YYYY-MM-DD - Initial entry

- **Issue/PR:** #issue / #pr
- **Branch:** agent/<tool>/<issue>-<slug>
- **Changed paths:** path, path
- **What changed:** Replace this starter entry with the first real repo change recorded after setup.
- **Verification:** Replace with exact verification commands/results.
- **Propagation:** none
