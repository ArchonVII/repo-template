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

test('coordination policy separates durable repo records from machine transport and runtime state (#185)', async () => {
  const agents = await readFile(join(ROOT, 'AGENTS.md'), 'utf8');
  const coordination = section(agents, 'Coordination');
  const contract = await readFile(join(ROOT, '.agent', 'coordination', 'README.md'), 'utf8');

  for (const body of [coordination, contract]) {
    assert.match(body, /canonical for durable repository coordination/i);
    assert.match(body, /machine-global.*transport queues/i);
    assert.match(body, /ephemeral runtime claims and locks.*machine-local/i);
    assert.doesNotMatch(body, /Do not read from or write to machine-global coordination boards/i);
  }
});

test('document policy activation and plan authority remain capability-aware (#185)', async () => {
  const agents = await readFile(join(ROOT, 'AGENTS.md'), 'utf8');
  const docHealth = section(agents, 'Doc Health');
  const policy = await readFile(join(ROOT, 'docs', 'agent-process', 'document-policy.md'), 'utf8');
  const plans = await readFile(join(ROOT, 'docs', 'plans', 'README.md'), 'utf8');

  assert.match(docHealth, /Applies only when the repo installs the doc-health feature/i);
  assert.match(docHealth, /unrelated warnings do not prevent document-policy activation/i);

  assert.match(policy, /ArchonVII\/jma-skills-data/);
  assert.doesNotMatch(policy, /ArchonVII\/jma-skill-review/);
  assert.match(policy, /imported charter remains transitional/i);
  assert.match(policy, /declared prerequisite capabilities are installed/i);
  assert.match(policy, /targeted policy checks pass/i);
  assert.match(policy, /Run doc-health as part of that gate only when it is installed/i);
  assert.match(policy, /unrelated warnings do not prevent activation/i);

  assert.match(plans, /Only plans explicitly marked active or selected by the repo-local status\/index are authoritative/i);
  assert.match(plans, /Capsule guidance applies only when the repo adopts project capsules/i);
});
