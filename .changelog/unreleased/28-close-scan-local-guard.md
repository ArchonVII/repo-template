### Added

- Added local `close:scan:complete` and `close:ci:guard` delivery commands that bind closeout verification to the exact final `HEAD`, write an ignored close-scan marker, and fail closed when required-gate evidence is missing or stale.
