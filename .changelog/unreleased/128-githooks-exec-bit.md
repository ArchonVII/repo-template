### Fixed

- The baseline `.githooks` helper scripts (`checkout-doctor.sh`,
  `checkout-role.sh`, `owner-maintenance.sh`, `test-checkout-role.sh`,
  `test-owner-maintenance.sh`) were tracked with git mode `100644`, so once
  `install-githooks.sh` pointed `core.hooksPath` at `.githooks` they were
  non-executable and git skipped them on Unix/Linux/mac (CI and non-Windows
  dev) — the commit-msg/pre-commit policy guards could silently no-op. They are
  now tracked `100755` (executable), matching the hook entrypoints. The defect
  was latent on Windows because git-for-windows runs hooks by shebang
  regardless of mode.
