import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('./footprint.mjs', import.meta.url));
function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'doc-footprint-'));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    rmSync(root, { recursive: true, force: true });
  });
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  const write = (rel, text) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  git('init', '-q');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.com');
  git('config', 'core.autocrlf', 'false');
  for (const [rel, text] of Object.entries(files)) write(rel, text);
  git('add', '--', ...Object.keys(files));
  git('commit', '-qm', 'fixture');
  return { root, git, write };
}
function report(root, ...args) {
  const result = spawnSync(process.execPath, [cli, '--repo', root, '--json', ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('splitting prose exposes file growth without reducing aggregate words', (t) => {
  const f = fixture(t, { 'docs/long.md': 'one two three four\n' });
  f.write('docs/long.md', 'one two\n');
  f.write('docs/second.md', 'three four\n');
  const before = f.git('status', '--porcelain=v1', '--untracked-files=all');
  const r = report(f.root, '--base', 'HEAD');
  assert.deepEqual(r.documents.total, { files: 2, words: 4 });
  assert.deepEqual(r.delta.total, { files: 1, words: 0 });
  assert.deepEqual(r.changes.map((c) => [c.path, c.change, c.wordsDelta]), [
    ['docs/long.md', 'modified', -2], ['docs/second.md', 'added', 2],
  ]);
  assert.equal(f.git('status', '--porcelain=v1', '--untracked-files=all'), before);
  assert.equal(readFileSync(join(f.root, 'docs/long.md'), 'utf8'), 'one two\n');
});

test('reports deletion, lifecycle transitions and unclassified docs', (t) => {
  const f = fixture(t, {
    'docs/plan.md': 'Status: active\nDo the work\n',
    'docs/remove.md': 'old details\n',
    'docs/unknown.md': 'reference\n',
  });
  f.write('docs/plan.md', 'Status: archived\nDo the work\n');
  f.git('rm', '--', 'docs/remove.md');
  const r = report(f.root, '--base', 'HEAD');
  assert.deepEqual(r.delta.total, { files: -1, words: -2 });
  assert.deepEqual(r.delta.active, { files: -1, words: -5 });
  assert.deepEqual(r.delta.historical, { files: 1, words: 5 });
  assert.deepEqual(r.documents.unclassified, { files: 1, words: 1 });
  assert.equal(r.changes.find((c) => c.path === 'docs/plan.md').stateAfter, 'historical');
});

test('instruction imports deduplicate and terminate cycles; baseline existence is not reading', (t) => {
  const f = fixture(t, {
    'AGENTS.md': 'Rules\n',
    'CLAUDE.md': '@docs/rules.md\n@docs/rules.md\n',
    'docs/rules.md': '@../CLAUDE.md\nTwo rules\n',
    'docs/not-imported.md': 'large optional manual\n',
    '.agent/startup-baseline.json': '{"required":["docs/not-imported.md"]}',
  });
  const r = report(f.root);
  assert.deepEqual(r.instructions.files.map((f) => f.path), ['AGENTS.md', 'CLAUDE.md', 'docs/rules.md']);
  assert.deepEqual(r.instructions.total, { files: 3, words: 6 });
  assert.deepEqual(r.instructions.unresolved, []);
  assert.match(r.instructions.scope, /not.*runtime/i);
  assert.equal(r.delta, null);
});

test('missing/external imports are disclosed while fenced examples and ordinary links stay optional', (t) => {
  const f = fixture(t, {
    'CLAUDE.md': '@missing.md\n@../outside.md\n[Guide](docs/optional.md)\n```text\n@fake.md\n```\n`@inline.md`\n',
    'docs/optional.md': 'optional material\n',
  });
  const r = report(f.root);
  assert.deepEqual(r.instructions.files.map((f) => f.path), ['CLAUDE.md']);
  assert.deepEqual(r.instructions.unresolved.map((u) => u.target).sort(), ['../outside.md', 'missing.md']);
});

test('doc-map selects affected docs and discloses unmapped changes', (t) => {
  const f = fixture(t, {
    '.agent/doc-map.yml': 'version: 1\nchecked:\n  - path: docs/export.md\n    owns: ["src/export/**"]\n    checks: [links]\nhuman:\n  - path: docs/guides/**\n    heal_when: ["src/export/**"]\n',
    'docs/export.md': 'Export reference\n',
    'docs/guides/csv.md': 'CSV guide\n',
    'docs/other.md': 'Unrelated guide\n',
    'src/export/write.mjs': 'old\n',
    'src/unmapped.mjs': 'old\n',
  });
  f.write('src/export/write.mjs', 'new\n');
  f.write('src/unmapped.mjs', 'new\n');
  const r = report(f.root, '--base', 'HEAD');
  assert.deepEqual(r.affected.map((d) => d.path), ['docs/export.md', 'docs/guides/csv.md']);
  assert.deepEqual(r.affected[0].reasons, [{ changedPath: 'src/export/write.mjs', rule: 'owns: src/export/**' }]);
  assert.deepEqual(r.unmapped, ['src/unmapped.mjs']);
});

test('invalid base and malformed doc-map fail explicitly', (t) => {
  const f = fixture(t, { 'README.md': 'small repo\n' });
  const badBase = spawnSync(process.execPath, [cli, '--repo', f.root, '--base', 'missing-ref'], { encoding: 'utf8' });
  assert.equal(badBase.status, 2);
  assert.match(badBase.stderr, /base/i);
  f.write('.agent/doc-map.yml', 'version: 1\nunknown: value\n');
  const badMap = spawnSync(process.execPath, [cli, '--repo', f.root], { encoding: 'utf8' });
  assert.equal(badMap.status, 2);
  assert.match(badMap.stderr, /doc-map/i);
});

test('renaming code out of an owned area still selects its former documentation', (t) => {
  const f = fixture(t, {
    '.agent/doc-map.yml': 'version: 1\nchecked:\n  - path: docs/export.md\n    owns: src/export/**\n    checks: [links]\n',
    'docs/export.md': 'Export guide\n',
    'src/export/old.mjs': 'same content\n',
  });
  f.git('mv', '--', 'src/export/old.mjs', 'src/moved.mjs');
  const r = report(f.root, '--base', 'HEAD');
  assert.deepEqual(r.affected.map((d) => d.path), ['docs/export.md']);
  assert.equal(r.affected[0].reasons[0].changedPath, 'src/export/old.mjs');
  assert.deepEqual(r.unmapped, ['src/moved.mjs']);
});

test('instruction growth includes imported text and text output reports the delta', (t) => {
  const f = fixture(t, { 'CLAUDE.md': '@docs/rules.txt\n', 'docs/rules.txt': 'one\n' });
  f.write('docs/rules.txt', 'one two three\n');
  const r = report(f.root, '--base', 'HEAD');
  assert.deepEqual(r.delta.instructions, { files: 0, words: 2 });
  const result = spawnSync(process.execPath, [cli, '--repo', f.root, '--base', 'HEAD'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Instruction union:.*\+2 words/);
});

test('indented examples and longer fences never add unconditional imports', (t) => {
  const f = fixture(t, {
    'CLAUDE.md': 'Example:\n\n    @docs/example.md\n\n````markdown\n```text\n@docs/example.md\n```\n````\n',
    'docs/example.md': 'optional example\n',
  });
  const r = report(f.root);
  assert.deepEqual(r.instructions.files.map((f) => f.path), ['CLAUDE.md']);
  assert.deepEqual(r.instructions.unresolved, []);
});

test('exact base comparison detects growth even when the index suppresses diff output', (t) => {
  const f = fixture(t, { 'docs/rules.md': 'one\n' });
  f.git('update-index', '--assume-unchanged', 'docs/rules.md');
  f.write('docs/rules.md', 'one two three\n');
  assert.equal(f.git('diff', '--name-only', 'HEAD').trim(), '');
  const r = report(f.root, '--base', 'HEAD');
  assert.deepEqual(r.delta.total, { files: 0, words: 2 });
  assert.equal(r.changes[0].wordsDelta, 2);
  assert.equal(r.affected[0].path, 'docs/rules.md');
});

test('base blob framing preserves Unicode and ignores platform line endings', (t) => {
  const f = fixture(t, { 'docs/a.md': 'café 猫\n', 'docs/b.md': 'keep this\n' });
  f.write('docs/a.md', 'café 猫 added\n');
  f.write('docs/b.md', 'keep this\r\n');
  const r = report(f.root, '--base', 'HEAD');
  assert.deepEqual(r.delta.total, { files: 0, words: 1 });
  assert.deepEqual(r.changes.map((c) => c.path), ['docs/a.md']);
});

test('indented paragraph continuations still contribute real imports', (t) => {
  const f = fixture(t, {
    'CLAUDE.md': 'Read these rules:\n    @docs/rules.md\n',
    'docs/rules.md': 'required material\n',
  });
  const r = report(f.root);
  assert.deepEqual(r.instructions.files.map((f) => f.path), ['CLAUDE.md', 'docs/rules.md']);
});
