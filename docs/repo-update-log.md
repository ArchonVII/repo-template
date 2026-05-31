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

## 2026-05-31 - Strict PR contract ready preflight

- **Issue/PR:** #29 / #pr
- **Branch:** agent/codex/29-strict-pr-contract
- **Changed paths:** AGENTS.md, .github/PULL_REQUEST_TEMPLATE.md, docs/repo-update-log.md
- **What changed:** Updated the template's cross-tool agent contract to forbid direct `gh pr ready` and require the shared strict PR metadata contract before ready-for-review. Reordered the default PR template to match the canonical Summary / Verification / Verification Notes / Docs-Changelog / issue-link structure.
- **Verification:** `git diff --check` passed.
- **Propagation:** pending archon-setup snapshots

## 2026-05-30 - F19 primary-checkout worktree guard

- **Issue/PR:** #25 / #pr
- **Branch:** agent/claude/25-primary-checkout-worktree-guard
- **Changed paths:** docs/adr/001-primary-checkout-worktree-policy.md, .githooks/pre-commit, .githooks/scripts/checkout-role.sh, .githooks/scripts/checkout-doctor.sh, .githooks/scripts/test-checkout-role.sh, AGENTS.md, docs/repo-update-log.md
- **What changed:** The primary checkout now accepts only default-branch owner-maintenance commits; feature-branch commits in the primary checkout are blocked and redirected to `git worktree add` (bypass `ALLOW_PRIMARY_FEATURE_COMMIT=1`, audit-logged to `.agent/bypass.log`). F18's `git switch -c` guidance is replaced with worktree guidance. Adds the `checkout-role.sh` helper, a `checkout-doctor.sh` diagnostic, and the AGENTS.md "Checkout role / worktrees" contract. Note: `checkout_is_primary` requires git >= 2.31 (`--path-format`) and fails open (skips the block) on older git.
- **Verification:** `bash .githooks/scripts/test-checkout-role.sh` passed; `bash .githooks/scripts/test-owner-maintenance.sh` passed (regression); `bash -n .githooks/pre-commit .githooks/scripts/*.sh` clean.
- **Propagation:** pending archon-setup snapshots (Phase 2; the catalog follow-up also repoints the dangling docs/phase2 refs)

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
- **Changed paths:** .agent/check-map.yml, .github/workflows/repo-required-gate.yml, .github/workflows/*
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
