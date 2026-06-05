---
id: agent.final-response.standard
version: 1.0.0
audience: user
status: active
owner: agents
last_updated: 2026-06-02
use_when:
  - An agent has completed a task and needs to present the result clearly.
avoid_when:
  - Work is still underway and only a short progress update is needed.
required_inputs:
  - result_title
  - direct_answer_or_deliverable
optional_inputs:
  - brief_work_summary
  - important_details
  - decisions_or_recommendations
  - limitations_uncertainties_or_missing_inputs
  - single_best_next_step
output_type: message
style_compatible:
  - plain
  - bbs-1998
sections:
  result: required
  what_i_did: optional
  key_details: optional
  decisions_recommendations: optional
  caveats: optional
  next_step: optional
quality_gate:
  - Must answer the actual user request.
  - Must state verification or caveats when relevant.
  - Must avoid unnecessary process detail.
---

# {{result_title}}

## Result

{{direct_answer_or_deliverable}}

## What I did

{{brief_work_summary}}

## Key details

{{important_details}}

## Decisions / recommendations

{{decisions_or_recommendations}}

## Caveats

{{limitations_uncertainties_or_missing_inputs}}

## Next step

{{single_best_next_step}}
