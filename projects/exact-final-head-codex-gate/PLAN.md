---
id: exact-final-head-codex-gate
title: Exact Final-HEAD Codex Merge Gate
status: active
created: 2026-07-19
updated: 2026-09-10
issue: https://github.com/ArchonVII/repo-template/issues/206
---

# Exact Final-HEAD Codex Merge Gate — PLAN

## Current Work

This PR is the specification checkpoint. Gate implementation remains open under
[issue #206](https://github.com/ArchonVII/repo-template/issues/206).

Next: land the canonical workflow-provider implementation, then the repo-template
commands and policy, followed by integrator and selected consumer rollout. Each
implementation PR links to #206; no duplicate source-repository issue is required.

The [accepted specification](../../docs/agent-process/exact-final-head-codex-merge-gate.md)
owns behavior and trust boundaries. This capsule owns only current sequencing.

## Completed Dependencies

The original [Hudson repair #383](https://github.com/ArchonVII/hudson-bend/pull/383)
merged on 2026-07-21, and [feature #370](https://github.com/ArchonVII/hudson-bend/issues/370)
is closed. They are no longer blockers or completion criteria for this project.

## Phase Exit

A phase exits when its scoped implementation and required verification merge.
Keep #206 open for the remaining provider, command, and rollout work; update these
pointers as those phases finish. Record only qualifying durable owner decisions
under the repository's document policy. Finish this capsule when #206's remaining
acceptance criteria are met, using the existing project-capsule lifecycle.
