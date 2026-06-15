---
template_id: prompts.prompt-batch.standard
example_version: 1.0.0
last_updated: 2026-06-15
style: bbs-1998
---

# Prompt Batch (BBS style)

A two-prompt dispatch for the document-policy rollout, rendered with the
`bbs-1998` style. It shows the four things that keep a batch readable:

- a **manifest with a count** ("read all 2") so a missing prompt is caught up front;
- **one unbroken sequence** — `PROMPT 1 OF 2`, `PROMPT 2 OF 2`, no duplicate numbers;
- **lane ids demoted to metadata** (`lane 3a`, `lane 4`) instead of competing with the
  sequence number;
- **sub-parts nested inside their parent prompt** (`1a`/`1b`, `2a`/`2b`), each labelled
  as part of that prompt rather than floating as a miniature side item.

```text
:::[ PROMPT BATCH · document-policy rollout · 2 PROMPTS ]::::::::::::::::::::

  Manifest (read all 2):
    1. Doc-health checker   ArchonVII/repo-template      #74   parts a, b
    2. Doc-policy-lint      ArchonVII/github-workflows   #70   parts a, b

  Sequencing: Prompt 2 ideally starts after Prompt 1 merges, and mirrors
              Prompt 1's two signal definitions.
  Shared:     Spec - archon-setup .../2026-06-12-document-policy-design.md.
              §8.2 adds two WARN-ONLY signals; honor §8's rejected list.

=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
  PROMPT 1 OF 2  ·  doc-health checker
  ArchonVII/repo-template  ·  issue #74  ·  lane 3a
=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

[ ROLE ]
  You implement lane 3a of the document-policy rollout in
  ArchonVII/repo-template.

[ READ FIRST ]
  - Spec §5.3 (checker scope), §8.2 (two new signals), §7 (lane-3a verification)
  - Policy (on main): docs/agent-process/document-policy.md
  - Sibling to copy:  scripts/doc-sweep/

[ SETUP ]
  git -C C:\GitHub\repo-template worktree add \
    -b agent/<tool>/74-doc-health-checker \
    C:\GitHub\repo-template-74-doc-health-checker main

[ TASK ]
  Build the deterministic doc-health checker at scripts/doc-health/ plus a
  contract doc and a <=5-line AGENTS.md pointer. Checks per §5.3: charter
  budget overruns; stale `Last reviewed`; idle `active` plans; `superseded`
  without a `Superseded by`; dangling relative links; placeholder tokens;
  tool stubs over budget; baseline <-> filesystem mismatch.

[ SUB-PARTS ]   (part of Prompt 1 - not new prompts)
  [ 1a · index coherence ]
      WARN-ONLY: a durable doc absent from its landing/index warns
      (an ADR not in the ADR index; a durable docs/** not in docs/INDEX.md).
  [ 1b · stale active-doc terms ]
      WARN-ONLY: when a current-truth register changes, warn if nearby
      `active` docs still carry stale tokens (issue/migration numbers;
      "not deployed / next / remaining / deferred / blocked / pending").

[ CONSTRAINTS ]
  Report-only; never edits docs. Warn-only, never blocking. No new
  taxonomy. Honor §8's rejected list.

[ VERIFICATION ]
  Fixtures for every check (clean repo -> zero findings; seeded drift ->
  exact findings). Seed the Hudson Bend #216/#218 drift. npm test (note the
  pre-existing close-scan Windows blocker; do not fix it here).

[ DONE ]
  Draft PR into main, "Closes #74", atomic commits, selective staging.

=-=-=-=-=-=-=-=-=  END PROMPT 1 OF 2  =-=-=-=-=-=-=-=-=

=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
  PROMPT 2 OF 2  ·  doc-policy-lint
  ArchonVII/github-workflows  ·  issue #70  ·  lane 4
=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

[ ROLE ]
  You implement lane 4 of the document-policy rollout in
  ArchonVII/github-workflows.

[ READ FIRST ]
  - Spec §5.4 (lint scope), §8.2 (two signals), §7 (lane-3c/4 verification)

[ SETUP ]
  git -C C:\GitHub\github-workflows worktree add \
    -b agent/<tool>/70-doc-policy-lint \
    C:\GitHub\github-workflows-70-doc-policy-lint main

[ TASK ]
  Build the WARNING-ONLY `doc-policy-lint` reusable workflow per §5.4:
  status-header presence on durable docs/** (ADRs/fragments/own-format
  plans exempt), charter budgets, dangling Supersedes/Superseded-by links,
  placeholder tokens in `active` docs. Promotion to a required check is
  DEFERRED (warn first).

[ SUB-PARTS ]   (mirror Prompt 1's two signals, emitted as WARNINGS)
  [ 2a · index coherence ]        a durable doc absent from its landing/index.
  [ 2b · stale active-doc terms ] a current-truth register changed while a
                                  nearby `active` doc carries stale tokens.

[ CONSTRAINTS ]
  Warning-only, never gate. Reusable-workflow review rule: explicit
  permissions block, tag-ref alignment, an integration test. No new
  taxonomy; honor §8's rejected list.

[ VERIFICATION ]
  Scoped actionlint on changed workflow files; an integration test
  exercising the warn path; confirm it never sets a failing status.

[ DONE ]
  Draft PR into main, "Closes #70", atomic commits, selective staging.

=-=-=-=-=-=-=-=-=  END PROMPT 2 OF 2  =-=-=-=-=-=-=-=-=

::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::
[ BATCH COMPLETE · 2 OF 2 PROMPTS ] [END]
```

## Contrast: what the old hand-assembled shape did

The same dispatch, written by hand, headlined prompts as `Prompt 2 — Lane 3a` and
`Prompt 3 — Lane 4`: two numbering systems competing, a duplicated `Prompt 3` block,
and only a thin `---` between prompts. A short prompt tucked between two long ones was
read straight past. The manifest count, the `n OF N` banners, and the `END PROMPT`
closers above remove every one of those failure modes.
