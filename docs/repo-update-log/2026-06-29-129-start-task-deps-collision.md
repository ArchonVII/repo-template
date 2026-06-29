## 2026-06-29 - start-task installs worktree deps + hardens issue-branch collision scan

- **Issue/PR:** #129 (upstream of ArchonVII/archon-setup#292 and part of archon-setup#295)
- **Branch:** agent/claude/129-start-task-deps-collision
- **Changed paths:** scripts/agent/start-task.mjs, scripts/agent/lib.mjs, test/agent/lib.test.mjs, .changelog/unreleased/129-start-task-deps-collision.md, docs/repo-update-log/2026-06-29-129-start-task-deps-collision.md
- **What changed:** (1) #292 — added `installWorktreeDeps`, a lockfile-gated (`package-lock.json`) non-fatal `npm ci` run after `git worktree add`, so a node-stack agent's fresh worktree has `node_modules` without a manual step; on Windows it routes through `cmd.exe` like `scripts/close/scan-complete.mjs`, and any failure only warns. (2) #295 (start-task) — `existingIssueBranches` now scans `refs/remotes` in addition to `refs/heads/agent` via the new pure `filterIssueBranches(refShortNames, issueNumber)` helper, so a retired/merged head for the same issue that survives only on origin is detected and its name is not reused.
- **Verification:** `npm test` (node --test) green 152/152; `node --test test/agent/lib.test.mjs` 38/38 incl. 3 new `filterIssueBranches` cases (retired remote head detected, local+remote de-dup, no substring/empty match); `node --check scripts/agent/start-task.mjs scripts/agent/lib.mjs`. repo-template is depless (no lockfile) so the gate correctly no-ops here.
- **Propagation:** pending ArchonVII/archon-setup snapshot refresh (gated follow-up) to ship to onboarded/new repos.
