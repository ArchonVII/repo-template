---
id: partial.status-line
version: 1.0.0
audience: developer
status: active
owner: agents
last_updated: 2026-06-02
required_inputs:
  - status
optional_inputs:
  - confidence
  - last_updated
output_type: partial
style_compatible:
  - plain
  - bbs-1998
sections:
  status_line: required
quality_gate:
  - Must be short enough to scan at a glance.
---

**Status:** {{status}}
**Confidence:** {{confidence}}
**Last updated:** {{last_updated}}
