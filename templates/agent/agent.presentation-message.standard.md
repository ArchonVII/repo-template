---
id: agent.presentation-message.standard
version: 1.0.0
audience: user
status: active
owner: agents
last_updated: 2026-06-02
use_when:
  - Packaging a proposal, strategy, prompt pack, report, or reusable artifact.
avoid_when:
  - The user only needs a terse answer or command output.
required_inputs:
  - presentation_title
  - one_paragraph_summary
  - deliverable
optional_inputs:
  - rationale
  - usage_instructions
  - adjustments_or_variants
  - closing_note
output_type: message
style_compatible:
  - plain
  - bbs-1998
sections:
  summary: required
  deliverable: required
  why_this_works: optional
  how_to_use_it: optional
  optional_adjustments: optional
  final_note: optional
quality_gate:
  - Must make the deliverable easy to inspect and use.
  - Must not hide caveats in polished language.
---

# {{presentation_title}}

## Summary

{{one_paragraph_summary}}

## Deliverable

{{deliverable}}

## Why this works

{{rationale}}

## How to use it

{{usage_instructions}}

## Optional adjustments

{{adjustments_or_variants}}

## Final note

{{closing_note}}
