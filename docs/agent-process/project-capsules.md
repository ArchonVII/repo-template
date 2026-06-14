# Project capsules

A **project capsule** is the one guessable place an agent looks to understand a
feature before touching its code: one folder per feature, one required file.

## Where

`projects/<slug>/PLAN.md` — the required front door.

- `<slug>` is a bare, human, guessable name (`inventory-screen`), never typed
  (`FEAT-…`). Active slugs are unique under `projects/`; on collision add a short
  qualifier (`inventory-screen-v2`), not a numeric counter.
- Optional, only once they outgrow `PLAN.md`: `decisions.md`, `research.md`,
  `assets/` (images/diagrams only). These are *rollups that link to* the canonical
  `docs/adr/**` and `docs/research/**` — never substitutes.
- Done/abandoned capsules move (manual `git mv` in v1) to
  `projects/_finished/<YYYY-MM-DD>-<slug>/` (shipped) or
  `projects/_archive/<YYYY-MM-DD>-<slug>/` (abandoned/superseded).

`PLAN.md` **links out** to specs, ADRs, research, issues, and PRs. It owns the
summary and the pointers — one home per fact, never a second copy.

## When to create one

Create a capsule for work that spans **more than one session or one PR**, or that
carries **owner-facing scope/invariants** future agents must preserve. One-off
fixes do not need a capsule. Absence of a capsule is not a signal — if you need
orientation and there is none, read the linked specs/issues.

## PLAN.md template

Frontmatter stays lean; the dependency/decision tables are optional and added only
when they have real content (avoid empty-section graveyards).

```markdown
---
id: <slug>
title: <Feature Name>
status: intake          # intake | active | paused | finished | archived
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
issue:                  # optional
---

# <Feature Name> — PLAN

## Agent Quickload
- **Current state:**
- **Next safe action:**
- **Main blocker:** none
- **Do not change:**
- **Read first:**

## Why / what was asked for

## Scope
- **In:**  · **Out:**  · **Later:**

## Invariants
-

## Source links
- Specs:  · ADRs:  · Research:  · Issues/PRs:

## Agent handoff
Before: read this PLAN, check the blocker, preserve invariants.
After meaningful changes: update Current state + `updated:`.

<!-- Add only when it has real content: End-to-end plan · Dependencies & blockers · Decisions & pivots -->
```

## Lifecycle (v1 = manual)

`status:` is one of `intake | active | paused | finished | archived`. "blocked" is
a note in the body, not a status.

- Create → copy the template to `projects/<slug>/PLAN.md`, `status: intake`.
- Advance → edit `status:` and bump `updated:`.
- Finish / archive → `git mv` the folder into `_finished/` / `_archive/` and set
  `status`.

A deterministic `project-plan` engine that automates these moves and regenerates a
`projects/README.md` index is planned but **deferred** until manual moves prove
painful.

## Relationship to docs/plans/

`docs/plans/**` is loose/legacy. Once a repo has a `projects/` capsule, do **not**
create new `docs/plans/**` files for feature work. Existing plans stay until an
*active or actively-referenced* one is migrated one at a time (grep and fix inbound
links when you move it). No bulk migration.

## Owner-safe files

Under `projects/**`, only `*.md` and image/diagram files
(`png` / `jpg` / `jpeg` / `gif` / `webp` / `svg`, `drawio`) are
owner-maintenance-safe. Never put code, config, scripts, workflows, manifests,
lockfiles, binaries, or secrets here.
