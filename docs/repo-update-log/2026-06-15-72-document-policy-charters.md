## 2026-06-15 - Document policy charters

- **Issue/PR:** #72 / #96
- **Branch:** agent/codex/72-document-policy-charters
- **Changed paths:** `AGENTS.md`, `.agent/startup-baseline.json`, `.changelog/unreleased/72-document-policy-charters.md`, `docs/agent-process/document-policy.md`, `docs/repo-update-log/2026-06-15-72-document-policy-charters.md`, `scripts/agent/lib.mjs`, `scripts/close/scan-complete.mjs`, `test/agent/lib.test.mjs`, `test/startup-baseline.test.mjs`
- **What changed:** Added the repo-local document policy detail doc with document charters, lifecycle states, placement-priority rules, and doc-health duties. Compacted `AGENTS.md` to a contract-level Start Map and updated startup-baseline/status-map wiring so agents see the policy file immediately. Fixed Windows close-scan hook parsing by converting absolute Windows paths before WSL Bash validates hook syntax.
- **Verification:** `node --test test/startup-baseline.test.mjs` passed; `node --test test/agent/lib.test.mjs` passed; `npm run wiki:doctor` passed; `npm run wiki:lint` passed; `node --test test/close-scan.test.mjs --test-name-pattern "checkHookSyntax"` passed; `npm test` passed with 124 passing tests and 0 failing tests.
- **Propagation:** pending `archon-setup` snapshot refresh in lane 1c after this provider PR lands.
