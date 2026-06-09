### Added

- `agent:pr-body -- [issue]` prints the committed `.github/PULL_REQUEST_TEMPLATE.md` with the linked issue filled in to stdout, ready to pipe into `gh pr create/edit --body-file -`. The issue defaults to `.agent/current-task.json` then the branch name.

### Changed

- `agent:start-task` no longer writes a worktree-local `.pr-body.md`. Agents read the committed PR template directly (via `agent:pr-body`), so no untracked scratch file dirties the working tree or trips the close/preflight clean-tree gates. CI `pr-body-autoinject.yml` remains the backstop on PR open.
