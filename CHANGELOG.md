# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Initial repo scaffold.
- Owner Maintenance Lane hook support for add-only safe docs/assets/changelog
  commits on `main`.
- Worktree guard (F19): the primary checkout stays on the default branch;
  feature commits there are blocked and redirected to `git worktree add`.
  Adds `checkout-role.sh`, `checkout-doctor.sh`, and the AGENTS.md
  "Checkout role / worktrees" contract.

<!--
  Mode 2 alternative: delete the manual sections above and use
  `.changelog/unreleased/<issue>-<slug>.md` fragments instead. See
  `ArchonVII/.github/STARTER.md` → "CHANGELOG.md + fragments".
-->
