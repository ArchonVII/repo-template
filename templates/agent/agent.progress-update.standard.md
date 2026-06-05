---
id: agent.progress-update.standard
version: 1.0.0
audience: user
status: active
owner: agents
last_updated: 2026-06-02
use_when:
  - Giving a short update during longer-running work.
avoid_when:
  - The task is done and needs final verification/result details.
required_inputs:
  - current_status
  - next_work_area
optional_inputs:
  - partial_findings
  - risk_or_blocker_if_any
output_type: message
style_compatible:
  - plain
  - bbs-1998
sections:
  status: required
  found_so_far: optional
  working_on_next: required
  possible_issue: optional
quality_gate:
  - Must be concise.
  - Must state what is happening next.
---

## Status

{{current_status}}

## Found so far

{{partial_findings}}

## Working on next

{{next_work_area}}

## Possible issue

{{risk_or_blocker_if_any}}
