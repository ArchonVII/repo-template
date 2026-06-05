---
id: github.pull-request.standard
version: 1.0.0
audience: reviewer
status: active
owner: agents
last_updated: 2026-06-02
use_when:
  - Drafting a PR body for an ArchonVII-style repo.
avoid_when:
  - A repo-local `.github/PULL_REQUEST_TEMPLATE.md` has stricter requirements.
required_inputs:
  - summary
  - verification
  - docs_changelog
  - linked_issue
optional_inputs:
  - verification_notes
  - risks
output_type: github_artifact
style_compatible:
  - plain
sections:
  summary: required
  verification: required
  verification_notes: required
  docs_changelog: required
  linked_issue: required
  risks: optional
quality_gate:
  - Must preserve the shared PR contract section order.
  - Must include concrete evidence for checked verification boxes.
  - Must link an issue unless the repo explicitly exempts the PR.
---

## Summary

{{summary}}

## Verification

{{verification}}

### Verification Notes

{{verification_notes}}

## Docs / Changelog

{{docs_changelog}}

## Linked Issue

{{linked_issue}}

## Risks

{{risks}}
