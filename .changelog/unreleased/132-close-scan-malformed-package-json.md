### Fixed

- Close-scan no longer records `node-test` green-by-skip on a malformed
  `package.json`. The old `hasNpmScript` swallowed the `JSON.parse` error and
  returned false, so a present-but-unparseable `package.json` was treated like an
  absent one and node-test was skipped green — while the required gate
  (`npm run --if-present test`) exits `EJSONPARSE` and fails. The new
  `decideNodeTest` distinguishes ABSENT (skip green) from PRESENT-BUT-UNPARSEABLE
  (run `npm test` so the parse error surfaces exactly as the gate sees it).
