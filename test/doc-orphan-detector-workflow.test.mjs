import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

test('doc orphan detector caller is wired to the pinned reusable workflow', async () => {
  const workflow = await readFile(
    join(ROOT, '.github', 'workflows', 'doc-orphan-detector.yml'),
    'utf8',
  );

  assert.match(workflow, /^name: Doc Orphan Detector$/m);
  assert.match(workflow, /^\s+schedule:$/m);
  assert.match(workflow, /^\s+- cron: "0 7 \* \* 1"$/m);
  assert.match(workflow, /^\s+workflow_dispatch:$/m);
  assert.match(workflow, /^\s+contents: read$/m);
  assert.match(workflow, /^\s+issues: write$/m);
  assert.match(
    workflow,
    /^\s+uses: ArchonVII\/github-workflows\/\.github\/workflows\/doc-orphan-detector\.yml@v1$/m,
  );
  assert.doesNotMatch(workflow, /doc-orphan-detector\.yml@main/);
});
