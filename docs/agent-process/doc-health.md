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
  `repo-required-gate / docs gate` job: the structural checks from #124 L2.
  `charter-overbudget` remains an advisory maintainability signal, never a fixed merge cap.
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

## Footprint and Affected Reads

Run `node scripts/doc-health/footprint.mjs --repo <root> --base <git-ref>`
for a read-only growth and impact report; add `--json` for structured output.
Without `--base`, it measures the current footprint only. For PR scope, supply
the PR's merge-base commit; comparison is against the exact supplied revision.

It counts whitespace-delimited words (including markup/code) across regular
Git-tracked and nonignored untracked `.md`, `.mdx`, and `.txt` files. It reports
total, active, historical, and unclassified counts, per-file changes, and deltas.
Existing lifecycle metadata identifies active/history; archive paths provide a
historical fallback. These counts do not establish authority or correctness.

The instruction union covers root AGENTS/AGENTS.override/CLAUDE/GEMINI/CODEX
Markdown files and unquoted, whitespace-delimited `@path.md`, `@path.mdx`, or
`@path.txt` imports. Imports are relative to their file; cycles are deduplicated
and unavailable/external targets are disclosed. Code examples and ordinary
links are excluded. Global instructions, prose read-first directives, nested
agent files, other import syntax, and dynamically selected skills are not
measured. The startup-baseline is an existence contract, not a reading list.

Dated plans are historical unless both active and marked as a source of truth.
Impact mode rejects non-document paths hidden by Git assume-unchanged or
skip-worktree flags; snapshot counts remain available without `--base`.

Affected reads reuse `checked.owns` and `human.heal_when` from the doc-map;
unmapped changes remain visible for investigation. No thresholds, gate changes,
document rewrites, or generated report files are introduced. Exit `2` means an
invalid input or runtime failure; growth alone exits `0`.

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
