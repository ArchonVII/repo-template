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

---

## Repo bootstrap checklist (delete this section after setup)

- [ ] Replace the top of this README with project content.
- [ ] Pick a license. Replace `LICENSE` (currently MIT — change if needed).
- [ ] Update `.gitignore` for your language stack (Node, Python, Rust, etc.).
- [ ] Update `CODEOWNERS` (currently `* @ArchonVII`).
- [ ] Update `AGENTS.md` with repo-specific workflow rules, or delete it if no AI agents will work here.
- [ ] Update `CHANGELOG.md` / decide if you want `.changelog/unreleased/` fragment mode (delete the directory if not).
- [ ] Update `dependabot.yml` ecosystems list for your stack.
- [ ] Pick which `.github/workflows/*.yml` callers to keep. Delete the rest.
- [ ] Run from a clone of `ArchonVII/github-workflows`:
  ```
  node scripts/setup-repo.mjs ArchonVII/<this-repo> --solo
  ```
  This applies the standard label set + branch protection.
- [ ] Configure branch protection's "Required status checks" once you know which workflows you kept.
- [ ] Delete this checklist.

See [`ArchonVII/.github/STARTER.md`](https://github.com/ArchonVII/.github/blob/main/STARTER.md) for the full document-policy guide.
