---
id: partial.evidence
version: 1.0.0
audience: developer
status: active
owner: agents
last_updated: 2026-06-02
required_inputs:
  - evidence_items
output_type: partial
style_compatible:
  - plain
  - bbs-1998
sections:
  evidence: required
quality_gate:
  - Must say what each evidence item supports.
---

## Evidence

{{evidence_items}}

Each evidence item should include:

- Source or reference
- What it supports
- Confidence level
