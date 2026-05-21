<!--
  PULL_REQUEST_TEMPLATE for ArchonVII/repo-template.

  repo-template has no language-runtime CI surface — verification commands
  here target the actionlint workflow and git-hook shell parsing.

  Verification section dogfoods the F2/F10 fenced-evidence format consumed
  by the shared pr-policy reusable workflow (warning-only in Phase 1, will
  hard-fail in Phase 2+). See ArchonVII/github-workflows#10 (amendment
  dated 2026-05-19) and #12.
-->

## Summary

<!-- What changed and why? -->

## Linked Issue

Closes #

## Scope

- In scope:
- Out of scope:

## Changelog

<!-- Fragment: .changelog/unreleased/<issue>-<slug>.md, CHANGELOG.md direct edit, no-changelog label, or N/A with reason. -->

## Verification

### Verification Notes

Each checked box below must be backed by exactly one fenced `evidence` block. The PR-policy parser (warning-only in Phase 1, will hard-fail in Phase 2+) reads them.

Required fields: `command`, `location` (one of `local` / `ci` / `manual`), `result`, `timestamp`. Optional: `check` (used when `location: ci` and the check-run name differs from the command).

- [ ] Workflows lint clean

  ```evidence
  command: actionlint .github/workflows/*.yml
  location: local
  result: no issues
  timestamp: 2026-05-20T18:32:00Z
  ```

- [ ] Hook scripts parse

  ```evidence
  command: bash -n .githooks/*
  location: local
  result: no syntax errors
  timestamp: 2026-05-20T18:35:00Z
  ```

- [ ] Visual / manual review

  ```evidence
  command: read full diff in GitHub UI
  location: manual
  result: no concerns
  timestamp: 2026-05-20T18:41:00Z
  ```

## Risks

- Risk level:
- Rollback:
- Follow-ups:
