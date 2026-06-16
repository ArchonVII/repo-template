---
id: styles.plain
version: 1.0.0
audience: developer
status: active
owner: agents
last_updated: 2026-06-02
output_type: report
quality_gate:
  - Must preserve template structure without adding visual ornament.
---

# Plain Style Guide

Plain style is the default rendering target.

## Rules

- Use GitHub-flavored Markdown.
- Keep section headers direct and short.
- Prefer paragraphs and short flat lists.
- Use code fences for commands, evidence blocks, and examples.
- Do not add decorative dividers.
- Do not add visual skinning that changes the template's meaning.

## Message banner

Output that follows the message protocol (`docs/agent-process/message-protocol.md`) leads
with a one-line **bold status banner** carrying exactly one tag, then a `## For you` lane
(omit it entirely for a state tag) and the work detail under `## My work`. Render the tag
bold; an emoji marker is allowed in plain style (e.g. `🟢 SAFE TO CLEAR`,
`⚙ TECHNICAL DECISION`). Never bury the verdict or the required action below the fold.
