import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { runAgentPrReady } from '../scripts/agent-pr-ready.mjs';

const ROOT = process.cwd();

test('agent-pr-ready has no skip-ci-guard bypass', () => {
  const body = readFileSync(join(ROOT, 'scripts', 'agent-pr-ready.mjs'), 'utf8');

  assert.doesNotMatch(body, /skip-ci-guard/);
});

// #173: closeout wrappers must fail with a clean usage line, never a stack trace.

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

test('agent-pr-ready rejects option tokens as required values (#173 P2)', () => {
  let failed = false, stderr = '';
  try {
    execFileSync(process.execPath,
      [join(ROOT, 'scripts', 'agent-pr-ready.mjs'), '--repo', 'ArchonVII/repo-template', '--pr', '--json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    failed = true;
    stderr = String(err.stderr ?? '');
  }
  assert.ok(failed, 'must exit non-zero when --pr consumes a flag token');
  assert.match(stderr, /Usage: npm run agent:pr-ready -- --repo OWNER\/REPO --pr <number>/);
  assert.doesNotMatch(stderr, /^\s+at /m, 'no stack frames');
});

test('agent-close-preflight rejects option tokens as required values (#173 P2)', () => {
  let failed = false, stderr = '';
  try {
    execFileSync(process.execPath,
      [join(ROOT, 'scripts', 'agent-close-preflight.mjs'), '--repo', '--pr'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    failed = true;
    stderr = String(err.stderr ?? '');
  }
  assert.ok(failed, 'must exit non-zero when --repo consumes a flag token');
  assert.match(stderr, /Usage: npm run agent:close-preflight -- --repo OWNER\/REPO --pr <number>/);
  assert.doesNotMatch(stderr, /^\s+at /m, 'no stack frames');
});

function validDraftPr() {
  return {
    number: 184,
    url: 'https://github.com/ArchonVII/repo-template/pull/184',
    title: 'fix(close): enforce every declared required gate',
    body: [
      '## Summary',
      'Require every declared stable aggregate check before promotion.',
      '',
      '## Verification',
      '- `node --test test/agent-pr-ready.test.mjs` completed with 1 test passing.',
      '',
      '### Verification Notes',
      'The controlled fixture exercises dry-run guard evaluation.',
      '',
      '## Docs / Changelog',
      'No changelog edit is needed because release notes derive from commits.',
      '',
      '## Linked Issue',
      'Closes #184',
    ].join('\n'),
    branch: 'agent/codex/184-required-gate-list',
    isDraft: true,
    files: ['scripts/agent-pr-ready.mjs'],
  };
}

function validReadyPr() {
  return { ...validDraftPr(), isDraft: false };
}

test('agent-pr-ready JSON reports an already-ready PR as ready without side effects', () => {
  let guardCalls = 0;
  let promotionCalls = 0;
  let stdout = '';

  const exitCode = runAgentPrReady(
    ['--repo', 'ArchonVII/repo-template', '--pr', '184', '--json'],
    {
      loadPr: () => validReadyPr(),
      runGuard: () => { guardCalls += 1; return { ok: true, output: '' }; },
      promote: () => { promotionCalls += 1; },
      writeStdout: (value) => { stdout += value; },
      writeStderr: (value) => assert.fail(`unexpected stderr: ${value}`),
    },
  );

  const payload = JSON.parse(stdout);
  assert.equal(exitCode, 0);
  assert.equal(guardCalls, 0);
  assert.equal(promotionCalls, 0);
  assert.equal(payload.ok, true);
  assert.equal(payload.ready, true);
  assert.equal(payload.pr.isDraft, false);
});

test('agent-pr-ready dry-run guards an already-ready PR and reports a no-op', () => {
  let guardCalls = 0;
  let promotionCalls = 0;
  let stdout = '';

  const exitCode = runAgentPrReady(
    ['--repo', 'ArchonVII/repo-template', '--pr', '184', '--dry-run'],
    {
      loadPr: () => validReadyPr(),
      runGuard: () => { guardCalls += 1; return { ok: true, output: 'Close CI guard passed.\n' }; },
      promote: () => { promotionCalls += 1; },
      writeStdout: (value) => { stdout += value; },
      writeStderr: (value) => assert.fail(`unexpected stderr: ${value}`),
    },
  );

  assert.equal(exitCode, 0);
  assert.equal(guardCalls, 1);
  assert.equal(promotionCalls, 0);
  assert.match(stdout, /already ready for review/i);
  assert.doesNotMatch(stdout, /would promote/i);
});

test('agent-pr-ready dry-run evaluates the close CI guard and never promotes', () => {
  let guardCalls = 0;
  let promotionCalls = 0;
  let stdout = '';
  let stderr = '';

  const exitCode = runAgentPrReady(
    ['--repo', 'ArchonVII/repo-template', '--pr', '184', '--dry-run'],
    {
      loadPr: () => validDraftPr(),
      runGuard: ({ repo, pr }) => {
        guardCalls += 1;
        assert.equal(repo, 'ArchonVII/repo-template');
        assert.equal(pr, 184);
        return { ok: true, output: 'Close CI guard passed.\n' };
      },
      promote: () => { promotionCalls += 1; },
      writeStdout: (value) => { stdout += value; },
      writeStderr: (value) => { stderr += value; },
    },
  );

  assert.equal(exitCode, 0);
  assert.equal(guardCalls, 1);
  assert.equal(promotionCalls, 0);
  assert.match(stdout, /close CI guard passed/i);
  assert.match(stdout, /would promote PR #184/i);
  assert.equal(stderr, '');
});

test('agent-pr-ready dry-run reports and refuses a failed close CI guard', () => {
  let promotionCalls = 0;
  let stdout = '';
  let stderr = '';

  const exitCode = runAgentPrReady(
    ['--repo', 'ArchonVII/repo-template', '--pr', '184', '--dry-run'],
    {
      loadPr: () => validDraftPr(),
      runGuard: () => ({ ok: false, output: 'Required check `Unity CI / required` is unavailable.' }),
      promote: () => { promotionCalls += 1; },
      writeStdout: (value) => { stdout += value; },
      writeStderr: (value) => { stderr += value; },
    },
  );

  assert.equal(exitCode, 1);
  assert.equal(promotionCalls, 0);
  assert.equal(stdout, '');
  assert.match(stderr, /Unity CI \/ required/);
  assert.match(stderr, /dry run refused/i);
});

test('agent-pr-ready dry-run JSON reports aggregate guard failure coherently', () => {
  let stdout = '';
  let promotionCalls = 0;

  const exitCode = runAgentPrReady(
    ['--repo', 'ArchonVII/repo-template', '--pr', '184', '--dry-run', '--json'],
    {
      loadPr: () => validDraftPr(),
      runGuard: () => ({ ok: false, output: 'required check failed' }),
      promote: () => { promotionCalls += 1; },
      writeStdout: (value) => { stdout += value; },
      writeStderr: () => assert.fail('JSON mode must not write the refusal to stderr'),
    },
  );

  const payload = JSON.parse(stdout);
  assert.equal(exitCode, 1);
  assert.equal(promotionCalls, 0);
  assert.equal(payload.ok, false);
  assert.equal(payload.ready, false);
  assert.equal(payload.dryRun, true);
  assert.deepEqual(payload.ciGuard, { ok: false });
});

test('agent-pr-ready keeps normal guarded promotion behavior', () => {
  let guardCalls = 0;
  let promoted = null;
  let stdout = '';

  const exitCode = runAgentPrReady(
    ['--repo', 'ArchonVII/repo-template', '--pr', '184'],
    {
      loadPr: () => validDraftPr(),
      runGuard: () => {
        guardCalls += 1;
        return { ok: true, output: 'Close CI guard passed.\n' };
      },
      promote: (value) => { promoted = value; },
      writeStdout: (value) => { stdout += value; },
      writeStderr: (value) => assert.fail(`unexpected stderr: ${value}`),
    },
  );

  assert.equal(exitCode, 0);
  assert.equal(guardCalls, 1);
  assert.deepEqual(promoted, { repo: 'ArchonVII/repo-template', pr: 184 });
  assert.match(stdout, /Promoted PR #184 to ready for review/);
});
