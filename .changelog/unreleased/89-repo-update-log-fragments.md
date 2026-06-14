### Changed

- The repo update log is now one fragment file per PR under `docs/repo-update-log/` (mirroring the Mode-2 changelog) instead of a single shared `docs/repo-update-log.md`. This eliminates the cross-PR merge-conflict hotspot the single file caused when multiple worktrees were active. The old file is retained as a frozen historical archive. (#89)
