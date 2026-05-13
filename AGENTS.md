# AGENTS.md

Cross-tool contract for AI agents (Claude, Codex, Copilot, Gemini, etc.) working in this repo.

> **Per-tool addenda** live in `CLAUDE.md`, `GEMINI.md` etc. when they exist. This file holds the rules every agent must follow.

## Read First

- `README.md` — what this project is and how to run it
- `ARCHITECTURE.md` — directory ownership and cross-boundary rules (add when the layout outgrows obviousness)

## Workflow

1. **Issue first.** Create a GitHub issue with explicit `Acceptance Criteria` before branching. Use the `Task` issue form.
2. **One issue → one branch → one PR.** Branch name: `agent/<tool>/<issue>-<slug>` (e.g. `agent/claude/42-oauth-flow`). Quick fixes without an issue use `agent/<tool>/<YYYY-MM-DD>-<slug>`.
3. **Never commit to `main`.** Branch protection enforces this.
4. **Conventional Commits** for messages: `<type>(<scope>): <description>` where `<type>` is one of `feat fix refactor test docs style chore perf ci build revert`.
5. **PR body must include** `## Verification` and `### Verification Notes` sections, at least one checked checkbox (`- [x]`), and link an issue with `Closes #N`. Doc-only PRs (every file matches `*.md`, `*.txt`, an image extension, or `.changelog/**`) skip the ceremony.

## Verification

Before marking a PR ready for review:

- Run the repo's lint, typecheck, and test commands. Record exact commands in `### Verification Notes`.
- If the change is user-visible, smoke-test it. Record what you exercised.
- Tick a `- [x]` box **only after** the command actually passed.

## CHANGELOG

This repo uses **<Mode 1: direct edit / Mode 2: `.changelog/unreleased/` fragments>** — pick one and delete the other in initial setup.

- **Mode 1:** Edit `CHANGELOG.md` under `## [Unreleased]`.
- **Mode 2:** Add a file at `.changelog/unreleased/<issue>-<slug>.md`. See that directory's README.

For PRs that don't warrant a CHANGELOG entry (refactor, tests, chore), apply the `no-changelog` label.

## Commit hygiene

- One logical unit per commit. If the message needs "and," split into two commits.
- Stage specific files: `git add <path> <path>`. Never `git add -A` or `git add .` — that's how `.env` files get committed.
- Don't bypass hooks (`--no-verify`, `--no-gpg-sign`). If a hook fails, fix the underlying issue.

## When stuck

If the same approach fails twice, stop. Switch tactics, ask the user, or document what you tried in the issue.

## Coordination

If multiple agents may touch this repo concurrently, document the rules here:

- File claims / locking mechanism
- High-contention files that require sequencing
- Worktree conventions
