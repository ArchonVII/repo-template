### Fixed

- `agent:prune` no longer deletes fresh no-diff `agent/*` worktrees solely because
  their branch tip is reachable from the default branch. Prune now requires
  merged-PR head evidence before retiring a clean agent lane; no PR, unavailable
  `gh`, or ancestry-only evidence keeps the worktree. (#64)
