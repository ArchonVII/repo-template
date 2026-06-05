---
id: github.issue.standard
version: 1.0.0
audience: developer
status: active
owner: agents
last_updated: 2026-06-02
use_when:
  - Drafting a task issue before agent implementation work begins.
avoid_when:
  - The repository has a stricter native issue form that must be used directly.
required_inputs:
  - problem
  - goal
  - scope
  - acceptance_criteria
optional_inputs:
  - non_goals
  - dependencies_or_blockers
  - status
  - execution_gate
output_type: github_artifact
style_compatible:
  - plain
sections:
  problem: required
  goal: required
  scope: required
  non_goals: optional
  acceptance_criteria: required
  dependencies_blockers: optional
  status: optional
  execution_gate: optional
quality_gate:
  - Must include explicit, testable acceptance criteria.
  - Must state whether execution is allowed or blocked.
---

## Problem

{{problem}}

## Goal

{{goal}}

## Scope

{{scope}}

## Non-Goals

{{non_goals}}

## Acceptance Criteria

{{acceptance_criteria}}

## Dependencies / Blockers

{{dependencies_or_blockers}}

## Status

{{status}}

## Execution Gate

{{execution_gate}}
