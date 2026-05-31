<!--
  PULL_REQUEST_TEMPLATE for ArchonVII/repo-template.

  repo-template has no language-runtime CI surface — verification commands
  here target the actionlint workflow and git-hook shell parsing.

  Non-draft PRs are validated by the shared PR contract. Replace every
  placeholder before marking the PR ready for review.
-->

## Summary

TODO: What changed and why?

## Verification

- [ ] TODO: Replace with an exact command, CI check, or manual smoke test.

  ```evidence
  command: TODO
  location: local
  result: TODO
  timestamp: TODO
  ```

### Verification Notes

Each checked box below must be backed by exactly one fenced `evidence` block. The PR-policy parser (warning-only in Phase 1, will hard-fail in Phase 2+) reads them.

Required fields: `command`, `location` (one of `local` / `ci` / `manual`), `result`, `timestamp`. Optional: `check` (used when `location: ci` and the check-run name differs from the command).

TODO: Summarize the exact verification evidence and any manual review.

## Docs / Changelog

TODO: Record the changelog fragment, direct CHANGELOG edit, docs update, or no-changelog label.

## Linked Issue

TODO: Closes #___

## Risks

- Risk level:
- Rollback:
- Follow-ups:
