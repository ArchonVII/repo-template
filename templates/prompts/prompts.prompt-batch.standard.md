---
id: prompts.prompt-batch.standard
version: 1.0.0
audience: agent
status: active
owner: agents
last_updated: 2026-06-15
use_when:
  - Dispatching two or more implementer prompts as one batch (one per lane, issue, or repo).
avoid_when:
  - Sending a single prompt; use prompts.prompt-builder.standard or agent.handoff.standard.
required_inputs:
  - batch_title
  - prompt_count
  - prompt_manifest
  - per_prompt_blocks
optional_inputs:
  - sequencing
  - shared_context
output_type: prompt
style_compatible:
  - plain
  - bbs-1998
sections:
  batch_manifest: required
  sequencing: optional
  shared_context: optional
  numbering_rules: required
  prompt_block: required
quality_gate:
  - The manifest count must equal the number of prompt blocks, so a missing or duplicated prompt is visible before work starts.
  - Prompts must form one sequential 1..N run with no gaps or repeats; sub-parts nest as na/nb inside a single prompt, never as their own top-level number.
---

# Prompt Batch: {{batch_title}}

A batch is an ordered set of independent implementer prompts dispatched together.
Keep presentation out of this structure: render the boundaries with a style skin
(see `styles/bbs-1998.md` for the BBS banners that make each prompt's start and stop
unmissable).

## Batch manifest

This batch has **{{prompt_count}}** prompts. Read every one — the count is stated here
so a missing or duplicated prompt is obvious before you start.

{{prompt_manifest}}

<!-- One line per prompt, in order, e.g.
1. Doc-health checker  - ArchonVII/repo-template     #74  (parts a, b)
2. Doc-policy-lint     - ArchonVII/github-workflows  #70  (parts a, b)
-->

## Sequencing

{{sequencing}}

<!-- Dependencies and order between prompts, or "Independent - run in parallel." -->

## Shared context

{{shared_context}}

<!-- Context that applies to every prompt, stated once instead of repeated per prompt. -->

## Numbering rules

- One sequence, `1..{{prompt_count}}`, with no gaps and no repeats.
- A prompt that splits into pieces keeps **one** number; the pieces are `{{n}}a`,
  `{{n}}b`, ... **inside** that prompt. A sub-part never gets its own top-level number.
- A lane, phase, or rollout id (e.g. `lane 3a`) is metadata on a prompt, never the
  prompt's sequence number.

---

## Prompt {{n}} of {{prompt_count}} — {{prompt_title}}

- **Target:** {{repo}} #{{issue}}
- **Lane / tag:** {{lane_id}} <!-- optional metadata; omit the line if none -->
- **Sub-parts:** {{subparts}} <!-- e.g. "a, b"; omit the line if none -->

### Role

{{role}}

### Read first

{{read_first}}

### Setup

{{setup}}

### Task

{{task}}

### Sub-parts

{{subpart_detail}}

<!-- Required only when the prompt has sub-parts. One block per part, e.g.
  - **{{n}}a — <label>:** what this part adds.
  - **{{n}}b — <label>:** what this part adds.
Sub-parts are part of this prompt's scope; they do not consume a sequence number. -->

### Constraints

{{constraints}}

### Verification

{{verification}}

### Done

{{done}}

<!-- Repeat the "Prompt {{n}} of {{prompt_count}}" block for each prompt, incrementing
     {{n}}. Do not restart, skip, or reuse a number. The number of repeated blocks must
     equal {{prompt_count}} from the manifest. -->
