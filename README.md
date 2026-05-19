# <Project Name>

> Replace this section with a one-sentence description of what this project is and who it's for.

## Quickstart

```bash
git clone https://github.com/<owner>/<repo>
cd <repo>
# <install command>
# <run command>
```

## What this is

A paragraph or two of context. What problem does it solve? What's the shape of the system?

## Status

Active development. Last updated: <YYYY-MM-DD>.

## License

See [LICENSE](LICENSE).

## Git hooks

This template ships a `.githooks/` baseline (issue
[ArchonVII/repo-template#16](https://github.com/ArchonVII/repo-template/issues/16),
finding F18 in `docs/phase2/findings.md`):

- **`commit-msg`** — requires a conventional-commit prefix (`feat`,
  `fix`, `docs`, `chore`, `refactor`, `test`, `ci`, `build`, `perf`,
  `revert`, `style`) and a tracked issue reference (`(#NNN)` or
  `task/<id>`). Exempt: `chore(scratch):` / `docs(scratch):` messages
  and commits scoped entirely to `docs/scratch/**`.
- **`pre-commit`** — rejects direct commits to `main` / `master`.
  Exempt during in-progress rebase / merge / cherry-pick.

Install after cloning:

```bash
./.githooks/scripts/install-githooks.sh
```

The script sets `core.hooksPath = .githooks` for this clone and is
idempotent. Re-run after pulling new hook changes is harmless.

Overrides (each leaves an audit trail via the env-var name itself):

```bash
# Commit on main anyway (logged to .agent/bypass.log):
ALLOW_MAIN_COMMIT=1 git commit ...

# Skip the issue-ref requirement:
ALLOW_NO_ISSUE_REF=1 git commit ...
```

The conventional-commit prefix is non-bypassable — reformat the message
instead.

---

## Repo bootstrap checklist (delete this section after setup)

- [ ] Replace the top of this README with project content.
- [ ] Pick a license. Replace `LICENSE` (currently MIT — change if needed).
- [ ] Update `.gitignore` for your language stack (Node, Python, Rust, etc.).
- [ ] Update `CODEOWNERS` (currently `* @ArchonVII`).
- [ ] Update `AGENTS.md` with repo-specific workflow rules, or delete it if no AI agents will work here.
- [ ] Pick the repo stack in `.agent/check-map.yml` and `.github/workflows/repo-required-gate.yml` (`minimal`, `node`, or `python`).
- [ ] Update `CHANGELOG.md` / decide if you want `.changelog/unreleased/` fragment mode (delete the directory if not).
- [ ] Update `dependabot.yml` ecosystems list for your stack.
- [ ] Run from a clone of `ArchonVII/github-workflows`:
  ```
  node scripts/setup-repo.mjs ArchonVII/<this-repo> --solo
  ```
  This applies the standard label set + branch protection.
- [ ] After the first PR run, configure branch protection's required status check to `repo-required-gate / decision`.
- [ ] Run `./.githooks/scripts/install-githooks.sh` in every clone so the commit-msg + pre-commit baselines fire (see **Git hooks** above).
- [ ] Delete this checklist.

See [`ArchonVII/.github/STARTER.md`](https://github.com/ArchonVII/.github/blob/main/STARTER.md) for the full document-policy guide.
