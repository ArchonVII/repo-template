### Fixed

- Close-scan now derives scope from `git diff --name-status -M` with no diff filter, so deleted code/hook files (and both sides of renames) count toward scope — a PR that deletes code while changing docs no longer under-runs the guard as docs-only.
- The hook-syntax check runs `bash -n` once per hook file instead of `bash -n a b c` (which only parsed the first file), so every hook script is syntax-checked and any failing file is reported.
