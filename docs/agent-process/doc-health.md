# Doc Health

> **Status:** active
> **Owner:** ecosystem
> **Scope:** repo-local document control
> **Source of truth:** yes
> **Last reviewed:** 2026-06-15
> **Supersedes:** none
> **Superseded by:** none

Doc-health is the deterministic report-only companion to the
[Document Policy](document-policy.md). It finds drift, emits a report and issue payloads, and
leaves all fixes to the normal issue -> branch -> PR lane.

## Contract

- The runner is `node scripts/doc-health/health.mjs --repo <repo>`.
- Most findings are warnings. A small blocking subset exits non-zero and fails the
  `repo-required-gate / docs gate` job: the structural checks from #124 L2, plus
  `charter-overbudget` on suite-asserted charters (`AGENTS.md`, `VISION.md` —
  `HARD_CHARTER_DOCS` in `scripts/doc-health/lib.mjs`, rt#176: docs-only PRs skip
  node CI, so these budgets must block in the docs lane).
- The runner never rewrites docs or calls GitHub to file issues.
- The only write it performs is the explicit `--report <path>` JSON output.
- Current-truth and lifecycle interpretation reuses existing document-policy headers and wiki
  frontmatter; it does not introduce a second authority model.

## Checks

The deterministic checks are:

- Charter budget overruns for `README.md`, `AGENTS.md`, and `VISION.md`.
- Tool-stub budget overruns for `CLAUDE.md` and `GEMINI.md`.
- `Last reviewed` values older than the review cadence.
- `active` plans or project capsules untouched past the active-plan cadence.
- `superseded` docs without a concrete `Superseded by` pointer.
- Dangling relative Markdown links.
- Placeholder tokens such as `TODO`, `TBD`, and `N/A` in `active` docs.
- Startup-baseline required paths and expected directories missing from the filesystem.
- Index coherence warnings for durable wiki-frontmatter docs missing from `docs/INDEX.md` and
  frontmatter-bearing ADRs missing from `docs/adr/README.md`.
- Stale active-doc term warnings when a changed current-truth register leaves active/current docs
  carrying issue or migration references or stale status terms.

## CLI

```text
node scripts/doc-health/health.mjs --repo <path> [--report <path>] [--json]
    [--changed <path> ...] [--changed-from <git-ref>] [--now <iso-date>]
```

- `--report <path>` writes the full JSON report. Without it, the runner writes only stdout.
- `--json` prints the same report to stdout; without it, stdout is a compact text summary.
- `--changed <path>` passes PR-changed paths to the current-truth stale-term signal.
- `--changed-from <git-ref>` derives changed paths from `git diff --name-only <ref>...HEAD`.
- `--now <iso-date>` pins time for deterministic fixtures and replay.

The process exits `0` when clean or when only warnings exist, `1` when any blocking
finding exists (this is the docs-gate signal), and `2` for invalid invocation or
runtime errors.

## Report Shape

Reports use schema `doc-health.v1`:

```json
{
  "schemaVersion": "doc-health.v1",
  "status": "clean | warnings | blocking",
  "summary": { "findings": 0, "warnings": 0, "blocking": 0 },
  "findings": [],
  "issues": []
}
```

Each issue payload is a ready-to-file finding summary with `title`, `body`, `labels`,
`findingCode`, and `path`. The checker emits those payloads so callers can file or aggregate them;
the checker itself stays report-only.

## Fixture Contract

The test suite under `scripts/doc-health/` owns the acceptance fixtures:

- A clean repo returns zero findings.
- A seeded repo produces one exact finding for every deterministic check above.
- The named Hudson Bend drift fixture produces exactly three warning findings: stale roadmap
  term, ADR absent from `docs/INDEX.md`, and stale `CANON.md` wording.
- The CLI report-only fixture verifies that no path changes except the explicit report path.
