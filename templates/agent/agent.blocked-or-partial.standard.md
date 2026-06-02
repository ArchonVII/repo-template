---
id: agent.blocked-or-partial.standard
version: 1.0.0
audience: user
status: active
owner: agents
last_updated: 2026-06-02
use_when:
  - An agent cannot fully complete the task but can still return useful work.
avoid_when:
  - The blocker can be resolved locally without user input.
required_inputs:
  - task_name
  - completed_work
  - blocked_work
  - plain_language_reason
  - next_step
optional_inputs:
  - partial_deliverable
output_type: message
style_compatible:
  - plain
  - bbs-1998
sections:
  completed: required
  could_not_complete: required
  reason: required
  best_available_output: optional
  recommended_next_step: required
quality_gate:
  - Must distinguish completed work from blocked work.
  - Must include the best available output.
---

# Partial result: {{task_name}}

## Completed

{{completed_work}}

## Could not complete

{{blocked_work}}

## Reason

{{plain_language_reason}}

## Best available output

{{partial_deliverable}}

## Recommended next step

{{next_step}}
