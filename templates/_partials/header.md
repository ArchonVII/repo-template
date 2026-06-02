---
id: partial.header
version: 1.0.0
audience: developer
status: active
owner: agents
last_updated: 2026-06-02
required_inputs:
  - template_title
optional_inputs:
  - template_id
  - version
output_type: partial
style_compatible:
  - plain
  - bbs-1998
sections:
  header: required
quality_gate:
  - Must identify the artifact clearly.
---

# {{template_title}}

{{#template_id}}`{{template_id}}`{{/template_id}}{{#version}} version {{version}}{{/version}}
