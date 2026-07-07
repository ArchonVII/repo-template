# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

`CHANGELOG.md` is **release-class** (`.agent/doc-map.yml`): the `[Unreleased]`
block below is folded from Conventional Commit history by
`npm run docs:changelog`, never hand-edited per PR. Do not edit the managed
block by hand — run the generator.

## [Unreleased]

<!-- BEGIN ARCHONVII MANAGED BLOCK: changelog-unreleased -->
### Added

- blocking subset + severity split — docs system L2 (#124) (#146)
- closeout 4-section DoD + coordination bookend — docs system S2 (#124) (#145)
- self-maintaining docs system S1 — doc-map spine + generators (#124) (#144)
- enforce repo update log fragments (#111) (#112)
- add wiki:graph visualization (OKF integration) (#109)
- Librarian schema 1.1 (OKF-inspired version, type, source) (#108)
- agent message protocol — status-tag taxonomy + human/agent lanes + machine-backed safe-to-clear (#106)
- add owner intent layer (#99)
- add deterministic checker (#100)
- add prompt-batch dispatch template with BBS batch banners (#103)
- add the Librarian wiki to the template (#95)
- per-PR fragments to kill the merge-conflict hotspot (#90)
- add append-log ledger contract (#78) (#83)
- add local delivery guard (#28) (#82)
- wire doc orphan detector (#76) (#79)
- add startup baseline contract (#57)
- prepopulate pr body at start (#55)
- ship Doc Sweep-Up contract + runner (Phase 2) (#49)
- add centralized template system baseline
- add strict PR ready wrappers
- add start-task/status/prune command surface (#33)
- enforce worktree model in the primary checkout (F19) (#26)
- repo-local coordination contract + scaffold; scrub cross-repo refs (#24)
- add owner maintenance lane (#22)
- add .githooks/ baseline for commit-msg + main guard (#16) (#18)
- Initial repo scaffold.

### Fixed

- close review cleanup gaps (#124) (#147)
- honor check-map required_gate.check_name in guard and policy scan (#142) (#143)
- run node-test on a malformed package.json instead of skipping green (#132) (#137)
- preserve staged candidates, reject placeholders, gate pr-ready on ci:guard (#130) (#136)
- install worktree deps and harden start-task issue-branch collision scan (#129) (#135)
- track hook shell scripts as executable (100755) (#128) (#133)
- skip node-test when the repo has no test script (#122)
- convert hook paths via cygpath under Git Bash (#104) (#115)
- block stale staged snapshots (#114)
- include deletions in scope; bash -n every hook (#85)
- honor default branch in owner-lane gate (#77) (#81)
- install anomaly triage caller (#80)
- port the five script fixes from archon-setup #197 (#67)
- require PR proof before pruning lanes (#65)
- retire squash/rebase-merged lanes via GitHub PR state (#61)
- drop scratch .pr-body.md; read committed PR template directly (#59)
- allow add-or-modify on main for named append-log ledgers (#50) (#51)
- allow docs safe paths (#46) (#47)
- make agent:prune survive Windows worktree-remove failures (#41)
<!-- END ARCHONVII MANAGED BLOCK: changelog-unreleased -->
