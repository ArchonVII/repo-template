### Added

- Added a pre-commit guard that blocks commits when staged files still have
  unstaged worktree changes, with an audited `ALLOW_PARTIAL_COMMIT=1` escape
  hatch for intentional partial snapshots.
