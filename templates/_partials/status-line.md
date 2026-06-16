---
id: partial.status-line
version: 1.1.0
audience: developer
status: deprecated
owner: agents
last_updated: 2026-06-15
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

> **Deprecated.** Superseded by `partial.status-banner` — the message-protocol banner that
> distinguishes ask-vs-state and machine-backs `SAFE TO CLEAR`
> (`docs/agent-process/message-protocol.md`). Kept for back-compat; do not use in new templates.

**Status:** {{status}}
**Confidence:** {{confidence}}
**Last updated:** {{last_updated}}
