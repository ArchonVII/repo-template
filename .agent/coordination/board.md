# Coordination Board

> Active multi-agent coordination for **this repo only**. Do not reference other repos
> or any machine-global board. Delete this file if this repo does not do active
> coordination.

## Active claims

| Agent    | Lane / branch | Files or area claimed | Renewed / expires | Status |
| -------- | ------------- | --------------------- | ------ | ------ |
| _(none)_ |               |                       |        |        |

**Claim format:** one row per active lane. Claim the narrowest file set you can. Release
by removing your row before pausing, handing off or ending the session, even if its PR
remains open. Reacquire before resumed edits; renew only while working, with a maximum
24-hour lease. See [the coordination contract](README.md#claim-lifetime).

## Handoff routing

Use this section only if this board is the repo's existing status entry point;
otherwise link to the designated status document or workstream issue instead.

| Scope | Workstream issue / PR | Branch | Checkpoint revision | Canonical handoff |
| ----- | --------------------- | ------ | ------------------- | ----------------- |
| _(none)_ | | | | |

Replace a scope's pointer when superseded; do not append competing current instructions.
Claims above are temporary editing reservations, not the list of open workstreams.

## High-contention files

Files that require sequencing — only one lane at a time. Empty by default.

- _(none yet)_

## Stale-claim cleanup

A claim is stale when its lease expires or its branch is retired. An open PR or existing worktree does not renew it. Any agent may remove a stale row and note the removal in the
relevant lane's PR. Preserve unfinished files and branches; claim expiry is not abandonment evidence for automatic artifact recovery.

## Worktree conventions

Document how this repo uses git worktrees for parallel lanes, if at all.

- _(document conventions here)_
