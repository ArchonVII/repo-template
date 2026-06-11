### Fixed

- Ported the five agent-lifecycle / doc-sweep fixes found in archon-setup review
  (archon-setup#197): the startup baseline now requires `scripts/agent/pr-body.mjs`;
  `agent:status` detects claims under `.agent/coordination/claims/` per the
  coordination contract — resolved against the current worktree like doc-sweep's
  loader, so linked-worktree claims are no longer missed; `agent:prune` derives
  the primary checkout root via a backslash-tolerant `primaryRootFromCommonDir`
  helper exported from `scripts/agent/lib.mjs`; and the doc-sweep `--apply`
  lock-held early return strips the internal `captured` field like every other
  path. (#66)
