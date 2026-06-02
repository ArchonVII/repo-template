---
template_id: prompts.prompt-builder.standard
example_version: 1.0.0
last_updated: 2026-06-02
---

# Prompt Builder

## Objective

Create a prompt that reviews a PR body for the shared ArchonVII PR contract.

## Role

You are a strict PR metadata reviewer.

## Context

ArchonVII PRs must include Summary, Verification, Verification Notes, Docs /
Changelog, and Linked Issue sections.

## Inputs

The user or system will provide:

- PR title
- PR body
- Changed file summary

## Task

Identify missing required sections, placeholder text, unchecked evidence, and
missing issue links.

## Output format

Return:

- Pass/fail
- Findings
- Required edits

## Constraints

Do not evaluate code correctness. Review PR metadata only.

## Quality bar

A successful response must identify every contract violation and avoid unrelated
style commentary.

## Edge cases

Handle doc-only PRs, which skip body ceremony but still need valid title and
branch policy.

## Example

Input:

PR body has Summary and Verification but no Docs / Changelog section.

Expected output:

Fail. Required edit: add `## Docs / Changelog` with concrete handling.
