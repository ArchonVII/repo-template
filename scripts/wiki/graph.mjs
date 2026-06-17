// scripts/wiki/graph.mjs
//
// Render the wiki as an interactive graph — a deterministic CONSUMER of the pages
// tier (no LLM). It turns the Librarian's *typed* relations into a visual: nodes are
// pages colored by `status`, edges are colored by relation kind, and every
// `contradicts` pair is flagged so conflicts are impossible to miss. This is the
// payoff of typed edges that OKF's untyped graph cannot draw. Rules:
// docs/LIBRARIAN.md "Typed relations" + "Operations".
//
// Output is a single self-contained HTML file written to the gitignored
// .html-artifacts/ dir. The graph DATA is embedded; only the Cytoscape.js renderer
// is loaded from a CDN (so the viewer needs network access to open the page).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  repoRoot, walkMarkdown, isPage, parseFrontmatter, stripCode,
  extractWikilinks, extractMarkdownLinks, buildResolver, matchLink, parseFlags, toPosix,
} from './lib.mjs';

// Typed frontmatter relations that become edges — source: docs/LIBRARIAN.md "Typed relations"
// + "Supersession". `superseded-by` is folded into `supersedes` (reversed) since lint keeps the
// two sides reciprocal; rendering both would just draw a redundant back-edge.
const RELATION_KEYS = ['relates', 'depends-on', 'supersedes', 'superseded-by', 'contradicts'];

function toArray(v) {
  if (v === undefined || v === null || v === '') return [];
  return Array.isArray(v) ? v : [v];
}

function basenameNoExt(rel) {
  return path.posix.basename(toPosix(rel)).replace(/\.md$/i, '');
}

function cleanTarget(raw) {
  return String(raw).replace(/\[\[|\]\]/g, '').split('|')[0].split('#')[0].trim();
}

// Pure model builder — entries: [{ rel, data, body }]. Returns { nodes, edges }, where
// edges only ever connect two pages (sentinels/external/broken targets are dropped). Pure so
// it is unit-testable with a fake resolver (see lib.test.mjs's matchLink fake).
export function buildModel(entries, resolver) {
  const pageRels = new Set(entries.map((e) => e.rel.toLowerCase()));
  const nodes = entries.map((e) => ({
    id: e.rel.toLowerCase(),
    label: basenameNoExt(e.rel),
    path: e.rel,
    status: e.data.status || 'UNKNOWN',
    type: e.data.type || '',
  }));

  const seen = new Set();
  const edges = [];
  const addEdge = (source, target, kind) => {
    if (source === target) return;       // no self-loops
    if (!pageRels.has(target)) return;   // only edges between pages
    const key = `${source}|${target}|${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ source, target, kind });
  };

  // 1. Typed frontmatter edges.
  for (const e of entries) {
    const from = e.rel.toLowerCase();
    for (const key of RELATION_KEYS) {
      for (const raw of toArray(e.data[key])) {
        const tgt = cleanTarget(raw);
        if (!tgt) continue;
        const hit = matchLink(tgt, e.rel, resolver);
        if (!hit || !hit.endsWith('.md')) continue;
        // Fold superseded-by into a reversed supersedes edge (new supersedes old).
        if (key === 'superseded-by') addEdge(hit, from, 'supersedes');
        else addEdge(from, hit, key);
      }
    }
  }

  // 2. Body link edges (untyped) — suppressed when a typed edge already joins the pair.
  const typedPairs = new Set(edges.map((ed) => `${ed.source}|${ed.target}`));
  for (const e of entries) {
    const from = e.rel.toLowerCase();
    const body = stripCode(e.body || '');
    for (const t of [...extractWikilinks(body), ...extractMarkdownLinks(body)]) {
      const hit = matchLink(t, e.rel, resolver);
      if (!hit || !hit.endsWith('.md')) continue;
      if (typedPairs.has(`${from}|${hit}`)) continue;
      addEdge(from, hit, 'link');
    }
  }

  return { nodes, edges };
}

// Visual encoding (design choice). Node fill by status; edge style by relation kind.
// Source: docs/LIBRARIAN.md status vocabulary; colors are an arbitrary readable palette.
const STATUS_COLORS = {
  CANON: '#2e7d32', CURRENT: '#1565c0', APPROVED: '#00838f', EXPERIMENTAL: '#f9a825',
  PROPOSED: '#6a1b9a', DEPRECATED: '#9e9e9e', SUPERSEDED: '#bdbdbd', UNKNOWN: '#455a64',
};

export function renderHtml(model, meta) {
  // Escape `<` so a page label can never break out of the <script> or inject markup.
  const dataJson = JSON.stringify({ model, meta }).replace(/</g, '\\u003c');
  const swatches = Object.entries(STATUS_COLORS)
    .map(([k, c]) => `<span class="sw"><i style="background:${c}"></i>${k}</span>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Librarian wiki graph</title>
<!-- Cytoscape.js 3.x via unpkg semver range; the viewer needs network access for this CDN.
     The graph data itself is embedded below, so it works offline once the renderer is cached. -->
<script src="https://unpkg.com/cytoscape@3/dist/cytoscape.min.js"></script>
<style>
  :root { color-scheme: dark; }
  html,body { margin:0; height:100%; background:#10141a; color:#e6edf3; font:14px/1.4 system-ui,sans-serif; }
  #cy { position:absolute; inset:0 0 0 0; }
  #panel { position:absolute; top:0; right:0; width:300px; max-height:100%; overflow:auto;
           padding:14px 16px; background:rgba(16,20,26,.92); border-left:1px solid #232b36; box-sizing:border-box; }
  h1 { font-size:15px; margin:0 0 4px; } .muted { color:#8b98a5; font-size:12px; }
  .legend { margin-top:12px; } .legend h2 { font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:#8b98a5; margin:14px 0 6px; }
  .sw { display:inline-flex; align-items:center; gap:5px; margin:2px 10px 2px 0; font-size:12px; }
  .sw i { width:11px; height:11px; border-radius:50%; display:inline-block; }
  .edge { display:flex; align-items:center; gap:8px; margin:4px 0; font-size:12px; }
  .edge b { width:34px; height:0; border-top-width:3px; border-top-style:solid; display:inline-block; }
  #info { margin-top:14px; padding-top:12px; border-top:1px solid #232b36; min-height:48px; }
  #info code { color:#9ecbff; word-break:break-all; }
</style>
</head>
<body>
<div id="cy"></div>
<div id="panel">
  <h1>Librarian wiki graph</h1>
  <div class="muted" id="counts"></div>
  <div class="legend">
    <h2>Node status</h2>
    ${swatches}
    <h2>Edge relation</h2>
    <div class="edge"><b style="border-top-color:#d32f2f;border-top-style:dashed"></b> contradicts (conflict)</div>
    <div class="edge"><b style="border-top-color:#ef6c00"></b> supersedes</div>
    <div class="edge"><b style="border-top-color:#1565c0"></b> depends-on</div>
    <div class="edge"><b style="border-top-color:#7d8893"></b> relates</div>
    <div class="edge"><b style="border-top-color:#3a434f"></b> link (body)</div>
  </div>
  <div id="info" class="muted">Click a node for details.</div>
</div>
<script>
  var PAYLOAD = ${dataJson};
  var STATUS_COLORS = ${JSON.stringify(STATUS_COLORS)};
  var model = PAYLOAD.model;
  var counts = {};
  model.edges.forEach(function (e) { counts[e.kind] = (counts[e.kind] || 0) + 1; });
  var contradicts = counts['contradicts'] || 0;
  document.getElementById('counts').innerHTML =
    model.nodes.length + ' pages, ' + model.edges.length + ' edges' +
    (contradicts ? ' &middot; <span style="color:#ff6b6b">' + contradicts + ' contradicts</span>' : '') +
    '<br>generated ' + PAYLOAD.meta.generatedAt;

  var elements = [];
  model.nodes.forEach(function (n) {
    elements.push({ data: { id: n.id, label: n.label, status: n.status, type: n.type, path: n.path } });
  });
  model.edges.forEach(function (e, i) {
    elements.push({ data: { id: 'e' + i, source: e.source, target: e.target, kind: e.kind } });
  });

  var cy = cytoscape({
    container: document.getElementById('cy'),
    elements: elements,
    layout: { name: 'cose', animate: false, padding: 40, nodeRepulsion: 9000 },
    style: [
      { selector: 'node', style: {
          'background-color': function (ele) { return STATUS_COLORS[ele.data('status')] || STATUS_COLORS.UNKNOWN; },
          'label': 'data(label)', 'color': '#e6edf3', 'font-size': 11,
          'text-valign': 'bottom', 'text-margin-y': 4, 'width': 22, 'height': 22,
          'border-width': 1, 'border-color': '#0c0f14' } },
      { selector: 'edge', style: {
          'width': 1.4, 'line-color': '#3a434f', 'curve-style': 'bezier',
          'target-arrow-color': '#3a434f' } },
      { selector: 'edge[kind = "relates"]', style: { 'line-color': '#7d8893', 'target-arrow-color': '#7d8893' } },
      { selector: 'edge[kind = "depends-on"]', style: {
          'line-color': '#1565c0', 'target-arrow-color': '#1565c0', 'target-arrow-shape': 'triangle', 'width': 2 } },
      { selector: 'edge[kind = "supersedes"]', style: {
          'line-color': '#ef6c00', 'target-arrow-color': '#ef6c00', 'target-arrow-shape': 'triangle', 'width': 2 } },
      { selector: 'edge[kind = "contradicts"]', style: {
          'line-color': '#d32f2f', 'line-style': 'dashed', 'width': 3 } },
      { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#9ecbff' } }
    ]
  });

  cy.on('tap', 'node', function (evt) {
    var d = evt.target.data();
    var info = document.getElementById('info');
    info.textContent = '';
    // Build the panel from text nodes, never innerHTML: a page-supplied path or type value
    // (type is warn-only, so it can be any string) must not inject markup into this artifact.
    var code = document.createElement('code');
    code.textContent = d.path;
    info.appendChild(code);
    var line = function (label, value) {
      info.appendChild(document.createElement('br'));
      info.appendChild(document.createTextNode(label));
      var b = document.createElement('b');
      b.textContent = value;
      info.appendChild(b);
    };
    line('status: ', d.status);
    if (d.type) line('type: ', d.type);
    info.appendChild(document.createElement('br'));
    info.appendChild(document.createTextNode('degree: ' + evt.target.degree()));
  });
</script>
</body>
</html>
`;
}

// --- main: walk the repo, build the model, write the artifact ---
function main() {
  const root = repoRoot();
  const { agent } = parseFlags(process.argv.slice(2)); // accept --agent; output is caller-independent
  const resolver = buildResolver(root);
  const pages = walkMarkdown(root, { excludeRel: ['docs/memory'] }).filter((f) => isPage(f.rel));
  const entries = pages.map((p) => {
    const { data, body } = parseFrontmatter(fs.readFileSync(p.full, 'utf8'));
    return { rel: p.rel, data, body };
  });

  const model = buildModel(entries, resolver);
  const generatedAt = new Date().toISOString().slice(0, 10); // local date; the artifact is not a determinism gate
  const html = renderHtml(model, { generatedAt, agent });

  const outDir = path.join(root, '.html-artifacts');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'wiki-graph.html');
  fs.writeFileSync(outFile, html);

  const byKind = {};
  for (const e of model.edges) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
  console.log('wiki:graph — wrote graph of the pages tier');
  console.log(`  ${model.nodes.length} pages, ${model.edges.length} edges` +
    (byKind.contradicts ? `, ${byKind.contradicts} contradicts (flagged)` : ''));
  console.log(`  edges by kind: ${JSON.stringify(byKind)}`);
  console.log(`  open: ${toPosix(path.relative(root, outFile))}`);
}

// Run only when invoked as a script (node scripts/wiki/graph.mjs), not when imported by tests.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
