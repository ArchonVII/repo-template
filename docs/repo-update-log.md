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

## 2026-05-28 - Owner Maintenance Lane hooks

- **Issue/PR:** #21 / #pr
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
