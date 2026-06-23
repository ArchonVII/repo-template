## 2026-06-23 - close-scan: skip node-test when no test script exists

- **Issue/PR:** ArchonVII/archon-setup#282 / (pending)
- **Branch:** claude/fervent-hopper-ve9ekg
- **Changed paths:** `scripts/close/scan-complete.mjs`, `.changelog/unreleased/close-scan-skip-missing-test-script.md`, `docs/repo-update-log/2026-06-23-close-scan-skip-missing-test-script.md`
- **What changed:** `runLocalChecks` now consults a new `hasNpmScript(root, 'test')` helper before running the `node-test` check. When the required-gate scope includes `node-test` but `package.json` has no `test` script, the check is recorded green-by-skip (`No \`test\` script in package.json; node-test skipped (matches the gate's \`npm run --if-present\`)`) instead of shelling out to `npm test` and failing with a missing-script error. The classifier (`classifyCloseScanScope`) is unchanged — node-test is still derived for Node-owned code/package changes — only its execution is now conditional, mirroring node-ci.
- **Verification:** `node --test test/close-scan.test.mjs` passed 14/14; `node --check scripts/close/scan-complete.mjs` clean.
- **Propagation:** the archon-setup `repo-template` snapshot (and archon-setup's own vendored copy) are updated in lockstep so freshly onboarded repos inherit the fix; once this branch merges to `main`, a normal `npm run refresh-snapshots` reconciles the pin.
