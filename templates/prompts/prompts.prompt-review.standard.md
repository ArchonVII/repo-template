---
id: prompts.prompt-review.standard
version: 1.0.0
audience: developer
status: active
owner: agents
last_updated: 2026-06-02
use_when:
  - Evaluating, debugging, or improving a prompt.
avoid_when:
  - The user only wants the prompt executed.
required_inputs:
  - prompt_name
  - assessment
optional_inputs:
  - strengths
  - weaknesses
  - ambiguities
  - failure_risks
  - recommended_edits
  - revised_prompt
  - test_cases
output_type: report
style_compatible:
  - plain
  - bbs-1998
sections:
  overall_assessment: required
  strengths: optional
  weaknesses: optional
  ambiguities: optional
  failure_risks: optional
  recommended_edits: optional
  revised_prompt: optional
  test_cases: optional
quality_gate:
  - Must treat the prompt as a maintainable artifact.
  - Must include concrete recommended edits when weaknesses are found.
---

# Prompt Review: {{prompt_name}}

## Overall assessment

{{assessment}}

## Strengths

{{strengths}}

## Weaknesses

{{weaknesses}}

## Ambiguities

{{ambiguities}}

## Failure risks

{{failure_risks}}

## Recommended edits

{{recommended_edits}}

## Revised prompt

{{revised_prompt}}

## Test cases

{{test_cases}}
