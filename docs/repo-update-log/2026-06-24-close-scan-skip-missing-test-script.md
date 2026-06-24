## 2026-06-24 - Close-scan: skip node-test when the repo has no test script

- **Issue/PR:** #121 / (this PR, supersedes #119)
- **Branch:** fix/close-scan-skip-missing-test-script
- **Changed paths:** scripts/close/scan-complete.mjs, .changelog/unreleased/close-scan-skip-missing-test-script.md, docs/repo-update-log/2026-06-24-close-scan-skip-missing-test-script.md
- **What changed:** `runLocalChecks` now consults a new `hasNpmScript(root, 'test')` helper before running the `node-test` check. When the required-gate scope includes `node-test` but `package.json` has no `test` script, the check is recorded green-by-skip (`No \`test\` script in package.json; node-test skipped (matches the gate's \`npm run --if-present\`)`) instead of shelling out to `npm test` and failing with a missing-script error. The classifier (`classifyCloseScanScope`) is unchanged — node-test is still derived for Node-owned code/package changes — only its execution is now conditional, mirroring node-ci.
- **Verification:** `node --test test/close-scan.test.mjs` clean; `node --check scripts/close/scan-complete.mjs` clean.
- **Propagation:** the archon-setup `repo-template` snapshot (and archon-setup's own vendored copy) are updated in lockstep via archon-setup#284 + the post-merge snapshot refresh so freshly onboarded repos inherit the fix.
- **Follow-up:** harden `hasNpmScript` so a *malformed* package.json surfaces/fails node-test instead of silently skipping green (Codex P2 on archon-setup#284) — tracked as a fast-follow across repo-template + archon-setup.
