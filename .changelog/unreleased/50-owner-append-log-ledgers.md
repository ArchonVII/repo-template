### Changed

- **Owner Maintenance Lane** now recognizes a narrow, named set of **append-log
  ledgers** that may be *added or modified* directly on `main` — `.claude/noticed.md`
  (observation log) and `.claude/napkin.md` (per-repo runbook). Standing conventions
  write to these constantly, so a one-line update no longer needs a full issue → PR
  lane or a double audited bypass. Any Conventional Commit subject works and the
  issue-ref requirement is waived when every staged path is a ledger; renames, copies,
  deletes, and all other paths keep the strict add-only + unsafe-set rules. The
  allowlist lives in `.githooks/scripts/owner-maintenance.sh`
  (`owner_maintenance_is_append_log`). (#50)
