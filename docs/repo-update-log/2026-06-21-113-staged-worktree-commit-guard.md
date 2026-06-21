# 2026-06-21 - #113 Staged/Worktree Commit Guard

- **Issue:** #113
- **Branch:** agent/codex/113-staged-worktree-commit-guard
- **Changed paths:** `.githooks/pre-commit`, `.githooks/scripts/test-owner-maintenance.sh`, `AGENTS.md`, `README.md`, `.changelog/unreleased/113-staged-worktree-commit-guard.md`, `docs/repo-update-log/2026-06-21-113-staged-worktree-commit-guard.md`
- **What changed:** Added a pre-commit guard that rejects commits when any staged path also has unstaged worktree changes, catching formatter/fixer output before a commit is created. Intentional partial snapshots can still proceed with `ALLOW_PARTIAL_COMMIT=1`, which writes the same `.agent/bypass.log` audit trail as other hook bypasses.
- **Verification:** `bash -n .githooks/pre-commit .githooks/commit-msg .githooks/scripts/*.sh` passed; `bash .githooks/scripts/test-owner-maintenance.sh` passed, including staged/worktree overlap block and `ALLOW_PARTIAL_COMMIT` audit-log bypass cases; `bash .githooks/scripts/test-checkout-role.sh` passed; `git diff --check` passed with CRLF normalization warnings only; `npm run wiki:doctor` passed 25/25; `npm run wiki:lint` passed with 4 pages checked and no errors; `npm test` passed 146/146.
