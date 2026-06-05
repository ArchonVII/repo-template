---
id: agent.clarification-request.standard
version: 1.0.0
audience: user
status: active
owner: agents
last_updated: 2026-06-02
use_when:
  - One user decision is required to proceed correctly.
avoid_when:
  - A reasonable assumption is safe and can be stated in the work.
required_inputs:
  - question
optional_inputs:
  - default_assumption
output_type: message
style_compatible:
  - plain
  - bbs-1998
sections:
  question: required
  default_assumption: optional
quality_gate:
  - Must ask one question.
  - Must state the default assumption if work can continue without an answer.
---

I need one detail before I can finish this correctly:

**{{question}}**

Current assumption if unanswered: {{default_assumption}}
