## 2026-06-13 - Convert repo-update-log to per-PR fragments

- **Issue/PR:** #89 / (pending)
- **Branch:** agent/claude/89-repo-update-log-fragments
- **Changed paths:** docs/repo-update-log/README.md, docs/repo-update-log/2026-06-13-89-repo-update-log-fragments.md, docs/repo-update-log.md, AGENTS.md, .agent/startup-baseline.json, test/startup-baseline.test.mjs, scripts/agent/lib.mjs, docs/adr/001-primary-checkout-worktree-policy.md, .changelog/unreleased/89-repo-update-log-fragments.md
- **What changed:** Replaced the single-file `docs/repo-update-log.md` append convention with one-file-per-PR fragments under `docs/repo-update-log/`, mirroring the Mode-2 changelog, to eliminate the cross-PR merge-conflict hotspot. The old file is frozen as a historical archive. Updated the AGENTS.md requirement (workflow item 6), the managed Agent Start Map line, and the Reference-precision example; the `agent:status` printed start map; the startup baseline + its test; and the ADR-001 rollout step. This entry is itself the first fragment (dogfood).
- **Verification:** `npm test` (node --test) green; `node --check scripts/agent/lib.mjs`; `git diff --check` clean.
- **Propagation:** pending archon-setup snapshot refresh (ship the convention to onboarded/new repos; reset the shipped archive to a starter), then consumer adoption — hudson-bend pilot first (incl. `wiki:lint` frontmatter exemption for the new dir), then jma-history / jma-ui / archon / pigafetta / comfyui-companion / github-workflows / jma-skill-review.
