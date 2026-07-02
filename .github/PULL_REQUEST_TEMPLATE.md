<!--
  PULL_REQUEST_TEMPLATE for ArchonVII/repo-template.

  This repo's CI surface is the node test suite (`npm test` via the required
  gate's node lane), actionlint, and git-hook shell parsing.

  Non-draft PRs are validated by the shared PR contract (substance-only since
  github-workflows#99): the Verification section needs at least one substantive
  item — a plain bullet or a checkbox — recording what was actually run or
  checked. Evidence blocks are the recommended shape and are validated when
  present, but their absence is advisory. Placeholders (TODO/TBD) and generic
  claims ("tests pass", "CI green") still hard-fail. Replace every placeholder
  before marking the PR ready for review.

  Validate a drafted body before creating the PR:
  npm run pr:contract -- --body-file - --title "<title>" --branch <branch>
-->

## Summary

TODO: What changed and why?

## Verification

- TODO: Replace with the exact command, CI check, or manual smoke test you ran and its result.

  ```evidence
  command: TODO
  location: local
  result: TODO
  timestamp: TODO
  ```

### Verification Notes

Record concrete detail: command output, CI check names, or manual smoke-test notes. Generic "tests passed / CI green" statements are rejected.

Evidence-block fields when you use one: `command`, `location` (one of `local` / `ci` / `manual`), `result`, `timestamp`. Optional: `check` (used when `location: ci` and the check-run name differs from the command).

TODO: Summarize the exact verification evidence and any manual review.

## Docs / Changelog

TODO: Record the changelog fragment, direct CHANGELOG edit, docs update, or no-changelog label.

Plan/status artifacts: TODO: closed, narrowed to remaining scoped work, marked deprecated/superseded with the current source of truth, or not applicable because none were created or used by this lane.

Owner decisions this lane: appended / none

## Linked Issue

TODO: Closes #\_\_\_

## Risks

- Risk level:
- Rollback:
- Follow-ups:
