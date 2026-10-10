# Coordination

This repo is **coordination-isolated**. It coordinates only itself, and
`.agent/coordination/` is canonical for durable repository coordination.

- Machine-global staging and handoffs may be transport queues, but never durable repo authority.
- Ephemeral runtime claims and locks may remain machine-local operational state.
- Do not assume sibling repositories exist.
- Do not reference another repo unless this repo explicitly documents that dependency.

## Where coordination lives

All durable coordination state for this repo lives under `.agent/coordination/`:

```
.agent/coordination/
  README.md      # this contract (always present)
  board.md       # active multi-agent board (only if this repo does active coordination)
  claims/        # per-agent file claims / locks (optional)
  handoffs/      # cross-session handoff notes (optional)
  references/    # documented dependencies on other repos, if any (optional)
```

`README.md` is the only file guaranteed to exist. Everything else is created on demand,
when this repo actually needs active coordination.

## Claim lifetime

A claim reserves files for active editing, not for the lifetime of a branch or PR.
Release it before pausing, bookmarking, handing off, or ending a session. Reacquire
before resumed edits. Keep unfinished code and the PR; release only the reservation.

Claims have a maximum 24-hour lease, renewed only by the working agent. Claim tools
must enforce expiry during claim/check/prune and show the deadline in status.
Timestamped legacy claims expire 24 hours after their last claim/renewal; an undated
claim is unverified, never indefinite ownership. A linked worktree, dirty files or
an open PR alone do not establish a live competing writer.

Prune expired reservations before reporting a conflict to the owner. No additional
owner approval is needed solely to release an expired reservation. A live competing
writer or unresolved liveness still requires coordination before overlapping edits.
Expiry is not permission to delete, reset, commit or overwrite someone else's work;
automatic artifact recovery retains its separate, conservative safety checks.
## Enabling an active board

If multiple agents (or people) work this repo concurrently, create or keep `board.md`
here and record: claim format, high-contention files that need sequencing, stale-claim
cleanup rules, and worktree conventions. A starter template ships via the archon-setup
`coordination-board` feature; you can also write your own.

## Handoff authority

Use this repo's existing board, status document or workstream issue to route readers
to the authoritative handoff for each scope. Include its canonical path/link, branch
and checkpoint revision, plus the issue/PR that shows current lane status. Do not
create a second competing project-status ledger or choose a handoff by filename date.

Each worktree's handoff covers only that lane. Project-wide current truth stays in
the repo's designated current-truth documents. Keep plans and handoffs durable through
normal repository delivery even when live claims and locks are untracked. Viewing
copies identify their canonical source; a localhost link alone cannot route a remote
agent to this repo.

Write only after the reported state has settled, and replace obsolete next steps in
active records. Before resuming, check the referenced revision and the lane's current
issue/PR state. See [document policy](../../docs/agent-process/document-policy.md#handoffs-and-plans).

## Tracked vs. untracked

This repo owns the **contract** (`README.md`). Whether live coordination state
(`board.md`, `claims/`, locks) is committed, `.gitignore`d, or handled through issues and
PRs is this repo's choice — setup does not assume one collaboration model.
