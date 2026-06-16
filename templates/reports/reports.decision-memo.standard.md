---
id: reports.decision-memo.standard
version: 1.1.0
audience: reviewer
status: active
owner: agents
last_updated: 2026-06-15
use_when:
  - A decision needs options, tradeoffs, recommendation, and follow-up recorded.
avoid_when:
  - There is no real choice or tradeoff to document.
required_inputs:
  - decision_title
  - decision_kind
  - decision_needed
  - options_with_project_impact
  - recommendation
  - reviewer_routing
optional_inputs:
  - background
  - risks
  - final_decision
  - follow_up_actions
output_type: report
style_compatible:
  - plain
  - bbs-1998
sections:
  status_banner: required
  background: optional
  decision_needed: required
  options_considered: required
  recommendation: required
  reviewer: required
  risks: optional
  decision: optional
  follow_up_actions: optional
quality_gate:
  - Must open with TECHNICAL DECISION or CREATIVE DECISION per the message protocol.
  - Each option must state how it changes the project differently from the others.
  - Must name reviewer routing (technical -> a second reviewer may be pulled in; creative -> owner decides solo).
---

# Decision Memo: {{decision_title}}

<!-- Status banner: TECHNICAL DECISION or CREATIVE DECISION (see message protocol). -->
**{{decision_kind}}**

## Background

{{background}}

## Decision needed

{{decision_needed}}

## Options considered

<!-- One block per option. Each MUST state how it changes the project differently from the
     others — cost, reach, reversibility, what it forecloses — not just local pros/cons. -->
{{options_with_project_impact}}

## Recommendation

{{recommendation}}

## Reviewer

<!-- Technical decision: note whether a second reviewer should weigh in.
     Creative decision: the owner decides solo. -->
{{reviewer_routing}}

## Risks

{{risks}}

## Decision

{{final_decision}}

## Follow-up actions

{{follow_up_actions}}
