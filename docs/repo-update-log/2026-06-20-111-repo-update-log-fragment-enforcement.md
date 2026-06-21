## 2026-06-20 - Enforce repo update log fragments

- **Issue/PR:** #111 / (pending)
- **Branch:** agent/codex/111-repo-update-log-fragment-enforcement
- **Changed paths:** `.github/workflows/repo-update-log-fragment.yml`, `.agent/startup-baseline.json`, `scripts/close/lib.mjs`, `scripts/close/scan-complete.mjs`, `test/close-scan.test.mjs`, `test/startup-baseline.test.mjs`, `.changelog/unreleased/111-repo-update-log-fragment-enforcement.md`, `docs/repo-update-log/2026-06-20-111-repo-update-log-fragment-enforcement.md`
- **What changed:** Added the `repo-update-log-fragment` caller pinned to `ArchonVII/github-workflows@v1` and taught close-scan to require a repo-update-log fragment for code/config/behavior/protected-doc/workflow/policy changes. Ledger-only backfills pass without a second fragment, and unprotected doc-only skips must be recorded in the PR body.
- **Verification:** RED: `node --test test/close-scan.test.mjs` failed before implementation because `evaluateRepoUpdateLogDecision` was not exported. GREEN: `node --test test/close-scan.test.mjs test/startup-baseline.test.mjs` passed 28/28; `actionlint .github/workflows/repo-update-log-fragment.yml` exited 0; `npm test` passed 146/146; `npm run wiki:doctor` passed 25/25; `npm run wiki:lint` passed with 4 pages checked and no errors; `node --check scripts/close/lib.mjs; node --check scripts/close/scan-complete.mjs` exited 0; `git diff --check` exited 0 with LF-to-CRLF working-copy warnings only.
- **Propagation:** pending `archon-setup` snapshot refresh and Hudson Bend consumer wiring.
