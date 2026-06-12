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

## Template library

This repo includes a reusable template-system baseline for agent communication,
prompt workflows, reports, GitHub artifacts, and operational handoffs.

- Template structures live in [`templates/`](templates/README.md).
- The current template inventory and future-template roadmap live in
  [`docs/template-library-inventory.md`](docs/template-library-inventory.md).
- Presentation styles live in [`styles/`](styles/plain.md).
- Validation schemas live in [`schemas/`](schemas/template.schema.json).
- Filled examples live in [`examples/`](examples/agent-final-response.example.md).

Keep content structure separate from style. A template should work in plain
Markdown first; visual skins such as BBS 1998 are applied afterward.

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
  and commits scoped entirely to `docs/scratch/**`; `docs(owner):` /
  `chore(owner):` messages are exempt only when every staged path is
  add-only Owner Maintenance Lane content.
- **`pre-commit`** — rejects direct commits to `main` / `master`.
  Exempt during in-progress rebase / merge / cherry-pick. Also allows
  Owner Maintenance Lane commits when every staged path is add-only and
  safe (`docs/**`, image files, or `.changelog/**`; explicit unsafe paths
  such as `docs/process/**` and `docs/architecture/**` still require PRs).

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

## Agent PR readiness wrappers

This template ships repo-owned wrappers for the strict ArchonVII PR
ready-for-review contract:

```bash
npm run agent:close-preflight -- --repo OWNER/REPO --pr <number>
npm run agent:pr-ready -- --repo OWNER/REPO --pr <number>
```

Agents must use these wrappers before promoting a draft PR. Do not run
`gh pr ready` directly. The wrappers validate the PR title, body, branch, and
changed files before allowing promotion.

Useful local checks:

```bash
npm run pr:contract -- --repo OWNER/REPO --pr <number>
npm run agent:pr-ready -- --repo OWNER/REPO --pr <number> --dry-run
```

## Local close-scan guards

This template ships local delivery guards that bind final verification to the
exact commit being delivered:

```bash
npm run close:scan:complete -- --repo OWNER/REPO --pr <number> --changelog-decision "fragment .changelog/unreleased/<issue>-<slug>.md" --findings-decision "no findings file used"
git push
npm run close:ci:guard -- --repo OWNER/REPO --pr <number>
```

`close:scan:complete` runs local parity checks for the required gate and writes
the ignored `.agent/close-scan/complete.json` marker for the current `HEAD`.
`close:ci:guard` runs after push and fails if the marker is stale, PR evidence
is invalid, the local branch is not identical to upstream, or
`repo-required-gate / decision` is missing, pending, or not green.

Verify hook behavior after edits with:

```bash
bash .githooks/scripts/test-owner-maintenance.sh
bash -n .githooks/commit-msg .githooks/pre-commit .githooks/scripts/*.sh
```

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
