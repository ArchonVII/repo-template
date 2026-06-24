### Fixed

- Close-scan now converts Windows-absolute hook paths to the POSIX form the
  active `bash` expects before running `bash -n`. The previous hardcoded
  `/mnt/<drive>/` rewrite is WSL-only; under the default Windows `bash`
  (Git Bash/MSYS) every hook resolved to "No such file or directory" and the
  hook-syntax check false-failed real `/close` runs. The conversion now prefers
  `cygpath -u` (Git Bash's `/c/...` form, probed once and cached) and falls back
  to the `/mnt/<drive>/` rewrite only when `cygpath` is absent (pure WSL).
