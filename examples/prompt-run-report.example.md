---
template_id: prompts.prompt-run-report.standard
example_version: 1.0.0
last_updated: 2026-06-02
---

# Prompt Run Report: PR body contract review

## Run summary

The prompt reviewed one PR body against the ArchonVII PR contract.

## Inputs used

- PR title
- PR body
- Changed file summary

## Output produced

The reviewed PR body failed because it omitted `## Docs / Changelog` and used a
placeholder in `### Verification Notes`.

## Key findings

- Required section missing.
- Placeholder text still present.

## Issues encountered

The prompt could not verify whether CI evidence was real because check URLs were
not provided.

## Confidence

High for body-structure findings; medium for evidence quality.

## Recommended follow-up

Replace placeholders with exact verification evidence and rerun the review.
