---
id: reports.decision-memo.standard
version: 1.0.0
audience: reviewer
status: active
owner: agents
last_updated: 2026-06-02
use_when:
  - A decision needs options, tradeoffs, recommendation, and follow-up recorded.
avoid_when:
  - There is no real choice or tradeoff to document.
required_inputs:
  - decision_title
  - decision_needed
  - recommendation
optional_inputs:
  - options
  - tradeoffs
  - risks
  - final_decision
  - follow_up_actions
output_type: report
style_compatible:
  - plain
  - bbs-1998
sections:
  decision_needed: required
  recommendation: required
  options_considered: optional
  tradeoffs: optional
  risks: optional
  decision: optional
  follow_up_actions: optional
quality_gate:
  - Must make the recommended choice and tradeoffs explicit.
---

# Decision Memo: {{decision_title}}

## Decision needed

{{decision_needed}}

## Recommendation

{{recommendation}}

## Options considered

{{options}}

## Tradeoffs

{{tradeoffs}}

## Risks

{{risks}}

## Decision

{{final_decision}}

## Follow-up actions

{{follow_up_actions}}
