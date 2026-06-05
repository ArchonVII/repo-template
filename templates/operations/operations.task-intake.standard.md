---
id: operations.task-intake.standard
version: 1.0.0
audience: internal
status: active
owner: agents
last_updated: 2026-06-02
use_when:
  - Turning an informal request into scoped work before issue creation.
avoid_when:
  - A task issue already exists with complete acceptance criteria.
required_inputs:
  - request
  - desired_outcome
optional_inputs:
  - constraints
  - known_inputs
  - unknowns
  - suggested_issue_type
output_type: report
style_compatible:
  - plain
  - bbs-1998
sections:
  request: required
  desired_outcome: required
  constraints: optional
  known_inputs: optional
  unknowns: optional
  suggested_issue_type: optional
quality_gate:
  - Must turn vague work into an issue-ready scope.
---

# Task Intake: {{request_title}}

## Request

{{request}}

## Desired outcome

{{desired_outcome}}

## Constraints

{{constraints}}

## Known inputs

{{known_inputs}}

## Unknowns

{{unknowns}}

## Suggested issue type

{{suggested_issue_type}}
