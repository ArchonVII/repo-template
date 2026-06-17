// scripts/wiki/lib.test.mjs
//
// Unit tests for the wiki link mechanics — both link styles (Markdown links +
// wikilinks) — and the isPage non-page-tier rules. Run via `node --test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { extractMarkdownLinks, extractWikilinks, matchLink, isPage, SCHEMA_VERSION } from './lib.mjs';

test('SCHEMA_VERSION is a major.minor string', () => {
  assert.match(SCHEMA_VERSION, /^\d+\.\d+$/);
});

test('extractMarkdownLinks pulls page targets and skips images/external/anchors', () => {
  const text = [
    'See [the design](design-notes.md) and [hub](docs/index.html).',
    'An image: ![shot](screenshots/x.png) should be ignored.',
    'External [site](https://example.com) and [mail](mailto:a@b.com) skipped.',
    'A [titled link](notes/foo.md "Foo Title") and an [anchor](#section) only.',
    'Encoded [space](Vendor%20Requirements.md).',
  ].join('\n');
  const links = extractMarkdownLinks(text);
  assert.deepEqual(links, [
    'design-notes.md',
    'docs/index.html',
    'notes/foo.md',
    'Vendor Requirements.md',
  ]);
});

test('extractWikilinks strips alias and anchor', () => {
  const text = 'Read [[CANON]] and [[design/foo|Foo]] plus [[bar#heading]].';
  assert.deepEqual(extractWikilinks(text), ['CANON', 'design/foo', 'bar']);
});

test('matchLink resolves wikilinks and Markdown links to the same page', () => {
  // Fake resolver; root points nowhere so the on-disk fallback never fires.
  const resolver = {
    byRel: new Set(['docs/canon.md', 'docs/canon', 'docs/index.md', 'docs/index']),
    byBasename: new Map([['canon', ['docs/CANON.md']], ['index', ['docs/INDEX.md']]]),
    root: path.join(os.tmpdir(), 'hb-wiki-nonexistent-root'),
  };
  assert.equal(matchLink('CANON', 'docs/index.md', resolver), 'docs/canon.md'); // bare wikilink
  assert.equal(matchLink('docs/CANON.md', 'docs/index.md', resolver), 'docs/canon.md'); // markdown path
  assert.equal(matchLink('canon.md', 'docs/index.md', resolver), 'docs/canon.md'); // relative markdown
  assert.equal(matchLink('https://example.com', 'docs/index.md', resolver), 'external');
  assert.equal(matchLink('memory/some-fact', 'docs/index.md', resolver), 'memory');
  assert.equal(matchLink('nope.md', 'docs/index.md', resolver), null); // genuinely broken
});

test('isPage excludes non-page tiers and logs', () => {
  assert.equal(isPage('docs/CANON.md'), true);
  assert.equal(isPage('docs/LIBRARIAN.md'), true);
  assert.equal(isPage('docs/INDEX.md'), true);
  assert.equal(isPage('docs/raw/source.md'), false); // raw tier
  assert.equal(isPage('docs/audits/fix.md'), false); // audits tier
  assert.equal(isPage('docs/adr/0001-x.md'), false); // pre-existing tree, not yet under schema
  assert.equal(isPage('docs/plans/2026-06-15-x.md'), false); // pre-existing tree
  assert.equal(isPage('docs/agent-process/x.md'), false); // pre-existing tree
  assert.equal(isPage('docs/superpowers/plans/x.md'), false); // legacy tree
  assert.equal(isPage('docs/log.md'), false); // ops log
  assert.equal(isPage('docs/repo-update-log.md'), false); // update log (frozen archive)
  assert.equal(isPage('docs/repo-update-log/2026-06-13-191-x.md'), false); // per-PR fragment
  assert.equal(isPage('docs/decisions/decision-log.md'), false); // owner-intent ledger
  assert.equal(isPage('docs/template-library-inventory.md'), false); // standalone template doc
  assert.equal(isPage('README.md'), false); // root file, not under docs/
});
