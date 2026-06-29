### Fixed

- `doc-sweep` no longer discards a pre-staged add-only doc candidate when a
  commit is hook-rejected. `commitFileGuarded` now records whether the author had
  the path staged before the sweep and, on rejection, re-stages it instead of
  unstaging, so the "git add = save my work" signal survives for the next
  session.
- `doc-sweep` now refuses to sweep placeholder docs. `commitFileGuarded` leaves
  and logs (reason `placeholder`) any empty, whitespace-only, or single
  scaffold-token (TODO/TBD/FIXME/WIP/placeholder/stub) doc instead of committing
  a stub onto the default or PR branch. Exposed as `isPlaceholderDoc`.
- `agent:pr-ready` now gates promotion on the close `ci:guard`: it runs the guard
  for the current HEAD and refuses `gh pr ready` unless it passes, with an
  explicit `--skip-ci-guard` opt-out for the documented run-once-per-HEAD flow.
