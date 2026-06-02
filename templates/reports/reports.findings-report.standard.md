---
id: reports.findings-report.standard
version: 1.0.0
audience: user
status: active
owner: agents
last_updated: 2026-06-02
use_when:
  - Reporting research, inspection, analysis, or audit findings.
avoid_when:
  - The output is a decision recommendation with multiple options.
required_inputs:
  - topic
  - summary
  - findings
optional_inputs:
  - evidence
  - interpretation
  - risks_or_unknowns
  - recommendation
  - next_action
output_type: report
style_compatible:
  - plain
  - bbs-1998
sections:
  summary: required
  findings: required
  evidence: optional
  interpretation: optional
  risks_unknowns: optional
  recommendation: optional
  next_action: optional
quality_gate:
  - Must separate findings from interpretation.
  - Must cite evidence or state when evidence is unavailable.
---

# Findings Report: {{topic}}

## Summary

{{summary}}

## Findings

{{findings}}

## Evidence

{{evidence}}

## Interpretation

{{interpretation}}

## Risks / unknowns

{{risks_or_unknowns}}

## Recommendation

{{recommendation}}

## Next action

{{next_action}}
