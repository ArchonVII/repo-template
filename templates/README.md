---
id: templates.readme
version: 1.0.0
audience: developer
status: active
owner: agents
last_updated: 2026-06-02
output_type: report
style_compatible:
  - plain
  - bbs-1998
quality_gate:
  - Must explain how to find, edit, and extend the template library.
  - Must keep content structure separate from presentation style.
---

# Template System

This directory is the source of truth for reusable template structure. It is not
a pile of finished messages. Each template defines purpose, required inputs,
section rules, output type, style compatibility, and quality gates.

## Design Rules

Every template should answer:

- What is this for?
- Who is this for?
- What inputs does it need?
- What output does it produce?
- Which sections are required, optional, or suppressed?
- How do we know it succeeded?
- Which style skins can render it?

## Anatomy

Every template uses stable frontmatter:

```yaml
---
id: category.intent.variant
version: 1.0.0
audience: user
status: active
owner: agents
last_updated: 2026-06-02
use_when:
  - Use case.
avoid_when:
  - Non-use case.
required_inputs:
  - input_name
optional_inputs:
  - input_name
output_type: message
style_compatible:
  - plain
  - bbs-1998
sections:
  context: optional
  main_content: required
quality_gate:
  - Must answer the actual request.
---
```

The body should stay plain Markdown. Do not bake BBS, executive, or other visual
skins into the structural template.

## Categories

| Category | Purpose |
| --- | --- |
| `_partials/` | Reusable blocks used inside many templates. |
| `agent/` | User-facing and internal agent messages. |
| `prompts/` | Prompt creation, execution, review, and reporting. |
| `reports/` | Findings, decisions, implementation summaries, and QA outputs. |
| `github/` | Issues, PRs, reviews, bugs, releases, and changelog entries. |
| `operations/` | Task intake, status, notes, action plans, and handoffs. |

## Naming

Use `category.intent.variant.md` as the template file name and ID.

Examples:

- `agent.final-response.standard`
- `prompts.prompt-builder.standard`
- `reports.findings-report.standard`
- `github.pull-request.standard`

## Extension Rules

- Add a template only after repeated use shows it is distinct from an existing
  template.
- Prefer partials for shared blocks such as assumptions, evidence, risks, and
  next actions.
- Add or update examples when a template introduces new section behavior.
- Update [`MANIFEST.md`](MANIFEST.md) whenever a template is added, renamed, or
  retired.
