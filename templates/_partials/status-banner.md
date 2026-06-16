---
id: partial.status-banner
version: 1.0.0
audience: developer
status: active
owner: agents
last_updated: 2026-06-15
required_inputs:
  - tag
optional_inputs:
  - one_line
  - risk_overlay
output_type: partial
style_compatible:
  - plain
  - bbs-1998
sections:
  banner: required
quality_gate:
  - Must carry exactly one primary tag from the message protocol.
  - SAFE TO CLEAR must not emit marker=verified without the close-scan marker.
---

The lead banner for a turn-terminal message: exactly one primary tag from the message
protocol ([`docs/agent-process/message-protocol.md`](../../docs/agent-process/message-protocol.md)).
`⚠ RISK` rides on an ask (`⚠ RISK · REVIEW`); it is never a standalone tag. See `styles/` for
how each skin renders this — plain uses a bold marker line, bbs-1998 uses a bracket label.

Tags: `TECHNICAL DECISION` · `CREATIVE DECISION` · `REVIEW` · `PROVIDE DATA` · `PROMPT PACKET`
(+ `⚠ RISK` overlay) · `SAFE TO CLEAR` · `NOT DONE` · `JUDGMENT CALL` · `FYI`.

Plain:

**{{tag}}** — {{one_line}}

bbs-1998:

[ {{tag}} ] {{one_line}}

This partial supersedes `partial.status-line` (a status/confidence/updated header with no
ask-vs-state signal and no machine-backing).
