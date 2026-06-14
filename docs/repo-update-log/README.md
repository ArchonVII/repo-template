# Repository Update Log (per-PR fragments)

This directory is the operational ledger of agent-visible repository changes — what
changed and whether more propagation is needed. It complements `CHANGELOG.md`
(user-facing release history) and supersedes the single-file
[`../repo-update-log.md`](../repo-update-log.md), which is now a **frozen historical
archive** (entries through 2026-06-13).

## Why fragments

A single shared log file is a merge-conflict hotspot: every concurrent PR appends near
the top of the same file and they collide. This mirrors the Mode-2 changelog
(`.changelog/unreleased/`): **one file per PR**, so concurrent PRs never touch the same
file.

## Convention

Every PR that changes code, config, behavior, protected docs, tracked workflows, or
repository policy adds **one new file**:

```
docs/repo-update-log/<YYYY-MM-DD>-<issue>-<slug>.md
```

- One file per PR. Never edit another PR's fragment or the frozen archive.
- `<YYYY-MM-DD>` is the entry date (natural chronological sort), `<issue>` is the GitHub
  issue number, `<slug>` is a short kebab description.
- Doc-only typo fixes may skip the fragment only when the PR body says why.

## Entry template

```markdown
## YYYY-MM-DD - <short title>

- **Issue/PR:** #issue / #pr
- **Branch:** agent/<tool>/<issue>-<slug>
- **Changed paths:** path, path
- **What changed:** One or two sentences.
- **Verification:** Exact commands/results, or docs-only rationale.
- **Propagation:** none | pending <repo/path> | completed <repo/path>
```

## Folding (optional, periodic)

Fragments are independently readable and can be left in place. If a consolidated view is
wanted, fragments may be periodically concatenated (newest first) into the frozen archive
and deleted in one commit — the same way `.changelog/unreleased/` folds into
`CHANGELOG.md`. The point is only that PR authors never edit a shared file.

## Librarian repos

On repos with the Librarian wiki (`wiki:lint`), add `docs/repo-update-log/` to the
frontmatter-exempt list alongside the other `*-log` exemptions: fragments are operational
ledger entries, not durable wiki pages.
