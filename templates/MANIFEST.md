---
id: templates.manifest
version: 1.0.0
audience: developer
status: active
owner: agents
last_updated: 2026-06-02
output_type: report
style_compatible:
  - plain
quality_gate:
  - Must list every active MVP template by stable ID.
---

# Template Library Manifest

| ID | Name | Category | Audience | Status | Description |
| --- | --- | --- | --- | --- | --- |
| agent.final-response.standard | Final Response | agent | user | active | Standard completed-work response. |
| agent.presentation-message.standard | Presentation Message | agent | user | active | Polished wrapper for a deliverable, proposal, or reusable artifact. |
| agent.progress-update.standard | Progress Update | agent | user | active | Short status update during longer work. |
| agent.clarification-request.standard | Clarification Request | agent | user | active | One-question input request when assumptions would be risky. |
| agent.blocked-or-partial.standard | Blocked Or Partial Result | agent | user | active | Partial result when completion is blocked. |
| agent.handoff.standard | Handoff | agent | internal | active | Continuation packet for another agent, thread, or person. |
| prompts.prompt-builder.standard | Prompt Builder | prompts | developer | active | Creates reusable prompts from goals, context, and constraints. |
| prompts.prompt-spec.standard | Prompt Spec | prompts | developer | active | Documents what a prompt is supposed to do. |
| prompts.prompt-run-request.standard | Prompt Run Request | prompts | agent | active | Standard request to execute a prompt against inputs. |
| prompts.prompt-run-report.standard | Prompt Run Report | prompts | user | active | Reports what happened during prompt execution. |
| prompts.prompt-review.standard | Prompt Review | prompts | developer | active | Evaluates and revises a prompt as a maintainable artifact. |
| prompts.prompt-batch.standard | Prompt Batch | prompts | agent | active | Dispatches multiple implementer prompts as one batch with sequential numbering and nested sub-parts. |
| reports.findings-report.standard | Findings Report | reports | user | active | Structured research, audit, or inspection report. |
| reports.decision-memo.standard | Decision Memo | reports | reviewer | active | Captures a decision, options, tradeoffs, and follow-up. |
| github.issue.standard | Issue | github | developer | active | Task issue body with scope and acceptance criteria. |
| github.pull-request.standard | Pull Request | github | reviewer | active | PR body compatible with the shared ArchonVII PR contract. |
| operations.task-intake.standard | Task Intake | operations | internal | active | Intake shape for turning a request into scoped work. |

## Partials

| ID | Purpose |
| --- | --- |
| partial.header | Reusable template header metadata display. |
| partial.status-line | Status, confidence, and updated timestamp. |
| partial.context | Relevant task or artifact context. |
| partial.assumptions | Explicit assumptions and their effect. |
| partial.evidence | Evidence items with source, support, and confidence. |
| partial.risks | Risks, unknowns, and mitigation path. |
| partial.next-actions | Owner-bound next actions. |
| partial.open-questions | Open questions that require resolution. |
| partial.footer | Standard status footer. |
