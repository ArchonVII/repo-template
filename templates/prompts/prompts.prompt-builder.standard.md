---
id: prompts.prompt-builder.standard
version: 1.0.0
audience: developer
status: active
owner: agents
last_updated: 2026-06-02
use_when:
  - Creating a reusable prompt from a goal, context, and constraints.
avoid_when:
  - Executing an existing prompt against data.
required_inputs:
  - what_the_prompt_should_accomplish
  - agent_role
  - specific_task_instructions
  - required_output_structure
optional_inputs:
  - background_context
  - input_list
  - constraints
  - reasoning_requirements
  - acceptance_criteria
  - edge_cases
  - example_input
  - example_output
output_type: prompt
style_compatible:
  - plain
  - bbs-1998
sections:
  objective: required
  role: required
  context: optional
  inputs: optional
  task: required
  output_format: required
  constraints: optional
  reasoning_requirements: optional
  quality_bar: optional
  edge_cases: optional
  example: optional
quality_gate:
  - Must be executable by an agent without extra interpretation.
  - Must include success criteria when quality matters.
---

# Prompt Builder

## Objective

{{what_the_prompt_should_accomplish}}

## Role

You are {{agent_role}}.

## Context

{{background_context}}

## Inputs

The user or system will provide:

{{input_list}}

## Task

{{specific_task_instructions}}

## Output format

Return the response in this structure:

{{required_output_structure}}

## Constraints

{{constraints}}

## Reasoning requirements

{{reasoning_requirements}}

## Quality bar

A successful response must:

{{acceptance_criteria}}

## Edge cases

Handle these cases explicitly:

{{edge_cases}}

## Example

Input:

{{example_input}}

Expected output:

{{example_output}}
