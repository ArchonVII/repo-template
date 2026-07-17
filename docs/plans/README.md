# Plans

> **Consumer note:** this doc describes repo-template's reference conventions. Repos
> onboarded without the corresponding feature/tooling (e.g. project capsules) follow
> their own repo-local planning conventions where they differ.

Active repo-facing implementation plans live here.

Use:

```text
docs/plans/YYYY-MM-DD-<slug>.md
```

Update plan state in the plan file as work proceeds, keeping completed and
remaining steps clear enough for another agent to resume.

`docs/superpowers/plans/` is legacy/history only. Do not add new implementation
plans there unless a repo-specific migration note says otherwise.

> **Project capsules:** active *feature* work now lives in a project capsule at
> `projects/<slug>/PLAN.md` (see `docs/agent-process/project-capsules.md`). Use
> `docs/plans/` only for loose or cross-cutting plans that aren't a single feature;
> don't start a new `docs/plans/` file for feature work once `projects/` is in use.
