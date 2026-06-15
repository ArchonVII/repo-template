### Added

- Added the `prompts.prompt-batch.standard` template for dispatching multiple
  implementer prompts as one batch, with a count-bearing manifest, strict
  sequential `Prompt n of N` numbering, and nested `na`/`nb` sub-parts.
- Added `examples/prompt-batch.example.md` showing a batch rendered in the
  `bbs-1998` style.

### Changed

- Extended the `bbs-1998` style with batch banner, numbered-item banner,
  sub-item, and item-closer patterns, plus a note on why portable color is not
  used.
