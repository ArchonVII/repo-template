## 2026-06-15 - Add the Librarian wiki to repo-template

- **Issue/PR:** #94 / (pending)
- **Branch:** agent/claude/94-librarian-wiki
- **Changed paths:** scripts/wiki/ (lib, lint, doctor, start, ingest, query, crystallize, compact-save, lib.test), docs/LIBRARIAN.md, docs/CANON.md, docs/INDEX.md, docs/project-status.md, docs/raw/README.md, docs/audits/README.md, llms.txt, AGENTS.md, package.json, .github/workflows/wiki-lint.yml, .gitignore
- **What changed:** Ports the agent-neutral Librarian wiki (npm/Markdown variant from hudson-bend) into the template so every future repo inherits it: the zero-dep `scripts/wiki/*` toolchain, the `docs/LIBRARIAN.md` schema (with the "Re-sync the navigation front doors" rule baked in, per hudson-bend#209 / jma-history#329), scaffold CANON/INDEX/project-status pages, the `llms.txt` front door, the `AGENTS.md` Librarian section, the `wiki:*` package scripts, and the `wiki-lint.yml` CI job (doctor + lint on docs/** PRs). Pre-existing template doc trees (adr/agent-process/plans/superpowers) are listed as non-page tiers in `lib.mjs` so the wiki starts green; bring them under the schema incrementally.
- **Verification:** `node scripts/wiki/doctor.mjs` (23 checks pass), `node scripts/wiki/lint.mjs` (4 pages, no errors), `node --test scripts/wiki/lib.test.mjs` (4/4 pass). Existing repo-required-gate unaffected (recorded in PR Verification Notes).
- **Propagation:** pending archon-setup (onboarding install wiring + its own wiki), github-workflows (its own wiki) — OS-wide wiki rollout, epic archon-setup#229.
