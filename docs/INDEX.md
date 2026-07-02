---
summary: Map of content for this repo's wiki — the entry index agents scan to find the right page.
status: CURRENT
confidence: EXTRACTED
updated: 2026-06-15
relates:
  - "[[CANON]]"
  - "[[LIBRARIAN]]"
  - "[[project-status]]"
depends-on: []
supersedes: []
superseded-by: []
contradicts: []
---

# INDEX — Map of Content

The map of this repo's wiki. Add a one-line pointer here when you create a durable page so
agents can find it.

## Canonical navigation layer

- [CANON](CANON.md) — ground-truth register; read first.
- [LIBRARIAN](LIBRARIAN.md) — wiki schema and operating contract.
- [project-status](project-status.md) — live workstreams, backlog, decision log.

## Pages

<!-- BEGIN ARCHONVII MANAGED BLOCK: index-pages -->
_Generated from docs/**/*.md frontmatter by `npm run docs:render` — do not edit by hand._

- [CANON.md](CANON.md) — High-density register of what is true for this repo now vs. intended, plus locked decisions — read first. (Scaffold — fill per repo.) `CANON`
- [LIBRARIAN.md](LIBRARIAN.md) — The schema and operating contract for this repo's agent-maintained wiki — read before any wiki maintenance. `CANON`
- [project-status.md](project-status.md) — Live workstreams, backlog, and decision log for this repo — what is in flight right now. (Scaffold — fill per repo.) `CURRENT`
- [repo-update-log.md](repo-update-log.md)
- [template-library-inventory.md](template-library-inventory.md)

### adr/

- [001-primary-checkout-worktree-policy.md](adr/001-primary-checkout-worktree-policy.md) `Accepted`
- [README.md](adr/README.md) `Proposed / Accepted / Superseded by NNN`

### agent-process/

- [doc-health.md](agent-process/doc-health.md) `active`
- [doc-sweep.md](agent-process/doc-sweep.md) `Design approved with amendments (2026-06-02); h…`
- [doc-system.md](agent-process/doc-system.md) — Contract for the self-maintaining docs system — doc classes by input volatility, the doc-map spine, generators, and what blocks at PR time. `CURRENT`
- [document-policy.md](agent-process/document-policy.md) `active`
- [message-protocol.md](agent-process/message-protocol.md) `active`
- [project-capsules.md](agent-process/project-capsules.md) `intake`

### audits/

- [README.md](audits/README.md)

### decisions/

- [decision-log.md](decisions/decision-log.md) `active`

### plans/

- [README.md](plans/README.md)

### superpowers/

- [2026-06-01-agent-lifecycle-command-surface.md](superpowers/plans/2026-06-01-agent-lifecycle-command-surface.md)
<!-- END ARCHONVII MANAGED BLOCK: index-pages -->
