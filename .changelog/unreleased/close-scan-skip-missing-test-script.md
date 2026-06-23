### Fixed

- `scripts/close/scan-complete.mjs` skips the `node-test` check (instead of
  running `npm test` unconditionally) when the repo has no `test` script. A
  baseline'd repo has no `test` script and the required gate leaves
  `npm-test-script` empty (node-ci runs scripts via `npm run --if-present`), so
  running `npm test` failed the local close-scan with a missing-script error
  even though CI was green. node-test is now reported green-by-skip in that
  case, staying consistent with the gate. (ArchonVII/archon-setup#282)
