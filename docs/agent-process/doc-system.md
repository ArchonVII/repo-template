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
| `release` | at release-cut only | `docs:changelog` (`scripts/docs/changelog.mjs`) | no per-PR changelog edits |

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
  set from this list so it can never reference a doc it does not install. For this
  provider, the sibling `docs:baseline` generator unions that floor with the required installs in
  `.agent/archon-capabilities.json` and writes `.agent/startup-baseline.json`
  (fixes ArchonVII/archon-setup#290; delivered by repo-template#159).
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
  `docs/repo-update-log/` (fragment ledger, retired by S3 — #124), and the index itself.
- `llms.txt` (`nav`) + `README.md` (`status`) — deterministic projections of the
  doc-map + `docs/CANON.md` frontmatter (`scripts/docs/nav.mjs`). Committed-class
  output carries no timestamps: same inputs, byte-identical output.
- `docs/STATUS.md` — rendered-class dashboard (`scripts/docs/status.mjs`): open
  PRs/issues via `gh`, doc-health warning summary. Gitignored; degrades gracefully
  when `gh` is unavailable.

The provider's `.agent/startup-baseline.json` is a full-file committed output from
`required.base` plus its effective Archon capability profile. It deliberately uses
the sibling `npm run docs:baseline` command rather than the shared `generated` catalog:
that catalog is distributed to consumers, while this effective-profile projection is
repo-template-specific. `.agent/archon-capabilities.json` is pinned to an immutable
`ArchonVII/archon-setup` commit; update the projection from that source instead of
hand-editing startup paths.

## Commands

```bash
npm run docs:render            # regenerate all committed-class blocks in place
npm run docs:render -- --check # drift gate: exit 1 if any block is stale, write nothing
npm run docs:changelog         # fold release-class CHANGELOG.md [Unreleased] from git history
npm run docs:changelog -- --check  # release-cut drift check (not a PR gate — release-class)
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
| `changelog` | release-class: folded at release-cut by `docs:changelog`, no per-PR edit | auto-recorded release-class decision; never a per-PR fragment (#124 S3) |
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

## The blocking subset (L2)

`scripts/doc-health/health.mjs` splits findings by severity. Everything that predates
L2 stays a **warning** (budgets, review cadence, supersession, placeholders, stale
terms — dashboard food, never gate food). The **blocking** findings all come from the
doc-map contract and only exist when `.agent/doc-map.yml` does:

| code | fires when | scope |
| --- | --- | --- |
| `doc-map-invalid` | the spine exists but cannot be read/parsed (fails closed) | always |
| `required-doc-missing` | a `required.base` doc does not exist | always |
| `code-root-unmapped` | a top-level root is absent from `code_roots` | always |
| `code-root-mapping-invalid` | a `code_roots` value names no checked doc, or one whose `owns` matches no file under the root | always |
| `generated-block-stale` / `generated-block-check-failed` | a committed-class surface differs from regeneration, or the generators are unavailable/broken | always |
| `dangling-relative-link` (escalated) | a dead link in a `checked` doc declaring `links` | only when the doc is **re-triggered** |
| `path-ref-missing` | a backtick repo path in a `checked` doc declaring `path-refs` does not exist | blocking when re-triggered, warning otherwise |

Coverage validation is deliberately **root-granular**: a mapping is valid when the
named doc provably owns *something* under the root (per the epic's keystone-rot
contract — a NEW unmapped root blocks). Extension-scoped `owns` like
`tools/**/*.mjs` is a legitimate narrowing; per-file completeness inside a mapped
root is not enforced.

A `checked` doc is **re-triggered** when it changed or any path its `owns` globs cover
changed (`--changed <path>` / `--changed-from <git-ref>`); doc-path hits escalate at
file granularity (one ADR changing never weaponizes rot in a sibling), and
pre-existing rot elsewhere never blocks a PR that didn't touch it. Path-refs exempt
doc-map `rendered`/`release` paths, gitignored runtime paths (`git check-ignore`),
git-range shapes, directory mentions (a trailing `/` describes layout — often an
optional runtime dir — and is never existence-checked), and anything not anchored at
a real top-level root of this repo. The writing convention that follows: **backtick a
repo file path only if it exists at HEAD** — historical, proposed, or cross-repo
mentions go in plain prose or italics, and directory references keep their trailing
slash. The CLI exits `1` when blocking findings exist, `0` for warnings-only — the
exact contract P1 wires under `repo-required-gate / decision`.

## What blocks at PR time

S1 ships the generators and the `--check` drift gate as a local command; S2 ships the
4-section closeout DoD in the close-scan marker (enforced by `close:ci:guard` at
promotion); L2 ships the blocking doc-health subset above. Enforcement order (epic
lanes): P1 wires `docs:render --check` + `doc-health --changed-from` into
`repo-required-gate / decision` and removes the fragment caller examples from new
workflow guidance; **S3 (done, #124)** folded changelog generation to release-cut via
`scripts/docs/changelog.mjs`, deleted the repo-template fragment machinery (the
`.changelog/unreleased/` + `docs/repo-update-log/` trees and the
repo-update-log-fragment caller) and retired the fragment/changelog local checks in
`scripts/close`, and flipped repo-template's own gate caller to `docs-system: true`;
T1 snapshots the system into archon-setup onboarding; T2 dogfoods archon-setup itself.
Existing consumers keep their fragment callers until their later migration lane.
Warnings (stale terms, budgets, closed-issue refs) never block — they flow to the
dashboard.
