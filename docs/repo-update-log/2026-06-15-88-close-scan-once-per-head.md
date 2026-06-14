## 2026-06-15 - Close-scan guard: run once per HEAD

- **Issue/PR:** (quick fix, no issue) / #88
- **Branch:** agent/claude/2026-06-13-close-scan-once-per-head
- **Changed paths:** AGENTS.md, docs/repo-update-log/2026-06-15-88-close-scan-once-per-head.md
- **What changed:** Reworded the **Local Delivery Guards** cadence in `AGENTS.md` so `close:ci:guard` is run **once per `HEAD`** (it is idempotent against `HEAD`) instead of being re-run before each of `agent:close-preflight` / `agent:pr-ready` / merge; a single passing run covers every delivery gate while `HEAD` is unchanged. Also bounds post-ready reads to one confirming status check rather than repeated re-polls / status snapshots / review-thread re-listings on an unchanged green PR.
- **Verification:** Doc-only change (`AGENTS.md` + this fragment). `npm test` green (see PR).
- **Propagation:** pending archon-setup snapshot refresh + consumer `AGENTS.md` (hudson-bend) — handled in the same gamemaster repair (`gm-20260613-223646-ae95b590`). Addresses observed churn (`close:ci:guard` run 3×, repeated PR status snapshots + review-thread re-reads) in a Codex session on ArchonVII/hudson-bend#188.
