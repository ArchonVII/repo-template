### Removed

- The committed, empty `package-lock.json` (it locked zero packages — this template is
  depless). (#52)

### Added

- `.npmrc` with `package-lock=false` so npm never regenerates a stray lockfile in this
  depless template or in repos scaffolded from it. Repos that add real npm dependencies
  delete `.npmrc` to regain a committed lockfile. (#52)
