---
id: prompts.prompt-run-request.standard
version: 1.0.0
audience: agent
status: active
owner: agents
last_updated: 2026-06-02
use_when:
  - Asking an agent to execute a prompt against concrete input data.
avoid_when:
  - Designing or reviewing the prompt itself.
required_inputs:
  - prompt_name_or_body
  - input_data
  - desired_output
optional_inputs:
  - constraints
  - evaluation_criteria
  - return_format
output_type: prompt
style_compatible:
  - plain
  - bbs-1998
sections:
  prompt_to_run: required
  input_data: required
  desired_output: required
  constraints: optional
  evaluation_criteria: optional
  return_format: optional
quality_gate:
  - Must separate the prompt from the data it runs on.
---

# Prompt Run Request

## Prompt to run

{{prompt_name_or_body}}

## Input data

{{input_data}}

## Desired output

{{desired_output}}

## Constraints

{{constraints}}

## Evaluation criteria

{{evaluation_criteria}}

## Return format

{{return_format}}
