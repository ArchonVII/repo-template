---
id: agent.handoff.standard
version: 1.0.0
audience: internal
status: active
owner: agents
last_updated: 2026-06-02
use_when:
  - Another agent, thread, or person needs to continue the work.
avoid_when:
  - The work is complete and needs only a user-facing final response.
required_inputs:
  - task_name
  - objective
  - current_state
  - completed_work
  - next_actions
optional_inputs:
  - important_context
  - decisions
  - open_questions
  - references
output_type: handoff
style_compatible:
  - plain
  - bbs-1998
sections:
  objective: required
  current_state: required
  completed_work: required
  important_context: optional
  decisions_made: optional
  open_questions: optional
  recommended_next_actions: required
  references: optional
quality_gate:
  - Must let the next worker resume without reading the whole conversation.
  - Must identify open questions and references.
---

# Handoff: {{task_name}}

## Objective

{{objective}}

## Current state

{{current_state}}

## Completed work

{{completed_work}}

## Important context

{{important_context}}

## Decisions made

{{decisions}}

## Open questions

{{open_questions}}

## Recommended next actions

{{next_actions}}

## Files / links / references

{{references}}
