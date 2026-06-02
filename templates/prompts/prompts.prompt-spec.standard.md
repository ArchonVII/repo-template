---
id: prompts.prompt-spec.standard
version: 1.0.0
audience: developer
status: active
owner: agents
last_updated: 2026-06-02
use_when:
  - Documenting what a reusable prompt is supposed to do.
avoid_when:
  - Writing the runnable prompt body itself.
required_inputs:
  - prompt_name
  - purpose
  - required_inputs
  - expected_outputs
  - success_criteria
optional_inputs:
  - intended_user_or_agent
  - optional_inputs
  - known_failure_modes
  - test_cases
  - version_notes
output_type: report
style_compatible:
  - plain
  - bbs-1998
sections:
  purpose: required
  intended_user: optional
  required_inputs: required
  optional_inputs: optional
  expected_outputs: required
  success_criteria: required
  failure_modes: optional
  test_cases: optional
  version_notes: optional
quality_gate:
  - Must define success and failure in testable terms.
---

# Prompt Spec: {{prompt_name}}

## Purpose

{{purpose}}

## Intended user

{{intended_user_or_agent}}

## Required inputs

{{required_inputs}}

## Optional inputs

{{optional_inputs}}

## Expected outputs

{{expected_outputs}}

## Success criteria

{{success_criteria}}

## Failure modes

{{known_failure_modes}}

## Test cases

{{test_cases}}

## Version notes

{{version_notes}}
