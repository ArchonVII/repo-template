# Document Policy

> **Status:** active
> **Owner:** ecosystem
> **Scope:** repo-local document control
> **Source of truth:** yes
> **Last reviewed:** 2026-06-15
> **Supersedes:** none
> **Superseded by:** none

This file is the per-repo document-control contract. `AGENTS.md` carries the short
agent-facing pointer; this file owns the full rules.

## Binding Rules

1. Every durable document answers one clear question and has one canonical home.
2. The first screen of an agent-read document must contain binding rules or links to them.
3. Long rules use a short `AGENTS.md` contract plus a detail doc in `docs/agent-process/`.
4. Distributor-maintained sections use managed blocks.
5. Docs over their charter budget move detail down the hierarchy instead of growing forever.
6. Doc-health tools report drift; they do not rewrite durable docs.

## Source-Of-Truth Hierarchy

| Layer             | Owns                                                                      | Canonical location           | Propagation rule                                                           |
| ----------------- | ------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------- |
| Org defaults      | Issue templates, PR templates, human-facing starter policy                | `ArchonVII/.github`          | Repos inherit unless they define local overrides.                          |
| Workflow provider | Reusable workflow bodies and example callers                              | `ArchonVII/github-workflows` | Consumers pin thin callers to a released ref.                              |
| Repo scaffold     | `AGENTS.md`, `.agent/**`, hooks, lifecycle scripts, baseline process docs | `ArchonVII/repo-template`    | New and updated repos consume through template or snapshots.               |
| Integrator        | Snapshots, onboarding, feature registry, audit/update catalog             | `ArchonVII/archon-setup`     | Refresh snapshots after provider changes; do not edit snapshots as source. |
| Shared skills     | Skill source, skill loading policy, repair targets                        | `ArchonVII/jma-skill-review` | Repair skill source first; do not copy runtime cache files into repos.     |

Edit the narrowest source of truth first, then propagate through the normal snapshot or
consumer update path.

## Document Charters

| Document                                   | Answers                                                      | Owner                 | Budget                | Above-the-fold requirement                                 | Hard exclusions                                        |
| ------------------------------------------ | ------------------------------------------------------------ | --------------------- | --------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| `README.md`                                | What is this and how do I run it?                            | human                 | 150 lines             | One-sentence purpose, quickstart/status pointers           | Architecture detail, process rules, historical logs    |
| `AGENTS.md`                                | How do agents work here?                                     | ecosystem             | 160 lines             | Read-first list, Start Map, workflow guardrails            | Tool quirks, full specs, project vision                |
| `CLAUDE.md` / `GEMINI.md`                  | What diverges for this tool only?                            | ecosystem             | 25 lines              | Pointer back to `AGENTS.md` plus any tool-specific delta   | Universal rules, repo truth, duplicate workflow policy |
| `VISION.md`                                | What experience are we building, and what is out of scope?   | human                 | 120 lines             | Experience, north star, scope, explicitly-not section      | Implementation detail, task lists, status logs         |
| `docs/decisions/decision-log.md`           | What did the owner decide, when?                             | human, agent-appended | append-only           | Newest decision first with date, lane, one-line why        | Rationale essays, technical ADR content                |
| `CHANGELOG.md` (release-class)             | What shipped for users?                                      | `docs:changelog`      | folded at release-cut | Conventional Commit history rendered into `[Unreleased]`   | Operational update notes, internal-only maintenance    |
| `docs/STATUS.md` (replaced `docs/repo-update-log/`, retired #124) | What changed operationally / is in flight? | `docs:status` | rendered on demand | Open PRs/issues, roadmap %, doc-health summary | User-facing release notes |
| `ARCHITECTURE.md` / `docs/architecture/**` | Where do subsystems live and what boundaries matter?         | agents                | as needed             | System map and boundary rules before rationale             | Per-file documentation, transient plans                |
| `docs/plans/**`                            | What implementation plan is active or historical?            | agents                | as needed             | Status, owner, source issue, next action, closeout state   | Project vision, ADR replacement, stale active guidance |
| `projects/<slug>/PLAN.md`                  | What is the front door for one feature?                      | agents                | as needed             | Current state, next safe action, blocker, invariants       | Duplicate specs, code, generated artifacts             |
| `docs/adr/**`                              | What technical decision was accepted and why?                | agents                | as needed             | Decision, status, context, consequences                    | Owner intent ledger, implementation task list          |
| `docs/research/**`                         | What evidence did we collect?                                | agents                | as needed             | Question, source set, conclusion confidence                | Binding policy without promotion                       |
| `.claude/noticed.md`                       | What observation should not be lost yet?                     | agents                | append-log            | New observation entry only                                 | Durable policy, large research notes                   |
| `.claude/napkin.md`                        | What repeatable runbook lesson should future sessions reuse? | agents                | top 10 per category   | Highest-priority reusable rules first                      | One-off session logs, stale mistake lists              |
| `.claude/friction.md`                      | What non-bug workflow hiccup cost time?                      | agents                | append-log            | Machine-parseable table header first                       | Bugs, security findings, mid-task fixes                |

When a repo has not adopted a future document yet, the charter still defines where that
document belongs once introduced.

## Owner Intent Layer

`VISION.md` is human-owned. Agents may install or repair the template, but they do not fill
it from inference. Keep it focused on experience, north star, scope, explicitly-not,
current horizon, and drift tripwires; implementation detail, task lists, and status logs
belong elsewhere. `Last reviewed` is stale after 90 days unless a repo-local policy sets a
different cadence.

`docs/decisions/decision-log.md` is the append-only owner-intent ledger, newest first.
Entries stay to the title plus `Decision`, `Lane`, and `Why` one-liners. Use it for owner
scope decisions, not technical ADR rationale. When a lane produces an owner scope decision,
append it at closeout and record `Owner decisions this lane: appended` in the PR body;
otherwise record `Owner decisions this lane: none`.

## Lifecycle States

| State        | Meaning                                 | Required handling                                                                 |
| ------------ | --------------------------------------- | --------------------------------------------------------------------------------- |
| `draft`      | Being shaped; not binding yet           | Keep in planning/research areas or a PR branch.                                   |
| `active`     | Current operating guidance              | Keep above-the-fold guidance fresh and linked from the Start Map when agent-read. |
| `accepted`   | Historical decision that is now binding | Use for ADRs and link any implementation docs that rely on it.                    |
| `superseded` | Replaced by a newer source              | Add `Superseded by` with a concrete path or URL.                                  |
| `archived`   | Historical evidence only                | Move out of active navigation and keep inbound links clear.                       |
| `scratch`    | Temporary and not durable policy        | Keep untracked or outside durable docs; promote before relying on it.             |

### Status Header

Durable `docs/**` files use this small header unless their file type already has a
stronger format, such as ADRs or wiki frontmatter:

```markdown
> **Status:** draft | active | accepted | superseded | archived
> **Owner:** human | agent | repo | ecosystem
> **Scope:** repo-local | meta-layer | global-skill | workflow-provider
> **Source of truth:** yes | no - see <path/link>
> **Last reviewed:** YYYY-MM-DD
> **Supersedes:** <path or none>
> **Superseded by:** <path or none>
```

Do not force this header onto `README.md`, `CHANGELOG.md`, `AGENTS.md`, tool addenda, or
`.github` templates unless the owning convention requires it.

## Placement Priority

`AGENTS.md` stays a contract, not a policy archive. Keep this order:

1. Read First and Agent Start Map.
2. Core workflow and worktree/branch guardrails.
3. Delivery, verification, closeout, and PR readiness rules.
4. Coordination, anomaly/friction ledgers, and owner-maintenance exceptions.
5. Capability contracts that point to detail docs.
6. Reference-only sections.

Within any agent-read document:

- Put binding action before background.
- Link to the canonical home instead of copying a rule.
- If a section needs more than 10 lines, keep no more than 5 lines in `AGENTS.md` and move
  detail to `docs/agent-process/<topic>.md`.
- Preserve managed block markers and update the writer in the same lane if a generated block
  changes shape.
- Prefer explicit paths over prose labels when pointing agents to work.

## Authority & Freshness

Authority comes from the charter a document serves, its lifecycle state, and its status
header. A repo names only a small, explicit set of current-truth registers with the
existing `Source of truth: yes` header. Everything else is navigation, decision history,
evidence, or project-local context, and should point to the current-truth register instead
of restating volatile facts.

Front-door files such as `README.md`, `ROADMAP.md`, `docs/INDEX.md`, and `llms.txt` are
navigation surfaces. They may link to current truth, but they do not duplicate volatile
status. Before a front door labels a target current or authoritative, the target itself
declares `Status: active` and a recent `Last reviewed:` value. If it does not, the front
door labels it historical or contextual.

Dated plan files under `docs/plans/<date>-*.md` are historical snapshots by default. A
dated plan is active only when its own header declares `Status: active` and
`Source of truth: yes`. For active per-feature work, `projects/<slug>/PLAN.md` is the
front door. Once a project capsule exists, `docs/plans/**` is historical or fallback
context for that feature.

## Doc-Health Duties

Humans and agents may edit docs through the repo's normal branch/PR policy. Automated
doc-health only reports:

- Charter budget overruns.
- Stale `Last reviewed` values.
- Active plans or capsules that read as live after the lane is done.
- Missing supersession links.
- Dangling relative links.
- Placeholder text in active docs.
- Startup-baseline entries that disagree with the filesystem.

Reports become issues, PR findings, or maintenance status. They do not auto-rewrite
documents.

## Closeout

Before a PR is ready for review, every repo-facing plan, progress note, handoff, audit,
roadmap/status tracker, or coordination note created or used by the lane must be closed,
narrowed to still-open scope, or marked superseded with a current source of truth.

Record document-policy changes with a clear Conventional Commit subject (CHANGELOG.md is
release-class, folded at release-cut by `npm run docs:changelog`) and mark whether propagation
is pending in `.github`, `archon-setup`, `github-workflows`, skills, or consumer repos.
