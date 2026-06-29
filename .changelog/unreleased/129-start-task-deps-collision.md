### Fixed

- `agent:start-task` now installs dependencies in a freshly created worktree
  with a lockfile-gated, non-fatal `npm ci` (gated on `package-lock.json`;
  routed through `cmd.exe` on Windows where `npm` is a `.cmd` shim). A new
  node-stack worktree previously had no `node_modules` (gitignored) until a
  manual `npm ci`. The install never aborts task setup if it fails.
- `agent:start-task` collision detection now scans remote-tracking refs in
  addition to local `refs/heads/agent`. A retired/merged PR head for the same
  issue whose local copy was pruned but still exists on origin is now detected,
  so its branch name is not silently reused. Extracted as the pure
  `filterIssueBranches` helper with unit coverage.
