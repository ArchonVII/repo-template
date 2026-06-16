---
id: agent.final-response.standard
version: 1.1.0
audience: user
status: active
owner: agents
last_updated: 2026-06-15
use_when:
  - An agent has completed a task and needs to present the result clearly.
avoid_when:
  - Work is still underway and only a short progress update is needed.
required_inputs:
  - result_title
  - status_tag
  - direct_answer_or_deliverable
optional_inputs:
  - owner_action
  - brief_work_summary
  - important_details
  - limitations_uncertainties_or_missing_inputs
output_type: message
style_compatible:
  - plain
  - bbs-1998
sections:
  status_banner: required
  for_you: optional
  result: required
  what_i_did: optional
  key_details: optional
  caveats: optional
quality_gate:
  - Must open with one status tag from the message protocol.
  - A state tag (SAFE TO CLEAR / NOT DONE / JUDGMENT CALL / FYI) suppresses the For you lane.
  - SAFE TO CLEAR must follow the machine-backing rule in docs/agent-process/message-protocol.md.
---

# {{result_title}}

<!-- Status banner: one tag from docs/agent-process/message-protocol.md (see partial.status-banner). -->
**{{status_tag}}**

## For you

<!-- The owner's single action, if any. Suppress this whole section for a pure
     SAFE TO CLEAR / FYI message. For a decision, carry background -> options with
     per-option project impact -> recommendation (see reports.decision-memo.standard). -->
{{owner_action}}

## Result

{{direct_answer_or_deliverable}}

## What I did

{{brief_work_summary}}

## Key details

{{important_details}}

## Caveats

{{limitations_uncertainties_or_missing_inputs}}
