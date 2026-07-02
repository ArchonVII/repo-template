---
summary: Contract for the self-maintaining docs system — doc classes by input volatility, the doc-map spine, generators, and what blocks at PR time.
status: CURRENT
confidence: DESIGNED
updated: 2026-07-02
relates:
  - "[[CANON]]"
  - "[[INDEX]]"
depends-on: []
supersedes: []
superseded-by: []
contradicts: []
---

# Doc System — the self-maintaining docs contract

Source design: ArchonVII/repo-template#124 (red-teamed 2026-06-27; supersedes the
doc-policy approach in #223). One diff-scoped doc engine, docs classified by **input
volatility**, enforced on the existing `repo-required-gate / decision`.

## The volatility rule (load-bearing)

Never commit-and-drift-gate a doc whose inputs are volatile (live GitHub state, git
history): it false-fails merges when the world moved with no code change. Every
generated doc therefore declares one of three classes in `.agent/doc-map.yml`:

| class | committed? | regenerated | gated |
| --- | --- | --- | --- |
| `committed` | yes, inside the PR | `npm run docs:render` | yes — `docs:render --check` drift gate (wired in P1) |
| `rendered` | never | `npm run docs:status` on demand / post-merge | never |
| `release` | at release-cut only | `docs:changelog` (lands in S3) | no per-PR changelog edits |

## The spine: `.agent/doc-map.yml`

Sibling of `check-map.yml`; the generators and the docs-gate read ONLY this file to
decide what to regenerate / check / heal for a change set (no full-repo doc grep in the
PR hot path). Sections:

- `generated` — machine-truth-in, doc-out surfaces with their class, generator, and
  managed-block id.
- `checked` — human-authored, machine-verified docs; `owns` globs say which code paths
  re-trigger their checks (rules live in `scripts/doc-health`).
- `human` — authorial prose; `heal_when` globs scope the bounded same-PR L3 heal
  (never blanket `src/**`; `VISION.md` is never auto-healed — owner decision 2026-06-27).
- `required.base` — the doc floor every repo carries; onboarding derives its required
  set from this list so it can never reference a doc it does not install
  (fixes ArchonVII/archon-setup#290; consumed in T1).
- `code_roots` — the keystone-rot guard: every top-level code root is owned by a
  `checked` doc or explicitly `unmapped_ok`; a NEW unmapped root blocks.

## Generated surfaces and managed blocks

Generators write only between ecosystem-standard markers:

```
<!-- BEGIN ARCHONVII MANAGED BLOCK: <id> -->
<!-- END ARCHONVII MANAGED BLOCK: <id> -->
```

Missing markers throw — generators never append blocks silently. Current surfaces:

- `docs/INDEX.md` (`index-pages`) — walked from `docs/**/*.md` frontmatter
  (`scripts/docs/index.mjs`); excludes `docs/raw/` (immutable intake),
  `docs/repo-update-log/` (fragment ledger, retired in S3), and the index itself.
- `llms.txt` (`nav`) + `README.md` (`status`) — deterministic projections of the
  doc-map + `docs/CANON.md` frontmatter (`scripts/docs/nav.mjs`). Committed-class
  output carries no timestamps: same inputs, byte-identical output.
- `docs/STATUS.md` — rendered-class dashboard (`scripts/docs/status.mjs`): open
  PRs/issues via `gh`, doc-health warning summary. Gitignored; degrades gracefully
  when `gh` is unavailable.

## Commands

```bash
npm run docs:render            # regenerate all committed-class blocks in place
npm run docs:render -- --check # drift gate: exit 1 if any block is stale, write nothing
npm run docs:status            # render docs/STATUS.md (never commit it)
npm run close:dod -- --section <docs|changelog|verification|findings> --decision "<text>"
                               # capture one closeout-DoD decision as it is made (S2)
```

## The closeout DoD (S2)

Closing a lane means answering exactly four questions — the DoD sections — and the
close-scan marker (`.agent/close-scan/complete.json`, version 2) binds all four to the
final HEAD:

| section | what it answers | scope scaling |
| --- | --- | --- |
| `docs` | were doc-map-owned docs updated for this diff, and if not, why? | auto-passes for docs-only diffs, untriggered diffs, and repos without a doc-map |
| `changelog` | fragment / direct edit / not required? | auto-defaults for docs-only diffs |
| `verification` | what was run and what did it prove? | always substantive |
| `findings` | anomalies / follow-ups routed or none found? | always substantive |

The `docs` section is driven by the spine: `checked.owns` and `human.heal_when` globs
are matched against the diff. A triggered doc must be updated in the same PR, or the
close carries a substantive `--docs-decision` explaining why not, or the PR carries the
**`docs:waived` label plus a substantive reason** — the waiver is recorded in the
marker and counted on the STATUS dashboard (owner decision 2026-06-27: waivers stay
visible, they never accumulate silently).

Decisions are captured **incrementally** with `npm run close:dod` the moment they are
made — the capture (`.agent/close-scan/dod.json`, gitignored) survives reboots and
context loss, and `close:scan:complete` folds it into the marker as defaults (explicit
flags win). Each capture also refreshes the lane's task claim (below).

## Coordination bookend (S2)

A lane's `.agent/current-task.json` (written by `agent:start-task`) **is** its
doc-sweep claim — no separate claim file. The synthesized claim covers the whole
worktree on the task's branch and stays live for 24h from `lastActivityAt` (refreshed
by every `close:dod` capture) or `createdAt`. A live claim makes doc-sweep skip the
lane's in-flight docs; an **expired** claim is the positive death signal that makes an
abandoned lane's docs eligible for recovery.

## What blocks at PR time

S1 ships the generators and the `--check` drift gate as a local command; S2 ships the
4-section closeout DoD in the close-scan marker (enforced by `close:ci:guard` at
promotion). Enforcement order (epic lanes): P1 wires `docs:render --check` + the
diff-scoped blocking doc-health subset (dead links, path-refs, required-existence,
doc-map coverage, generated-block-clean) into `repo-required-gate / decision` and
retires the fragment workflows; S3 folds changelog generation to release-cut and
deletes the fragment machinery; T1 snapshots the system into archon-setup onboarding;
T2 dogfoods archon-setup itself. Warnings (stale terms, budgets, closed-issue refs)
never block — they flow to the dashboard.
