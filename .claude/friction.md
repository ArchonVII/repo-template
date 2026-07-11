<!-- Log non-bug workflow hiccups here; category = tooling | docs | skill | hook | ci | env; cost = rerun | blocked | context-burn | none. Keep each cell one line. -->
| date | category | what happened | cost | suggested fix |
|---|---|---|---|---|
| 2026-06-12 | tooling | PowerShell double-quoted here-string escaped Markdown code fences in the PR body | rerun | Use single-quoted here-strings or temp-file body templates for Markdown fences |
| 2026-07-11 | tooling | close:scan substantive-decision guard (PLACEHOLDER_RE in scripts/close/lib.mjs) rejected an honest --docs-decision for containing the word "placeholder" in prose | rerun | Anchor the guard to filler patterns (e.g. bare TODO/TBD lines) or whole-cell matches so legitimate prose mentioning the word passes |
