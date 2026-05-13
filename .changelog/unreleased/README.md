# `.changelog/unreleased/`

Per-PR CHANGELOG fragments. Each PR adds one file here named:

```
<issue-number>-<short-slug>.md
```

Example: `42-oauth-device-flow.md`.

## Fragment format

```markdown
### Added

- New thing in clear prose.

### Changed

- What changed.

### Fixed

- What you fixed.
```

Use one or more of the standard [Keep a Changelog](https://keepachangelog.com/) sections: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.

## Fold cadence

Periodically (manually for now), all fragments are concatenated into `CHANGELOG.md` under `## [Unreleased]` and the fragment files are deleted in one commit. The PR author does not edit `CHANGELOG.md` directly.

## Opting out

If a PR genuinely does not warrant an entry (pure refactor, test-only, chore), apply the `no-changelog` label and the CI gate (`ArchonVII/github-workflows/.github/workflows/changelog-fragment.yml`) will skip it.

## Delete this directory if you're using "Mode 1"

If your repo edits `CHANGELOG.md` directly, this whole `.changelog/` tree should not exist. See `STARTER.md` for the two modes.
