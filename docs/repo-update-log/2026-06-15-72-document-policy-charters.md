## 2026-06-15 - Document policy charters

- **Issue/PR:** #72 / #96
- **Branch:** agent/codex/72-document-policy-charters
- **Changed paths:** `AGENTS.md`, `.agent/startup-baseline.json`, `docs/agent-process/document-policy.md`, `scripts/agent/lib.mjs`, `test/agent/lib.test.mjs`, `test/startup-baseline.test.mjs`
- **What changed:** Added the repo-local document policy detail doc with document charters, lifecycle states, placement-priority rules, and doc-health duties. Compacted `AGENTS.md` to a contract-level Start Map and updated startup-baseline/status-map wiring so agents see the policy file immediately.
- **Verification:** `node --test test/startup-baseline.test.mjs` passed; `node --test test/agent/lib.test.mjs` passed; `npm run wiki:doctor` passed; `npm run wiki:lint` passed. Final `npm test` on this branch reported 122 passing and 2 failing tests; both failures are `test/close-scan.test.mjs` hook-syntax cases, and `node --test test/close-scan.test.mjs --test-name-pattern "checkHookSyntax"` reproduces the same Windows `bash -n C:\...` path handling failure on the primary `origin/main` checkout before this lane's changes.
- **Propagation:** pending `archon-setup` snapshot refresh in lane 1c after this provider PR lands.
