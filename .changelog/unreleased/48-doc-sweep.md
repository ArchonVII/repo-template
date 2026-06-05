### Added

- **Doc Sweep-Up** capability: a depless `node:test` runner under `scripts/doc-sweep/`
  (`lib.mjs`, `git.mjs`, `sweep.mjs`) plus the `## Doc Sweep-Up` contract in `AGENTS.md` and
  the full standard/design spec at `docs/agent-process/doc-sweep.md`. Agents recover add-only
  docs that prior or dead sessions stranded (sweep-on-open) and flush their own pending docs
  before closing (flush-on-close), with liveness gating, an allow-list, a lock + claim, and a
  deterministic secret scan before any commit. (#48)
