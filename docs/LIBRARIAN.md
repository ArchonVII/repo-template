---
summary: The schema and operating contract for this repo's agent-maintained wiki — read before any wiki maintenance.
status: CANON
confidence: EXTRACTED
updated: 2026-06-15
relates:
  - "[[CANON]]"
  - "[[INDEX]]"
depends-on: []
supersedes: []
superseded-by: []
contradicts: []
---

# Librarian — Wiki Schema and Operating Contract

This is the **schema layer** of the wiki. It is the contract every agent — Claude, Codex,
Copilot, Gemini, or a human — follows when maintaining this repo's knowledge base. The
schema is the real product: the tooling around it is replaceable, this document is not.

This wiki ships in `repo-template`, so every repo scaffolded from the template inherits it.
The pattern was ported from the `jma-history` "Librarian" system; this copy uses npm (not
pnpm) and GitHub-friendly Markdown links by default.

> **Rule of precedence.** `AGENTS.md`, `llms.txt`, [docs/CANON.md](CANON.md), this file,
> and [docs/INDEX.md](INDEX.md) are the **canonical navigation layer**. Anything under
> `.claude/`, `.codex/`, `.gemini/` (and `CLAUDE.md`/`GEMINI.md`) are **adapters only** —
> they hold no unique repo truth. If an adapter or a hook conflicts with this file or
> `docs/CANON.md`, **trust the docs and open an audit** in `docs/audits/`.

## Role

You are the **Librarian**: documentation steward, canon gatekeeper, consistency checker,
and change-triage assistant. You ensure future humans and agents can answer quickly: what
is true now, what is intended but not final, what changed recently, what is deprecated or
experimental, and where the docs conflict.

You do **not** treat every new note or idea as permanent truth. You decide what to
document, what to defer, what is experimental, and what conflicts with existing canon.

## The three tiers (unified)

| Tier    | Location                               | Ownership                       | Rule                                                                                                                                                        |
| ------- | -------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sources | `docs/raw/`                            | human-curated                   | **Immutable.** The Librarian reads, never rewrites.                                                                                                         |
| Pages   | `docs/` (design docs, ADRs, guides, …) | Librarian-maintained            | Durable wiki pages with full frontmatter.                                                                                                                   |
| Facts   | `docs/memory/`                         | Librarian-maintained (junction) | Crystallized facts. Governed by the memory rules in the user's `CLAUDE.md`; this schema treats memory as the facts tier and does not duplicate those rules. |

Supporting surfaces: `docs/audits/` (human corrections → `archive/` once resolved),
`docs/log.md` (append-only ops log, gitignored), [docs/CANON.md](CANON.md) (the
high-density truth register read first), [docs/INDEX.md](INDEX.md) (map of content).

`docs/memory/` is a machine-local junction (gitignored). Links into the `memory/`
namespace are assumed valid and are **not** resolved by `wiki:lint`.

### What is NOT a page

`wiki:lint` skips these (no frontmatter required): `docs/raw/`, `docs/audits/`,
`docs/memory/`, `docs/log.md`, `docs/repo-update-log.md`, `docs/repo-update-log/`, and
`docs/decisions/decision-log.md` (append-only operational and owner-intent ledgers).

The template also ships pre-existing doc trees that are **not yet under the wiki schema**:
`docs/adr/`, `docs/agent-process/`, `docs/plans/`, and `docs/superpowers/`. They are listed
as non-page tiers in `scripts/wiki/lib.mjs` so the wiki starts green. Bring a tree under the
schema incrementally: add frontmatter to its pages, then remove that prefix from
`NON_PAGE_PREFIXES`.

## Page frontmatter (required)

Every page under `docs/` (except the non-page tiers above) carries:

```yaml
---
summary: One-line summary. The model reads this to decide whether to open the page.
status: CANON | CURRENT | APPROVED | EXPERIMENTAL | PROPOSED | DEPRECATED | SUPERSEDED
confidence: EXTRACTED | INFERRED | AMBIGUOUS | UNVERIFIED
updated: YYYY-MM-DD
relates:
  - "[[other-page]]"
depends-on: []
supersedes: []
superseded-by: []
contradicts: []
---
```

- **`summary`** is load-bearing — keep it to one line; it is what an agent scans first.
- `wiki:lint` fails a page that is missing `summary` or `status`, or that uses a value
  outside the allowed sets. Missing `confidence`/`updated` are warnings.

### Page `type` (optional)

`type` is an optional routing/filtering axis (schema 1.1) — it lets an agent answer "show me
all runbooks" or "all ADRs" without opening every page. Recommended values:

> `register`, `index`, `status`, `design`, `adr`, `decision`, `plan`, `guide`, `runbook`,
> `reference`, `spec`, `policy`

The set is **recommended, not closed**: a producer may use another value and `wiki:lint`
**warns** (never errors) on anything out-of-set, keeping the schema open the way OKF's `type`
is. Omitting `type` is always fine. The authoritative list is `TYPE_VALUES` in
[scripts/wiki/lib.mjs](../scripts/wiki/lib.mjs).

### Source provenance (optional)

`source` (schema 1.1) points at where a page's claims came from — a `docs/raw/` file, a commit,
or an external URL. It pairs with `confidence`: a page marked `EXTRACTED` can name the exact
source an auditor can re-check. Write it as a bare path, a URL, or a quoted wikilink — **not** a
Markdown link:

```yaml
source: docs/raw/okf-review.md      # a repo path
# or
source: "https://example.com/spec"  # an external URL
# or
source: "[[okf-review]]"             # a wikilink
```

If `source` is present and points at a local target, `wiki:lint` resolves it and **warns** on a
broken target (provenance rot) — never an error. External and memory-tier sources pass as-is,
and omitting `source` is fine. (A future _major_ bump may expect `source` on `EXTRACTED` pages;
it stays optional throughout 1.x to remain backward-compatible — see "Schema versioning".)

### Links — both styles are valid

Pages render on GitHub, so **page bodies use standard Markdown links** `[text](other-page.md)`
by default. `[[wikilinks]]` are also valid and `wiki:lint` resolves **both**. Prefer Markdown
links in bodies so they render on GitHub.

**Frontmatter relations** (`relates`, `depends-on`, `supersedes`, `superseded-by`,
`contradicts`) use **quoted wikilinks** — `"[[other-page]]"`. Frontmatter is not rendered by
GitHub, so wikilinks there are harmless, and they feed orphan detection and the typed-edge
view. Empty lists are `[]`.

### Status labels (page disposition — reality vs. intention)

- **CANON** — stable agreed truth; future work should rely on it.
- **CURRENT** — accurate description of the current implementation / state.
- **APPROVED** — agreed direction, not yet fully implemented.
- **EXPERIMENTAL** — exploratory/prototype; may change; state what would make it canon.
- **PROPOSED** — discussed, not approved or implemented.
- **DEPRECATED** — no longer current; point to the replacement.
- **SUPERSEDED** — replaced by a specific newer page; set `superseded-by`.

### Confidence labels (claim provenance)

- **EXTRACTED** — verbatim/paraphrased from a stable source with no change in meaning.
- **INFERRED** — agent deduction from source patterns.
- **AMBIGUOUS** — source is contradictory/unclear; needs human clarification.
- **UNVERIFIED** — agent general knowledge filling a gap; not present in local sources.

### Supersession

When a page replaces another, set `superseded-by: ["[[new]]"]` on the old page (status
`SUPERSEDED`) and `supersedes: ["[[old]]"]` on the new one. Never silently delete the old
page; the link trail is the version history. `wiki:lint` flags one-sided supersession.

### Typed relations

`relates / depends-on / contradicts` express a typed edge between pages on top of the flat
graph. Use `contradicts` to make a known conflict explicit rather than letting two pages
drift apart silently — that is what `wiki:lint` and the audit loop resolve.

## Schema versioning

This schema carries a version — `SCHEMA_VERSION` in
[scripts/wiki/lib.mjs](../scripts/wiki/lib.mjs), printed by `wiki:doctor`. It is
`<major>.<minor>`:

- **Minor** — a backward-compatible addition: a new **optional** key, a new recommended
  vocabulary value, a new conventional section. A repo on an older minor stays valid; a minor
  bump never makes `wiki:lint` start failing.
- **Major** — a breaking change: renaming or removing a required key, or changing required
  semantics. These need a coordinated migration.

**Why version a schema?** This wiki ships in `repo-template` and is inherited by every repo
scaffolded from it — usually through a **pinned snapshot that lags the source**. The version is
the drift signal: compare a repo's `wiki:doctor` version against the template to see how far
behind its Librarian schema has fallen. (Same idea as OKF's `okf_version`; and as in OKF, a
consumer meeting a newer minor should degrade gracefully, not refuse the wiki.)

### Changelog

- **1.1** (2026-06-17) — Introduced schema versioning, and added two **optional** page keys:
  `type` (a routing/filtering axis — see "Page type") and `source` (a provenance pointer — see
  "Source provenance"). Fully backward-compatible: both keys are optional, and out-of-set or
  broken values **warn**, never error.
- **1.0** — The original Librarian schema (required frontmatter, the status/confidence
  vocabularies, typed relations, and the operations documented in this file), shipped to the
  template in #95.

## Operations (`npm run wiki:*`)

All operations are shared scripts (`scripts/wiki/*.mjs`, zero-dependency Node) and accept
`--agent claude|codex|gemini|manual|ci`. Output is identical regardless of caller. (Pass
positional args after `--`, e.g. `npm run wiki:ingest -- docs/raw/notes.md`.) Five are
fully deterministic; three are **orchestrators** that prepare work and hand the semantic
pass to you (the agent) — a script never fabricates LLM extraction.

| Command              | Kind          | Contract                                                                                                                                                                                                                  |
| -------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wiki:start`         | deterministic | Print the required reading order, open audits, the `docs/raw/` queue, and a page-health count. Informational; always exits 0.                                                                                             |
| `wiki:doctor`        | deterministic | The navigation checksum (see below). Non-zero on any failure.                                                                                                                                                             |
| `wiki:lint`          | deterministic | Frontmatter validity, broken Markdown/wikilinks, missing summaries, one-sided supersession, orphans (warn). Non-zero on errors.                                                                                           |
| `wiki:compact-save`  | deterministic | Append a handoff marker to `docs/log.md` and print a crystallization reminder before context compression. Fail-open.                                                                                                      |
| `wiki:graph`         | deterministic | Render the pages tier as an interactive graph — nodes by `status`, edges colored by typed relation, every `contradicts` pair flagged — to a self-contained HTML file in the gitignored `.html-artifacts/`. Informational. |
| `wiki:ingest <path>` | orchestrator  | Validate a `docs/raw/` source, run a secret/PII scan, print the checklist and likely-impacted pages. You then extract durable claims per this schema.                                                                     |
| `wiki:query "<q>"`   | orchestrator  | Scan CANON + pages for the query terms and print candidate pages. You synthesize a cited answer; good answers are filed back as a new page.                                                                               |
| `wiki:crystallize`   | orchestrator  | List the branch's work-chain (recent commits) and print the checklist. You write durable facts to `docs/memory/` and unresolved questions to `docs/audits/`. Fail-open.                                                   |

### The navigation checksum (`wiki:doctor`)

`wiki:doctor` fails if any of these drift:

- `AGENTS.md` does not point to `docs/LIBRARIAN.md` and `docs/CANON.md`.
- `llms.txt` is missing any required first-read (`AGENTS.md`, `docs/CANON.md`,
  `docs/LIBRARIAN.md`, `docs/INDEX.md`, `docs/project-status.md`).
- `CLAUDE.md` or `GEMINI.md` exists **but does not point to `AGENTS.md`** (these adapters
  are optional; AGENTS.md is the single contract).
- `package.json` is missing a `wiki:*` script, or a `scripts/wiki/*.mjs` file is missing.
- A hook config (`.claude/settings.json`, `.codex/hooks.json`, `.gemini/settings.json`)
  calls a `wiki:*` command that does not exist.

> The `llms.txt` check is **presence-only** — it verifies the required first-reads are
> _listed_, not that `llms.txt` (or `README.md`) content is _current_ against canon, and it
> does not inspect `README.md` at all. Keeping the navigation front doors fresh is therefore
> a workflow step (see "Re-sync the navigation front doors" below), not something this
> checksum enforces.

## Workflows

### Ingest a source

1. Source lands in `docs/raw/` (immutable). Run `npm run wiki:ingest -- docs/raw/<file>`.
2. Read it; discuss key takeaways. Write/update the relevant page(s) with `EXTRACTED`
   claims; mark deductions `INFERRED`.
3. Update `docs/INDEX.md` and append to `docs/log.md`. A single source may touch many
   pages — update cross-references.

### Crystallize a session

At session end (or on the Stop/SubagentStop hook), distill the completed work-chain into
durable facts in `docs/memory/` and open questions into `docs/audits/`. Treat a finished
exploration as a source.

### Re-sync the navigation front doors

`llms.txt` (the **agent** front door) and `README.md` (the **human** front door) belong to
the canonical navigation layer, but they are **prose summaries of canon, not canon itself** —
they restate what [docs/CANON.md](CANON.md) and [docs/project-status.md](project-status.md)
establish. They go stale the moment canon moves and the summary does not.

So treat the front doors as part of the same change: **whenever a wave of work updates
[docs/CANON.md](CANON.md), [docs/project-status.md](project-status.md), or the
deployment/release-status facts, re-sync `llms.txt` and any `README.md` status/overview
section in the same PR.** Reconcile their dated/status framing against the canon entry you
just changed; never leave a front door asserting a fact canon has superseded.

`wiki:doctor` does **not** catch front-door drift (its `llms.txt` check is presence-only and
it never inspects `README.md` — see "navigation checksum" above), so this is a Librarian
responsibility of the cycle, not a checksum guarantee.

### Resolve an audit

Files in `docs/audits/` are high-priority human corrections. Review them at session start
(`wiki:start` surfaces them). Resolve by updating the affected page, then move the audit
file to `docs/audits/archive/`. **Never ignore an open audit.**

### Lint

Run `npm run wiki:lint` on demand; CI runs it on every `docs/**` PR. Fix broken links,
missing frontmatter, and one-sided supersession; triage contradictions into audits.

## Governance

- **Worktree-first.** Wiki changes to `docs/**` are protected and land through a PR from a
  linked worktree (see `AGENTS.md`). Hooks never `git add`, never commit, and never write
  protected docs — they only update the gitignored `docs/memory/` / `docs/log.md` and print
  reminders.
- **Distinguish reality from intention.** Never collapse current state, approved direction,
  experiment, and proposal into one narrative — that is what the status labels are for.
- **Ask before you fossilize.** If information is ambiguous, mark it `AMBIGUOUS` or open an
  audit rather than promoting it to `CANON`.

### Reading vs. authoring (robustness)

The wiki **fails closed when written, but reads open.** _Authoring_ and _CI_ are strict:
`wiki:lint` and `wiki:doctor` exit non-zero on a broken link, a missing `summary`/`status`, or
a drifted contract, so defects are fixed at the source rather than propagated. But an agent
merely _consuming_ the wiki to answer a question should be **tolerant** — a broken link, a
missing optional field, or an unknown `type` must never block a read; degrade gracefully and
note the gap (open an audit if it matters). This is OKF's robustness rule applied to a
governed repo: **producers conform, consumers tolerate.**
