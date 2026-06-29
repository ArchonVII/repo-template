### Fixed

- The baseline `AGENTS.md` (snapshotted verbatim to every onboarded repo) no
  longer carries unconditional references to infrastructure a non-wiki repo
  never installs. The "Read First" list now gates `docs/CANON.md`,
  `docs/LIBRARIAN.md`, and `docs/INDEX.md` behind the Librarian-wiki feature;
  the "Librarian Wiki" and "Project Capsules" sections each open with an
  "Applies only when ..." gate; and the managed Agent Start Map drops the
  dangling `Projects: projects/<slug>/PLAN.md` line (plans route through
  `docs/plans/`). Onboarded repos without the wiki/capsule features no longer
  get misrouted to paths that do not exist.
