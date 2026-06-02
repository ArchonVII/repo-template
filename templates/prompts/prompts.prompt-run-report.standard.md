---
id: prompts.prompt-run-report.standard
version: 1.0.0
audience: user
status: active
owner: agents
last_updated: 2026-06-02
use_when:
  - Reporting what happened after a prompt was executed.
avoid_when:
  - Returning only the prompt output artifact.
required_inputs:
  - prompt_name
  - summary_of_what_happened
  - output
optional_inputs:
  - inputs_used
  - key_findings
  - issues
  - confidence_level_and_reason
  - follow_up
output_type: report
style_compatible:
  - plain
  - bbs-1998
sections:
  run_summary: required
  inputs_used: optional
  output_produced: required
  key_findings: optional
  issues_encountered: optional
  confidence: optional
  recommended_follow_up: optional
quality_gate:
  - Must keep the run report separate from the generated output artifact.
---

# Prompt Run Report: {{prompt_name}}

## Run summary

{{summary_of_what_happened}}

## Inputs used

{{inputs_used}}

## Output produced

{{output}}

## Key findings

{{key_findings}}

## Issues encountered

{{issues}}

## Confidence

{{confidence_level_and_reason}}

## Recommended follow-up

{{follow_up}}
