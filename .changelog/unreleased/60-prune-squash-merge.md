### Fixed

- `agent:prune` now retires **squash- and rebase-merged** agent worktrees, not just
  ancestry-merged ones. `git branch --merged` can't see a squash/rebase merge (it lands a
  new commit SHA on the default branch), so those finished lanes used to be stranded. Prune
  now supplements the ancestry signal with GitHub PR state, retiring a lane only when its PR
  merged into the default branch **and** the worktree's local tip equals the merged commit
  (`headRefOid`). An open PR, a non-default merge base, or commits added after the merge keep
  the lane; if `gh` is unavailable it falls back to ancestry-only and never deletes on
  uncertainty. (#60)

### Added

- `agent:prune -- --dry-run` previews the classification — every lane with a removal/keep
  reason (`ancestry-merged`, `github-pr`, `dirty`, `open-pr`, `tip-ahead-of-merged`, …) —
  without changing anything. (#60)
