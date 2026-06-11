### Fixed

- Ported the five agent-lifecycle / doc-sweep fixes found in archon-setup review
  (archon-setup#197): the startup baseline now requires `scripts/agent/pr-body.mjs`;
  `agent:status` detects claims under `.agent/coordination/claims/` per the
  coordination contract; `agent:status` and `agent:prune` derive the primary
  checkout root via a shared backslash-tolerant `primaryRootFromCommonDir` helper;
  and the doc-sweep `--apply` lock-held early return strips the internal
  `captured` field like every other path. (#66)
