# Plans

> **Consumer note:** this doc describes repo-template's reference conventions. Repos
> onboarded without the corresponding feature/tooling (e.g. project capsules) follow
> their own repo-local planning conventions where they differ.

Supported repo-facing implementation plans live here. Only plans explicitly marked active or selected by the repo-local status/index are authoritative; all others are non-blocking history.

Use:

```text
docs/plans/YYYY-MM-DD-<slug>.md
```

Update plan state in the plan file as work proceeds, keeping completed and
remaining steps clear enough for another agent to resume.

`docs/superpowers/plans/` is legacy/history only. Do not add new implementation
plans there unless a repo-specific migration note says otherwise.

> **Project capsules:** Capsule guidance applies only when the repo adopts project capsules.
> Once adopted, active *feature* work lives at `projects/<slug>/PLAN.md` (see
> `docs/agent-process/project-capsules.md`); otherwise continue using `docs/plans/`.
