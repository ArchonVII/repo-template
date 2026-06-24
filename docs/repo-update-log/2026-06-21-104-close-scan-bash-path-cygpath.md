## 2026-06-21 - Close-scan: bash-flavor-aware hook path conversion (cygpath vs /mnt)

- **Issue/PR:** #104 / (this PR)
- **Branch:** agent/claude/104-close-scan-bash-path-cygpath
- **Changed paths:** scripts/close/scan-complete.mjs, test/close-scan.test.mjs, .changelog/unreleased/104-close-scan-bash-path-cygpath.md, docs/repo-update-log/2026-06-21-104-close-scan-bash-path-cygpath.md
- **What changed:** Replaced the hardcoded WSL `/mnt/<drive>/` path rewrite in `scan-complete.mjs` (`toWslPathIfWindowsAbsolute` -> `toBashPath`) with a bash-flavor-aware conversion. On win32 it now prefers `cygpath -u <winpath>` (ships with Git Bash, yields `/c/...`) and only falls back to the `/mnt/<drive>/` rewrite when `cygpath` is absent (pure WSL). A one-time `cygpath`-availability probe is cached so the per-file loop in `checkHookSyntax` does not re-probe. Non-absolute args (like the `-n` flag) pass through unchanged. This fixes `bash -n` hook-syntax false-failures on the default Windows `bash`, which broke real `/close` runs on Windows (CI/Linux was unaffected since the conversion is win32-only).
- **Verification:** `node --test test/close-scan.test.mjs` -> 17/17 pass (including the two `checkHookSyntax` regression tests at lines 253/278 and three new `toBashPath` unit tests). Full `npm test` (`node --test`) -> 149/149 pass. Run on Windows Git Bash where `cygpath -u "C:\a\b"` yields `/c/a/b`.
- **Propagation:** pending downstream snapshot — `src/snapshots/` was deliberately NOT modified in this PR; snapshot propagation to archon-setup + consumers is a separate step.
