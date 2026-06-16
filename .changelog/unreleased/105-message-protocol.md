### Added

- Added the agent **message protocol** (`docs/agent-process/message-protocol.md`): a
  status-tag taxonomy (`TECHNICAL`/`CREATIVE DECISION`, `REVIEW`, `PROVIDE DATA`,
  `PROMPT PACKET`, a `⚠ RISK` overlay; `SAFE TO CLEAR`, `NOT DONE`, `JUDGMENT CALL`, `FYI`),
  a human/agent lane split (`For you` / `My work`), and a machine-backed `SAFE TO CLEAR`.
- Added `partial.status-banner` — the lead banner that carries one tag.

### Changed

- `agent.final-response` and `reports.decision-memo` now lead with the status banner and the
  `For you` / `My work` lanes; `plain` and `bbs-1998` styles document the banner (bbs uses a
  bracket-label fallback); `AGENTS.md` gains a short `## Message protocol` pointer.

### Deprecated

- `partial.status-line` — superseded by `partial.status-banner`.
