---
id: partial.footer
version: 1.0.0
audience: developer
status: active
owner: agents
last_updated: 2026-06-02
required_inputs:
  - status
optional_inputs:
  - confidence
output_type: partial
style_compatible:
  - plain
  - bbs-1998
sections:
  footer: required
quality_gate:
  - Must close the artifact without adding new information.
---

---

Status: {{status}}
Confidence: {{confidence}}
