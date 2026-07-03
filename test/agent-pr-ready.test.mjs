import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const ROOT = process.cwd();

test('agent-pr-ready has no skip-ci-guard bypass', () => {
  const body = readFileSync(join(ROOT, 'scripts', 'agent-pr-ready.mjs'), 'utf8');

  assert.doesNotMatch(body, /skip-ci-guard/);
});
