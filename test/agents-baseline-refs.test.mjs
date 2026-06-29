import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// Return the body of a `## <heading>` section up to the next `##` heading or a
// managed-block marker, so we can assert on one section in isolation.
function section(body, heading) {
  const start = body.indexOf(`## ${heading}`);
  if (start === -1) return '';
  const rest = body.slice(start + heading.length + 3);
  const next = rest.search(/\n## |\n<!-- (BEGIN|END) /);
  return next === -1 ? rest : rest.slice(0, next);
}

// archon-setup#290 / repo-template#131: the baseline AGENTS.md is snapshotted
// verbatim into every onboarded repo. Its Librarian-wiki and project-capsule
// guidance, plus the managed Start Map `Projects:` line, pointed at infra
// (docs/CANON.md, docs/LIBRARIAN.md, wiki:* scripts, projects/<slug>/PLAN.md)
// that a non-wiki onboarded repo never gets, so they dangled. The always-shipped
// baseline must carry ZERO unconditional dangling references: feature guidance is
// gated behind the feature that installs it, and the managed block names no
// capsule path.
test('managed Agent Start Map block has no dangling capsule reference (archon-setup#290)', async () => {
  const body = await readFile(join(ROOT, 'AGENTS.md'), 'utf8');
  const begin = body.indexOf('<!-- BEGIN MANAGED AGENT START MAP -->');
  const end = body.indexOf('<!-- END MANAGED AGENT START MAP -->');
  assert.ok(begin > -1 && end > begin, 'managed start-map markers must be present');
  const managed = body.slice(begin, end);

  assert.doesNotMatch(managed, /projects\/<slug>\/PLAN\.md/, 'managed block must not point at a capsule PLAN path');
  assert.doesNotMatch(managed, /project-capsules/, 'managed block must not reference the capsule convention doc');
  assert.match(managed, /docs\/plans\//, 'managed block still routes plans to docs/plans/');
});

test('Read First gates the Librarian-wiki docs behind the wiki feature (archon-setup#290)', async () => {
  const body = await readFile(join(ROOT, 'AGENTS.md'), 'utf8');
  const readFirst = section(body, 'Read First');
  // README and ARCHITECTURE stay; the wiki docs only appear under a conditional.
  assert.match(readFirst, /README\.md/);
  assert.match(readFirst, /When the repo runs the Librarian wiki/);
  // CANON/LIBRARIAN must not be presented as unconditional must-reads: every
  // mention in Read First sits after the conditional clause.
  const conditionalAt = readFirst.indexOf('When the repo runs the Librarian wiki');
  for (const ref of ['docs/CANON.md', 'docs/LIBRARIAN.md', 'docs/INDEX.md']) {
    const at = readFirst.indexOf(ref);
    assert.ok(at === -1 || at > conditionalAt, `${ref} must be gated behind the wiki conditional in Read First`);
  }
});

test('Librarian Wiki and Project Capsules sections are gated behind their features (archon-setup#290)', async () => {
  const body = await readFile(join(ROOT, 'AGENTS.md'), 'utf8');

  const wiki = section(body, 'Librarian Wiki');
  assert.match(wiki, /Applies only when the repo installs the Librarian wiki feature/);

  const capsules = section(body, 'Project Capsules');
  assert.match(capsules, /Applies only when the repo adopts project capsules/);
});
