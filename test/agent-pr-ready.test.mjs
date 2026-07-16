import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const ROOT = process.cwd();

test('agent-pr-ready has no skip-ci-guard bypass', () => {
  const body = readFileSync(join(ROOT, 'scripts', 'agent-pr-ready.mjs'), 'utf8');

  assert.doesNotMatch(body, /skip-ci-guard/);
});

// #173: closeout wrappers must fail with a clean usage line, never a stack trace.
import { execFileSync } from 'node:child_process';

function runWithoutArgs(script) {
  try {
    execFileSync(process.execPath, [join(ROOT, 'scripts', script)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { failed: false, stderr: '' };
  } catch (err) {
    return { failed: true, stderr: String(err.stderr ?? '') };
  }
}

test('agent-pr-ready without --repo/--pr exits with usage, not a stack trace (#173)', () => {
  const { failed, stderr } = runWithoutArgs('agent-pr-ready.mjs');
  assert.ok(failed, 'must exit non-zero without --repo/--pr');
  assert.match(stderr, /Usage: npm run agent:pr-ready -- --repo OWNER\/REPO --pr <number>/);
  assert.doesNotMatch(stderr, /^\s+at /m, 'no stack frames in usage error');
});

test('agent-close-preflight without --repo/--pr exits with usage, not a stack trace (#173)', () => {
  const { failed, stderr } = runWithoutArgs('agent-close-preflight.mjs');
  assert.ok(failed, 'must exit non-zero without --repo/--pr');
  assert.match(stderr, /Usage: npm run agent:close-preflight -- --repo OWNER\/REPO --pr <number>/);
  assert.doesNotMatch(stderr, /^\s+at /m, 'no stack frames in usage error');
});

test('agent-pr-ready guard hint renders the exact ci-guard invocation (#173)', () => {
  const body = readFileSync(join(ROOT, 'scripts', 'agent-pr-ready.mjs'), 'utf8');
  assert.match(body, /close:ci:guard -- --repo \$\{args\.repo\} --pr \$\{pr\.number\}/);
});
