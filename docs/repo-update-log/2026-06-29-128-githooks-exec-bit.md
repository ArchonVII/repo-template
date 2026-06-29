## 2026-06-29 - Track .githooks shell files as executable (100755)

- **Issue/PR:** #128 (upstream of ArchonVII/archon-setup#294)
- **Branch:** agent/claude/128-githooks-exec-bit
- **Changed paths:** .githooks/scripts/checkout-doctor.sh, .githooks/scripts/checkout-role.sh, .githooks/scripts/owner-maintenance.sh, .githooks/scripts/test-checkout-role.sh, .githooks/scripts/test-owner-maintenance.sh, test/githooks-exec-bit.test.mjs, .changelog/unreleased/128-githooks-exec-bit.md, docs/repo-update-log/2026-06-29-128-githooks-exec-bit.md
- **What changed:** Set the tracked executable bit (`git update-index --chmod=+x`, mode `100644` -> `100755`) on the five `.githooks/scripts/*.sh` helpers that were shipped non-executable. After `install-githooks.sh` sets `core.hooksPath=.githooks`, those files are sourced/invoked by the hook entrypoints; non-executable mode means git skips them on Unix while git-for-windows runs them by shebang regardless, making the defect latent. Added `test/githooks-exec-bit.test.mjs` to lock every `.githooks` shell file at `100755`.
- **Verification:** `npm test` (node --test) green; `git ls-files -s .githooks` shows `100755` for all eight shell files.
- **Propagation:** pending ArchonVII/archon-setup snapshot refresh (gated follow-up) to ship the mode fix to onboarded/new repos.
