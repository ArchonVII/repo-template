---
id: exact-final-head-codex-gate
title: Exact Final-HEAD Codex Merge Gate
status: active
created: 2026-07-19
updated: 2026-07-19
issue: https://github.com/ArchonVII/repo-template/issues/206
---

# Exact Final-HEAD Codex Merge Gate — PLAN

## Agent Quickload

- **Current state:** Cross-repository design approved; repo-template implementation has not started.
- **Next safe action:** Land this specification checkpoint, open the workflow-provider issue/lane, then implement repo-template issue #206 after its provider dependency is named.
- **Main blocker:** The canonical evaluator workflow does not yet exist in `ArchonVII/github-workflows`.
- **Do not change:** Exact-SHA evidence, default-branch-only dispatch with exact run/job correlation, App-pinned server enforcement, native all-thread resolution, no automatic exemptions, current-admin SHA waiver, admin enforcement, two-surface protection audit, or merge-queue rejection without owner-approved spec amendment.
- **Read first:** [`docs/agent-process/exact-final-head-codex-merge-gate.md`](../../docs/agent-process/exact-final-head-codex-merge-gate.md) and [repo-template issue #206](https://github.com/ArchonVII/repo-template/issues/206).

## Why / What Was Asked For

Recent PRs merged before GitHub Codex completed and returned material findings. The owner requires a durable exact-final-HEAD merge prerequisite before the Hudson Bend repair merges or its paused #370 feature lane resumes.

## Scope

- **In:** Cross-repo sequencing, stable invariants, and links to each owner repository's implementation lane.
- **Out:** Duplicating workflow bodies, Archon implementation plans, or Hudson repair details in this capsule.
- **Later:** Dedicated publisher App hardening and a separately designed merge-queue evidence model.

## Invariants

- Missing, stale, ambiguous, or timed-out Codex evidence never becomes success.
- Reactions and Copilot output never count.
- The GitHub merge surface and blessed local wrapper both enforce the exact captured SHA.
- Every implementation remains in its canonical owner repo and normal issue/worktree/PR lane.

## Source Links

- **Specification:** [`docs/agent-process/exact-final-head-codex-merge-gate.md`](../../docs/agent-process/exact-final-head-codex-merge-gate.md)
- **Repo-template issue:** https://github.com/ArchonVII/repo-template/issues/206
- **Blocked Hudson repair:** https://github.com/ArchonVII/hudson-bend/pull/383
- **Paused Hudson feature:** https://github.com/ArchonVII/hudson-bend/issues/370
- **Workflow-provider issue:** not yet created; this is the next project action.
- **Archon integrator issue:** not yet created; required before snapshot/protection implementation.

## Phase Exit And Closeout

1. Repo-template phase exits when #206's commands, policy, distribution manifest, tests, and exact-final-HEAD Codex review merge. Record the owner decisions in `docs/decisions/decision-log.md` and narrow this capsule to the named downstream lanes.
2. Integrator/consumer phases remain blocked until their own source-repo issues exist and their provider SHAs are explicit.
3. The project finishes only after Hudson Bend PR #383 merges under the new gate, canonical `main` is audited clean, and the paused #370 lane is safe to resume. Then move this capsule to `projects/_finished/<date>-exact-final-head-codex-gate/` and set `status: finished`.

## Agent Handoff

Before work: read this PLAN, the specification, and the target repo's issue; verify the source-of-truth boundary. After meaningful changes: update only this capsule's state/pointers, not downstream implementation detail.
