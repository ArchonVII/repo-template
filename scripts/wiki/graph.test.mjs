// scripts/wiki/graph.test.mjs
//
// Unit tests for the wiki:graph model builder. Uses a fake resolver (same trick as
// lib.test.mjs) so the typed-edge logic is checked without touching the filesystem.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { buildModel, renderHtml } from './graph.mjs';

// Fake resolver: root points nowhere so matchLink's on-disk fallback never fires.
const resolver = {
  byRel: new Set([
    'docs/a.md', 'docs/a', 'docs/b.md', 'docs/b',
    'docs/c.md', 'docs/c', 'docs/d.md', 'docs/d',
  ]),
  byBasename: new Map([
    ['a', ['docs/a.md']], ['b', ['docs/b.md']], ['c', ['docs/c.md']], ['d', ['docs/d.md']],
  ]),
  root: path.join(os.tmpdir(), 'graph-test-nonexistent-root'),
};

const entries = [
  { rel: 'docs/a.md', data: { status: 'CANON', relates: ['[[b]]'], 'depends-on': ['[[c]]'] }, body: '' },
  { rel: 'docs/b.md', data: { status: 'EXPERIMENTAL', contradicts: ['[[c]]'] },
    body: 'see [c](c.md) and [out](https://example.com)' },
  { rel: 'docs/c.md', data: { status: 'SUPERSEDED', 'superseded-by': ['[[d]]'] }, body: '' },
  { rel: 'docs/d.md', data: { status: 'CANON', supersedes: ['[[c]]'] }, body: '' },
];

function hasEdge(edges, source, target, kind) {
  return edges.some((e) => e.source === source && e.target === target && e.kind === kind);
}

test('buildModel makes one node per page and preserves status', () => {
  const { nodes } = buildModel(entries, resolver);
  assert.equal(nodes.length, 4);
  assert.equal(nodes.find((n) => n.id === 'docs/c.md').status, 'SUPERSEDED');
});

test('buildModel emits typed edges from frontmatter relations', () => {
  const { edges } = buildModel(entries, resolver);
  assert.ok(hasEdge(edges, 'docs/a.md', 'docs/b.md', 'relates'));
  assert.ok(hasEdge(edges, 'docs/a.md', 'docs/c.md', 'depends-on'));
  assert.ok(hasEdge(edges, 'docs/b.md', 'docs/c.md', 'contradicts'));
});

test('buildModel folds superseded-by into a single reversed supersedes edge (deduped)', () => {
  const { edges } = buildModel(entries, resolver);
  const sup = edges.filter((e) => e.kind === 'supersedes');
  assert.equal(sup.length, 1); // c<-superseded-by-d and d->supersedes-c collapse to one
  assert.ok(hasEdge(edges, 'docs/d.md', 'docs/c.md', 'supersedes'));
});

test('buildModel suppresses a body link when a typed edge already joins the pair, and drops external links', () => {
  const { edges } = buildModel(entries, resolver);
  // b's body links to c, but b->c is already a contradicts edge, so no extra 'link' edge.
  assert.ok(!hasEdge(edges, 'docs/b.md', 'docs/c.md', 'link'));
  // the external https link is never an edge.
  assert.equal(edges.filter((e) => e.kind === 'link').length, 0);
  // expected total: relates, depends-on, contradicts, supersedes = 4.
  assert.equal(edges.length, 4);
});

test('renderHtml embeds the payload and the renderer, with no unfired interpolation', () => {
  const html = renderHtml(buildModel(entries, resolver), { generatedAt: '2026-06-17', agent: 'manual' });
  assert.match(html, /var PAYLOAD = \{/);
  assert.match(html, /cytoscape@3/);
  assert.ok(html.includes('docs/a.md'));
  assert.ok(!html.includes('${'), 'no template literal should leak into the output');
});
