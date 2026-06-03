### Fixed

- `agent:prune` now retires merged + clean worktrees on Windows even when ignored
  build residue (`node_modules/`, `dist/`) makes `git worktree remove` abort partway
  with "Directory not empty" / "Filename too long". The interrupted lane is finished
  with a retrying `fs.rmSync` plus `git worktree prune`; explicitly locked worktrees are
  left untouched; and one un-removable lane is reported and skipped instead of aborting
  the whole sweep. (#40)
