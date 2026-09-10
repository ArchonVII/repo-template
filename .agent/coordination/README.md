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

## Enabling an active board

If multiple agents (or people) work this repo concurrently, create or keep `board.md`
here and record: claim format, high-contention files that need sequencing, stale-claim
cleanup rules, and worktree conventions. A starter template ships via the archon-setup
`coordination-board` feature; you can also write your own.

## Tracked vs. untracked

This repo owns the **contract** (`README.md`). Whether live coordination state
(`board.md`, `claims/`, locks) is committed, `.gitignore`d, or handled through issues and
PRs is this repo's choice — setup does not assume one collaboration model.
